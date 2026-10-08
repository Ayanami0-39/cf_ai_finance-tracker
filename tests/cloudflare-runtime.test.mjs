import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Resolve Wrangler's runtime dependency through its package, without adding a duplicate.
const require = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare } = require('miniflare');

test('Cloudflare RPC scope wrapper loads and saves chat and bootstrap without serializing stubs', async () => {
  const mf = new Miniflare({
    modules: true, scriptPath: new URL('../dist/cf_ai_finance_tracker/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-11-25', bindings: { AUTH_PASSWORD: 'test-only', APP_STORAGE_MODE: 'd1' },
    durableObjects: { FINANCE_MEMORY: { className: 'FinanceMemory', useSQLite: true }, USER_REGISTRY: { className: 'UserRegistry', useSQLite: true } },
    d1Databases: { DB: 'disposable-chat-regression' },
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const name of ['0001_expenses.sql', '0002_recurring.sql', '0003_budgets_audit.sql', '0004_consistency_features.sql', '0005_backup_dedup.sql', '0006_do_backups.sql', '20261008_d1_app_storage.sql']) {
      const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await db.exec(sql.replace(/--[^\n]*/g, '').replace(/\n/g, ' '));
    }
    const headers = { Authorization: 'Bearer ' + createHash('sha256').update('test-only::cf-ai-finance-tracker::auth-v1').digest('base64url'), 'Content-Type': 'application/json' };
    const call = (path, body) => mf.dispatchFetch('https://test.invalid' + path, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    const registered = await call('/api/account/register', { username: 'test', password: 'password' });
    assert.equal(registered.status, 200, await registered.clone().text());
    headers.Cookie = registered.headers.get('set-cookie').split(';')[0];
    await db.prepare('INSERT INTO app_chat_messages VALUES (?, ?, ?, ?)').bind('user_test', 'existing', 1, JSON.stringify({ id: 'existing', role: 'user', content: 'Preserved history', timestamp: 1 })).run();
    const chat = await call('/api/chat/user_test');
    assert.equal(chat.status, 200, await chat.clone().text());
    assert.equal((await chat.json()).messages[0].content, 'Preserved history');
    const saved = await call('/api/chat/user_test', { id: 'new', role: 'ai', content: 'New reply', timestamp: 2 });
    assert.equal(saved.status, 200, await saved.clone().text());
    const bootstrap = await call('/api/bootstrap');
    assert.equal(bootstrap.status, 200, await bootstrap.clone().text());
    assert.deepEqual((await bootstrap.json()).chat.messages.map(m => m.id), ['existing', 'new']);
  } finally { await mf.dispose(); }
});
