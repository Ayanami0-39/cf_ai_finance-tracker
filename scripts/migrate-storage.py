#!/usr/bin/env python3
"""Resume-safe migration. No legacy storage or existing D1 expenses are modified.
Credentials are read from environment; never passed in CLI arguments or logged.
"""
import argparse
import json
import os
import urllib.parse
import urllib.request


def request(url, headers, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={**headers, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.load(response)
    if not result.get('success'):
        raise RuntimeError('Request did not succeed; migration stopped without changing original storage')
    return result


def inventory(account, namespace_id, headers):
    objects = set()
    cursor = None
    while True:
        query = {'limit': 1000}
        if cursor:
            query['cursor'] = cursor
        url = (
            'https://api.cloudflare.com/client/v4/accounts/' + urllib.parse.quote(account, safe='')
            + '/workers/durable_objects/namespaces/' + urllib.parse.quote(namespace_id, safe='')
            + '/objects?' + urllib.parse.urlencode(query)
        )
        page = request(url, headers)
        if not page['result']:
            break
        objects.update(item['id'] for item in page['result'])
        info = page.get('result_info', {})
        next_cursor = info.get('cursor')
        if not next_cursor:
            if len(page['result']) == 1000:
                raise RuntimeError('Full inventory page without a cursor; cannot verify completeness')
            break
        if next_cursor == cursor:
            raise RuntimeError('Inventory cursor did not advance')
        cursor = next_cursor
    return objects


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Deployed app HTTPS origin')
    parser.add_argument('--finance-namespace-id', required=True, help='Existing FINANCE_MEMORY namespace ID')
    parser.add_argument('--registry-namespace-id', required=True, help='Existing USER_REGISTRY namespace ID')
    args = parser.parse_args()
    if not args.url.startswith('https://'):
        parser.error('--url must use HTTPS')
    account = os.environ['CLOUDFLARE_ACCOUNT_ID']
    cf_headers = {'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN']}
    app_headers = {
        'X-Storage-Migration-Token': os.environ['STORAGE_MIGRATION_TOKEN'],
    }
    endpoint = args.url.rstrip('/') + '/api/admin/storage-migration'
    # Inventory ALL existing objects before triggering new scope migrations.
    objects = inventory(account, args.finance_namespace_id, cf_headers)
    registry_objects = inventory(account, args.registry_namespace_id, cf_headers)
    print('Inventoried legacy finance objects:', len(objects))
    print('Inventoried legacy registry objects:', len(registry_objects))
    for object_id in sorted(registry_objects):
        request(endpoint, app_headers, {'action': 'archive-registry', 'objectId': object_id})
    request(endpoint, app_headers, {'action': 'registry'})
    for index, object_id in enumerate(sorted(objects), 1):
        request(endpoint, app_headers, {'action': 'archive', 'objectId': object_id})
        print('Archived legacy finance objects:', index, '/', len(objects))
    status = request(endpoint, app_headers)
    for index, scope in enumerate(status['scopes'], 1):
        request(endpoint, app_headers, {'action': 'scope', 'scope': scope})
        print('Migrated known scopes:', index, '/', len(status['scopes']))
    status = request(endpoint, app_headers)
    archived = {entry['object_id'] for entry in status['objects']}
    if not (objects | registry_objects).issubset(archived):
        raise RuntimeError('Legacy inventory verification failed')
    keys = {entry['migration_key'] for entry in status['migrations']}
    if 'registry-v1' not in keys or not all('archive-v1:' + object_id in keys for object_id in objects | registry_objects):
        raise RuntimeError('Migration completion verification failed')
    print('Verified registry and all inventoried legacy finance objects.')
    print('D1 account/family/chat counts:', status['accounts'], status['families'], status['chatMessages'])
    print('Export D1 now. Retain the original namespaces and records.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Exception messages can include URLs or SQL details; print only the class.
        print('Migration stopped:', type(error).__name__)
        print('Original Durable Object storage is unchanged. Resolve the failure and rerun.')
        raise SystemExit(1)
