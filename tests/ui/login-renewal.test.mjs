import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { loadWorker } from '../helpers/runtime.mjs';
const { default: worker } = await loadWorker('worker/index.ts');
const { deriveToken } = await loadWorker('worker/auth.ts');

for (const engine of [chromium, ...(process.env.TEST_WEBKIT ? [webkit] : [])]) {
  test(engine.name() + ': saved access token renews a fresh tab without losing device data', async t => {
    const browser = await engine.launch(engine === chromium && existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {});
    t.after(() => browser.close());
    const page = await browser.newPage();
    const token = await deriveToken('synthetic-access');
    await page.addInitScript(token => { localStorage.setItem('auth_token', token); localStorage.setItem('pending-test-data', 'keep'); }, token);
    let renewals = 0;
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const env = { AUTH_PASSWORD: 'synthetic-access', FINANCE_MEMORY: {}, ASSETS: { fetch: async () => new Response('<html>original</html>', { headers: { 'Content-Type': 'text/html' } }) } };
    await page.route('https://finance.test/**', async route => {
      const request = route.request(), headers = await request.allHeaders();
      if (request.url().endsWith('/auth')) renewals++;
      const response = await worker.fetch(new Request(request.url(), { method: request.method(), headers, ...(request.postData() ? { body: request.postData() } : {}) }), env, {});
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto('https://finance.test/');
    await page.locator('#root input[type="password"]').first().waitFor();
    assert.ok(renewals >= 1 && renewals <= 2, 'renewal finishes without a reload loop');
    assert.equal(await page.evaluate(() => localStorage.getItem('pending-test-data')), 'keep');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fiscus-auth-renewed')), null);
    assert.deepEqual(errors, []);
    assert.ok((await page.context().cookies()).some(cookie => cookie.name === 'app_auth' && cookie.httpOnly));
  });
}
