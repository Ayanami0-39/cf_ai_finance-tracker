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

test('fresh HTML navigations work without Fetch Metadata while APIs and assets stay protected', async () => {
  const env = { AUTH_PASSWORD: 'synthetic-access', FINANCE_MEMORY: {}, ASSETS: { fetch: async () => { throw new Error('Unauthenticated requests must not reach assets'); } } };
  for (const headers of [{}, { Accept: 'text/html,application/xhtml+xml' }, { 'Sec-Fetch-Mode': 'navigate' }]) {
    const response = await worker.fetch(new Request('https://test.invalid/', { headers }), env, {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /id="p" type="password"/);
    assert.match(html, /localStorage.getItem\('auth_token'\)/);
    assert.match(html, /fiscus-auth-renewed/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  for (const path of ['/api/account/me', '/api/expenses/private', '/ui/unknown/index.js']) {
    const response = await worker.fetch(new Request('https://test.invalid' + path, { headers: { Accept: 'application/json' } }), env, {});
    assert.equal(response.status, 401);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
  }
  const apiNavigation = await worker.fetch(new Request('https://test.invalid/api/account/me', { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } }), env, {});
  assert.equal(apiNavigation.status, 401);
});
