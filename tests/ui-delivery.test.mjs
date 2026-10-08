import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorker } from './helpers/runtime.mjs';
const { default: worker } = await loadWorker('worker/index.ts');
const { deriveToken } = await loadWorker('worker/auth.ts');
const { uiHtml, uiAssets } = await loadWorker('worker/generated/ui-assets.ts');

test('refined frontend keeps authentication, security headers and immutable versioned asset URLs', async () => {
  const env = { AUTH_PASSWORD: 'synthetic-access', APP_STORAGE_MODE: 'd1', FINANCE_MEMORY: {}, ASSETS: { fetch: async () => new Response('<html>original</html>', { headers: { 'Content-Type': 'text/html', ETag: 'original', 'Content-Length': '21' } }) } };
  const token = await deriveToken(env.AUTH_PASSWORD);
  const call = path => worker.fetch(new Request('https://test.invalid' + path, { headers: { Authorization: 'Bearer ' + token } }), env, {});
  const html = await call('/');
  assert.equal(html.status, 200);
  assert.equal(await html.text(), uiHtml);
  assert.equal(html.headers.get('Cache-Control'), 'no-store');
  assert.equal(html.headers.get('ETag'), null);
  assert.equal(html.headers.get('Content-Length'), null);
  assert.match(html.headers.get('Content-Security-Policy'), /script-src 'self'/);
  const scriptPath = Object.keys(uiAssets).find(path => path.endsWith('/ui.js'));
  const script = await call(scriptPath);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('Cache-Control'), /immutable/);
  assert.equal(await script.text(), uiAssets[scriptPath].body);
  const denied = await worker.fetch(new Request('https://test.invalid' + scriptPath), env, {});
  assert.equal(denied.status, 401);
  const recovery = await worker.fetch(new Request('https://test.invalid/api/admin/storage-migration/assets?path=/'), env, {});
  assert.equal(recovery.status, 503);
});
