#!/usr/bin/env python3
"""Back up, stage, verify, and deploy the backend while preserving live assets.
Never replaces/deletes the production database, namespaces, accounts, or secrets.
"""
import argparse
import datetime
import hashlib
import email
import email.policy
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORKER = 'cf-ai-finance-tracker'
DATABASE = 'ddede735-a6b9-4666-8fb8-efda1461fffc'
ORIGIN = 'https://cf-ai-finance-tracker.ayanamiaqa.workers.dev'
FINANCE = '9bf083ea87b64d0eb2b277cf49cfa10e'
REGISTRY = '5ee0667cffb54b51b773681cb9e2d8b3'
MIGRATION = '20261008_d1_app_storage.sql'
EXPECTED_HISTORY = ['0001_expenses.sql', '0002_recurring.sql', '0003_budgets_audit.sql', '0004_consistency_features.sql', '0005_backup_dedup.sql', '0006_do_backups.sql']
SECRET = 'STORAGE_MIGRATION_TOKEN'


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Deployment:
    def __init__(self, directory):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        self.account = os.environ['CLOUDFLARE_ACCOUNT_ID']
        self.headers = {'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN']}
        self.base = 'https://api.cloudflare.com/client/v4/accounts/' + self.account
        self.script = self.base + '/workers/scripts/' + WORKER
        self.token = None
        self.origin = ORIGIN

    def save(self, name, value):
        path = self.directory / name
        path.write_bytes(value if isinstance(value, bytes) else (json.dumps(value, indent=2) + '\n').encode())
        path.chmod(0o600)

    def api(self, url, payload=None, method=None, raw=False, content_type=None):
        data = payload if isinstance(payload, bytes) else None if payload is None else json.dumps(payload).encode()
        headers = dict(self.headers)
        if data is not None:
            headers['Content-Type'] = content_type or 'application/json'
        req = urllib.request.Request(url, headers=headers, data=data, method=method)
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read()
        if raw:
            return body
        result = json.loads(body)
        if result.get('success') is False:
            # Codes and messages only: never echo request bindings or account data.
            errors = [{k: e[k] for k in ['code', 'message'] if k in e} for e in result.get('errors', [])]
            raise RuntimeError('Cloudflare API rejected request: ' + json.dumps(errors))
        return result['result']

    def query(self, sql):
        result = self.api(self.base + '/d1/database/' + DATABASE + '/query', {'sql': sql})
        if not all(r.get('success') for r in result):
            raise RuntimeError('D1 query failed')
        return result[0]['results']

    def command(self, args):
        result = subprocess.run(args, cwd=ROOT, env={**os.environ, 'CI': 'true'}, capture_output=True, text=True)
        if result.returncode:
            # Wrangler errors may contain signed export URLs. Keep logs private.
            self.save('command-failure.log', (result.stdout + result.stderr).encode())
            raise RuntimeError('Command failed; diagnostic saved privately: ' + args[0])
        return result.stdout

    def export(self, filename):
        path = self.directory / filename
        self.command(['node', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'export', 'finance-tracker-db', '--remote', '--output', str(path), '--config', 'wrangler.jsonc'])
        path.chmod(0o600)
        connection = sqlite3.connect(':memory:')
        connection.executescript(path.read_text())
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Export integrity verification failed')
        tables = [r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")]
        fingerprints = {}
        for table in tables:
            rows = connection.execute('SELECT * FROM "' + table.replace('"', '""') + '"').fetchall()
            fingerprints[table] = {'count': len(rows), 'sha256': digest(sorted(rows, key=canonical))}
        connection.close()
        return fingerprints

    def settings(self):
        settings = self.api(self.script + '/settings')
        bindings = {b['name']: b for b in settings['bindings']}
        if bindings['DB'].get('id', bindings['DB'].get('database_id')) != DATABASE:
            raise RuntimeError('Unexpected database binding')
        for name, namespace in [('FINANCE_MEMORY', FINANCE), ('USER_REGISTRY', REGISTRY)]:
            if bindings[name].get('namespace_id') != namespace:
                raise RuntimeError('Unexpected Durable Object namespace')
        if 'ASSETS' not in bindings or 'AUTH_PASSWORD' not in bindings:
            raise RuntimeError('Missing live assets/auth binding')
        return settings

    def upload(self, code, mode):
        settings = self.settings()
        bindings = [b for b in settings['bindings'] if b['type'] not in ['secret_text', 'secret_key'] and b['name'] != 'APP_STORAGE_MODE']
        bindings.append({'type': 'plain_text', 'name': 'APP_STORAGE_MODE', 'text': mode})
        metadata = {k: settings[k] for k in ['compatibility_date', 'compatibility_flags', 'usage_model', 'tail_consumers', 'logpush', 'observability', 'placement', 'tags'] if k in settings}
        metadata.update(main_module='index.js', bindings=bindings, keep_bindings=['secret_text', 'secret_key'], keep_assets=True)
        boundary = 'finance-' + secrets.token_hex(24)
        parts = []
        for name, filename, mime, content in [('metadata', None, 'application/json', json.dumps(metadata).encode()), ('index.js', 'index.js', 'application/javascript+module', code)]:
            disposition = 'Content-Disposition: form-data; name="' + name + '"' + ('; filename="' + filename + '"' if filename else '')
            parts.append(('--' + boundary + '\r\n' + disposition + '\r\nContent-Type: ' + mime + '\r\n\r\n').encode() + content + b'\r\n')
        payload = b''.join(parts) + ('--' + boundary + '--\r\n').encode()
        result = self.api(self.script, payload, 'PUT', content_type='multipart/form-data; boundary=' + boundary)
        self.save('deployment-' + mode + '.json', result)
        current = self.settings()
        current_mode = next((b.get('text') for b in current['bindings'] if b['name'] == 'APP_STORAGE_MODE'), None)
        if current_mode != mode:
            raise RuntimeError('Storage mode verification failed')
        return result

    def admin(self, payload=None):
        headers = {'Content-Type': 'application/json', 'X-Storage-Migration-Token': self.token, 'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(self.origin + '/api/admin/storage-migration', headers=headers, data=None if payload is None else json.dumps(payload).encode())
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.load(response)
        if not result.get('success'):
            raise RuntimeError('Worker migration check failed')
        return result

    def verify_active(self):
        rows = self.query('SELECT object_id, key, value_json FROM app_legacy_snapshots')
        sources = {(r['object_id'], r['key']): json.loads(r['value_json']) for r in rows}
        objects = self.query('SELECT object_id, scope FROM app_legacy_objects')
        for table, field, key in [('app_user_accounts', 'username_key', 'accounts'), ('app_families', 'code', 'families'), ('app_family_memberships', 'username_key', 'membership')]:
            archived = {}
            for (_, source_key), value in sources.items():
                if source_key == key:
                    archived.update(value)
            current = self.query('SELECT * FROM ' + table)
            active = {row[field]: (row['family_code'] if key == 'membership' else json.loads(row['record_json'])) for row in current}
            if canonical(active) != canonical(archived):
                raise RuntimeError('Migrated registry differs from archived original: ' + table)
        chat_count = 0
        for obj in objects:
            if not obj['scope']:
                continue
            archived = sources.get((obj['object_id'], 'chatMessages'), [])
            active = [json.loads(r['record_json']) for r in self.query('SELECT record_json FROM app_chat_messages WHERE scope = ' + "'" + obj['scope'].replace("'", "''") + "'")]
            if canonical(sorted(active, key=canonical)) != canonical(sorted(archived, key=canonical)):
                raise RuntimeError('Migrated chat differs from original')
            chat_count += len(active)
        return {'accounts': len(self.query('SELECT username_key FROM app_user_accounts')), 'families': len(self.query('SELECT code FROM app_families')), 'chat_messages': chat_count, 'archived_objects': len(objects)}

    def run(self, code):
        print('Validating existing bindings and migration history.', flush=True)
        local_history = sorted(path.name for path in (ROOT / 'migrations').glob('*.sql'))
        if local_history != EXPECTED_HISTORY + [MIGRATION]:
            raise RuntimeError('Unreviewed local migrations present; refusing production schema changes')
        initial = self.settings()
        domains = self.api(self.base + '/workers/domains')
        enabled = [d for d in domains if d.get('service') == WORKER and d.get('enabled')]
        if enabled:
            self.origin = 'https://' + enabled[0]['hostname']
        self.save('routing.json', {'domains': enabled, 'subdomain': self.api(self.script + '/subdomain')})
        mode = next((b.get('text') for b in initial['bindings'] if b['name'] == 'APP_STORAGE_MODE'), 'legacy')
        schedules = self.api(self.script + '/schedules')
        if not (self.directory / 'original-worker.multipart').exists():
            self.save('original-settings.json', initial)
            self.save('original-schedules.json', schedules)
            self.save('original-worker.multipart', self.api(self.script, raw=True))
        history = [r['name'] for r in self.query('SELECT name FROM d1_migrations ORDER BY id')]
        if history not in [EXPECTED_HISTORY, EXPECTED_HISTORY + [MIGRATION]]:
            raise RuntimeError('Unexpected migration history; refusing to apply schema')
        if mode == 'legacy':
            raw = self.api(self.script, raw=True)
            boundary = raw.split(b'\r\n', 1)[0][2:]
            parsed = email.message_from_bytes(b'Content-Type: multipart/form-data; boundary=' + boundary + b'\r\nMIME-Version: 1.0\r\n\r\n' + raw, policy=email.policy.default)
            modules = [part.get_payload(decode=True) for part in parsed.iter_parts() if part.get_param('name', header='content-disposition') == 'index.js']
            if len(modules) != 1 or hashlib.sha256(modules[0]).hexdigest() != '55af2823c11a0c5a973226c2a629cc3a0a59d3a92aaa1d6c30b7ee26f0b441da':
                raise RuntimeError('Live backend has changed since recovery; compare newer source before deploying')
        if mode == 'd1':
            print('D1 already active: backing up before backend-only update.', flush=True)
            self.export('before-update.sql')
            self.upload(code, 'd1')
            if self.api(self.script + '/schedules') != schedules:
                raise RuntimeError('Cron schedule changed unexpectedly')
            print('Backend updated; database, namespaces, secrets and assets preserved.', flush=True)
            return
        if mode not in ['legacy', 'migration']:
            raise RuntimeError('Unexpected storage mode')
        resuming = mode == 'migration' and (self.directory / 'migration-resume-token').exists()
        if any(b['name'] == SECRET for b in initial['bindings']) and not resuming:
            raise RuntimeError('Migration secret already exists; refusing to overwrite it. Use the original backup directory to resume.')
        if resuming:
            self.token = (self.directory / 'migration-resume-token').read_text()
            self.admin()  # Must match the existing migration secret.
            print('Resuming verified migration under maintenance.', flush=True)
        if not resuming:
            before = self.export('before-migration.sql')
            self.save('before-fingerprints.json', before)
            print('Full D1 backup downloaded and restored successfully in memory.', flush=True)
        if history == EXPECTED_HISTORY:
            # History was read from D1. Wrangler applies only the single additive migration.
            self.command(['node', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'finance-tracker-db', '--remote', '--config', 'wrangler.jsonc'])
        if [r['name'] for r in self.query('SELECT name FROM d1_migrations ORDER BY id')] != EXPECTED_HISTORY + [MIGRATION]:
            raise RuntimeError('Additive migration history verification failed')
        print('Entering brief maintenance phase; original data stays intact.', flush=True)
        self.upload(code, 'migration')
        if not resuming:
            self.token = secrets.token_urlsafe(48)
            # Private resume credential; no existing app secret is read or changed.
            self.save('migration-resume-token', self.token.encode())
            self.api(self.script + '/secrets', {'name': SECRET, 'text': self.token, 'type': 'secret_text'}, 'PUT')
        req = urllib.request.Request(self.origin + '/api/account/me', headers={'User-Agent': 'Mozilla/5.0'})
        try:
            urllib.request.urlopen(req, timeout=60)
            raise RuntimeError('Maintenance gate did not activate')
        except urllib.error.HTTPError as error:
            if error.code != 503:
                raise RuntimeError('Unexpected maintenance gate response') from None
        if resuming and (self.directory / 'frozen-fingerprints.json').exists():
            frozen = json.loads((self.directory / 'frozen-fingerprints.json').read_text())
        else:
            frozen = self.export('frozen-before-copy.sql')
            self.save('frozen-fingerprints.json', frozen)
        spec = importlib.util.spec_from_file_location('migrate_storage', ROOT / 'scripts/migrate-storage.py')
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        finance_objects = migration.inventory(self.account, FINANCE, self.headers)
        registry_objects = migration.inventory(self.account, REGISTRY, self.headers)
        self.save('original-object-inventory.json', {'finance': sorted(finance_objects), 'registry': sorted(registry_objects)})
        for object_id in registry_objects:
            self.admin({'action': 'archive-registry', 'objectId': object_id})
        self.admin({'action': 'registry'})
        for object_id in finance_objects:
            self.admin({'action': 'archive', 'objectId': object_id})
        status = self.admin()
        for scope in status['scopes']:
            self.admin({'action': 'scope', 'scope': scope})
        status = self.admin()
        keys = {r['migration_key'] for r in status['migrations']}
        if 'registry-v1' not in keys or not all('archive-v1:' + i in keys for i in finance_objects | registry_objects):
            raise RuntimeError('Incomplete original object archive')
        for action, objects in [('verify-finance', finance_objects), ('verify-registry', registry_objects)]:
            for object_id in objects:
                if not self.admin({'action': action, 'objectId': object_id})['unchanged']:
                    raise RuntimeError('Original Durable Object differs from its immutable archive')
        report = self.verify_active()
        copied = self.export('verified-before-cutover.sql')
        protected = [table for table in frozen if not table.startswith('app_')]
        if any(copied[table] != frozen[table] for table in protected):
            raise RuntimeError('An existing D1 table changed during maintenance; refusing cutover')
        report.update(existing_tables_unchanged=len(protected), original_objects_unchanged=len(finance_objects | registry_objects), expenses_preserved=frozen['expenses']['count'])
        self.save('verification.json', report)
        print('Original accounts, chat history, Durable Objects and existing D1 tables verified unchanged.', flush=True)
        self.upload(code, 'd1')
        if self.api(self.script + '/schedules') != schedules:
            raise RuntimeError('Cron schedule changed unexpectedly')
        self.api(self.script + '/secrets/' + SECRET, method='DELETE')
        self.save('deployed-backend.js', code)
        self.save('deployed-settings.json', self.settings())
        self.export('after-migration.sql')
        report['storage_mode'] = 'd1'
        report['assets_preserved'] = True
        report['cron_preserved'] = True
        self.save('verification.json', report)
        print('D1 cutover complete. Verification:', json.dumps(report), flush=True)
        print('Private backups:', self.directory, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', default='dist/cf_ai_finance_tracker/index.js')
    parser.add_argument('--backup-dir', help='Private backup directory; defaults outside the repository')
    args = parser.parse_args()
    code = (ROOT / args.bundle).read_bytes()
    if b'APP_STORAGE_MODE' not in code or b'UserRegistry' not in code or b'FinanceMemory' not in code:
        raise RuntimeError('Expected merged backend bundle not found')
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = Path(args.backup_dir) if args.backup_dir else ROOT.parent / 'scratch' / ('finance-cutover-' + timestamp)
    Deployment(directory).run(code)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Deployment stopped:', type(error).__name__, str(error) if isinstance(error, RuntimeError) else '', file=sys.stderr)
        print('No original database or legacy storage was replaced or deleted. Keep private backups and resolve the failure before retrying.', file=sys.stderr)
        sys.exit(1)
