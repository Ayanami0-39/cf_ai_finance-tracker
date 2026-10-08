import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('backend upload preserves live assets, secrets and namespace IDs without packaging frontend files', () => {
  const result = spawnSync('python3', ['-c', `
import importlib.util, pathlib, tempfile, json, email, email.policy
spec = importlib.util.spec_from_file_location('deploy_backend', 'scripts/deploy-backend.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class Fake(module.Deployment):
    def __init__(self, directory):
        self.directory = pathlib.Path(directory); self.script = 'https://test.invalid'; self.mode = 'legacy'
    def settings(self):
        return {'compatibility_date': '2025-11-25', 'bindings': [
            {'name': 'AUTH_PASSWORD', 'type': 'secret_text'},
            {'name': 'STORAGE_MIGRATION_TOKEN', 'type': 'secret_text'},
            {'name': 'ASSETS', 'type': 'assets'},
            {'name': 'DB', 'type': 'd1', 'id': module.DATABASE},
            {'name': 'FINANCE_MEMORY', 'type': 'durable_object_namespace', 'namespace_id': module.FINANCE, 'class_name': 'FinanceMemory'},
            {'name': 'USER_REGISTRY', 'type': 'durable_object_namespace', 'namespace_id': module.REGISTRY, 'class_name': 'UserRegistry'},
            {'name': 'APP_STORAGE_MODE', 'type': 'plain_text', 'text': self.mode}]}
    def api(self, url, payload=None, method=None, raw=False, content_type=None):
        assert method == 'PUT'
        message = email.message_from_bytes(('Content-Type: '+content_type+'\\r\\nMIME-Version: 1.0\\r\\n\\r\\n').encode()+payload, policy=email.policy.default)
        parts = {p.get_param('name', header='content-disposition'): p.get_payload(decode=True) for p in message.iter_parts()}
        assert set(parts) == {'metadata', 'index.js'}
        assert parts['index.js'] == b'test backend'
        metadata = json.loads(parts['metadata'])
        assert metadata['keep_assets'] is True
        assert metadata['keep_bindings'] == ['secret_text', 'secret_key']
        assert all(b['type'] not in ['secret_text', 'secret_key'] for b in metadata['bindings'])
        bindings = {b['name']: b for b in metadata['bindings']}
        assert bindings['FINANCE_MEMORY']['namespace_id'] == module.FINANCE
        assert bindings['USER_REGISTRY']['namespace_id'] == module.REGISTRY
        assert bindings['DB']['id'] == module.DATABASE
        self.mode = bindings['APP_STORAGE_MODE']['text']
        return {'success': True}
with tempfile.TemporaryDirectory() as directory:
    deployment = Fake(directory)
    deployment.upload(b'test backend', 'migration')
    deployment.upload(b'test backend', 'd1')
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
