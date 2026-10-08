import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { loadWorker, sqliteDatabase, legacyContext } from './helpers/runtime.mjs';

const { default: app } = await loadWorker('worker/index.ts');
const { deriveToken } = await loadWorker('worker/auth.ts');
const { UserRegistry } = await loadWorker('worker/durable-objects/UserRegistry.ts');
const { FinanceMemory } = await loadWorker('worker/durable-objects/FinanceMemory.ts');

async function setup(t) {
  const db = await sqliteDatabase(t);
  const contexts = new Map();
  const instances = new Map();
  const env = { DB: db, AUTH_PASSWORD: 'test-only-app-password', STORAGE_MIGRATION_TOKEN: 'test-only-admin-token', APP_STORAGE_MODE: 'd1' };
  function namespace(Class, prefix) {
    return {
      idFromName(name) { return { name, toString: () => createHash('sha256').update(prefix + ':' + name).digest('hex') }; },
      idFromString(id) { return { toString: () => id }; },
      get(id) {
        const key = id.toString();
        if (!instances.has(key)) {
          const ctx = contexts.get(key) ?? legacyContext(key);
          contexts.set(key, ctx);
          instances.set(key, new Class(ctx, env));
        }
        return instances.get(key);
      },
    };
  }
  env.USER_REGISTRY = namespace(UserRegistry, 'registry');
  env.FINANCE_MEMORY = namespace(FinanceMemory, 'finance');
  const token = await deriveToken(env.AUTH_PASSWORD);
  async function call(path, method = 'GET', body, headers = { Authorization: 'Bearer ' + token }) {
    return app.fetch(new Request('https://test.invalid' + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, { waitUntil() {} });
  }
  return { db, env, call, contexts };
}

test('admin migration requires its own secret and does not expose private records', async (t) => {
  const { env, call } = await setup(t);
  assert.equal((await call('/api/admin/storage-migration')).status, 401);
  assert.equal((await call('/api/admin/storage-migration', 'GET', undefined, { 'X-Storage-Migration-Token': 'wrong' })).status, 401);
  const admin = { 'X-Storage-Migration-Token': env.STORAGE_MIGRATION_TOKEN };
  assert.equal((await call('/api/admin/storage-migration', 'POST', { action: 'registry' }, admin)).status, 200);
  const status = await (await call('/api/admin/storage-migration', 'GET', undefined, admin)).json();
  assert.equal(status.accounts, 0);
  assert.ok(status.migrations.some((entry) => entry.migration_key === 'registry-v1'));
  assert.equal(JSON.stringify(status).includes('passHash'), false);
  assert.equal((await call('/api/admin/storage-migration', 'POST', { action: 'archive', objectId: 'bad-id' }, admin)).status, 400);
  delete env.STORAGE_MIGRATION_TOKEN;
  assert.equal((await call('/api/admin/storage-migration', 'GET', undefined, admin)).status, 503);
});

test('expense PATCH returns saved data, and cleared expenses stay cleared after legacy migration', async (t) => {
  const { db, env, call, contexts } = await setup(t);
  await env.USER_REGISTRY.get(env.USER_REGISTRY.idFromName('global')).register('test', 'password');
  const { createSession } = await loadWorker('worker/recovered/live-backend.mjs');
  const session = await createSession(db, 'test', 'test');
  const token = await deriveToken(env.AUTH_PASSWORD);
  const authenticated = (path, method = 'GET', body) => call(path, method, body, { Authorization: 'Bearer ' + token, Cookie: 'account_session=' + session.token });
  const source = new Map([['expenses', [{ id: 'legacy-deleted', amount: 10 }]]]);
  const id = env.FINANCE_MEMORY.idFromName('user_test').toString();
  const ctx = legacyContext(id, source);
  contexts.set(id, ctx);
  await db.prepare('INSERT INTO expenses (id, scope, amount, category, date, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('e1', 'user_test', 10, 'Food', '2026-10-08', 1).run();
  const response = await authenticated('/api/expenses/user_test/e1', 'PATCH', { amount: 25, description: 'Edited' });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.expense.amount, 25);
  assert.equal(result.expense.description, 'Edited');
  assert.equal((await authenticated('/api/expenses/user_test', 'DELETE')).status, 200);
  assert.deepEqual((await (await authenticated('/api/expenses/user_test')).json()).expenses, []);
  assert.deepEqual((await (await authenticated('/api/expenses/user_test')).json()).expenses, []);
  ctx.assertUnchanged();
});

test('bootstrap returns the complete ledger beyond 100 records without leaking other scopes or deleted entries', async t => {
  const { db, env, call } = await setup(t);
  await env.USER_REGISTRY.get(env.USER_REGISTRY.idFromName('global')).register('test', 'password');
  const { createSession } = await loadWorker('worker/recovered/live-backend.mjs');
  const session = await createSession(db, 'test', 'test');
  const token = await deriveToken(env.AUTH_PASSWORD);
  for (let i = 0; i < 130; i++) {
    await db.prepare('INSERT INTO expenses (id, scope, amount, category, date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(`record-${i}`, 'user_test', 10, 'Food', i === 0 ? '2026-08-01' : '2026-10-08', i + 1).run();
  }
  await db.prepare('INSERT INTO expenses (id, scope, amount, category, date, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('other-ledger', 'user_other', 10, 'Food', '2026-08-01', 1).run();
  await db.prepare('INSERT INTO expenses (id, scope, amount, category, date, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('deleted', 'user_test', 10, 'Food', '2026-08-01', 1, 2).run();
  const response = await call('/api/bootstrap?limit=1', 'GET', undefined, { Authorization: 'Bearer ' + token, Cookie: 'account_session=' + session.token });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.expenses.length, 130, 'chat limit must not truncate ledger records');
  assert.ok(result.expenses.some(entry => entry.id === 'record-0' && entry.date === '2026-08-01'));
  assert.ok(result.expenses.every(entry => entry.id.startsWith('record-')));
});

test('chat API imports history before writes, retains new messages and does not restore cleared chats', async (t) => {
  const { db, env, call, contexts } = await setup(t);
  await env.USER_REGISTRY.get(env.USER_REGISTRY.idFromName('global')).register('test', 'password');
  const { createSession } = await loadWorker('worker/recovered/live-backend.mjs');
  const session = await createSession(db, 'test', 'test');
  const token = await deriveToken(env.AUTH_PASSWORD);
  const authenticated = (path, method = 'GET', body) => call(path, method, body, { Authorization: 'Bearer ' + token, Cookie: 'account_session=' + session.token });
  const id = env.FINANCE_MEMORY.idFromName('user_test').toString();
  const ctx = legacyContext(id, new Map([['chatMessages', [
    { id: 'old', role: 'user', content: 'Original history', timestamp: 1 },
  ]]]));
  contexts.set(id, ctx);
  assert.equal((await authenticated('/api/chat/user_test', 'POST', { id: 'new', role: 'ai', content: 'New history', timestamp: 2 })).status, 200);
  const messages = (await (await authenticated('/api/chat/user_test')).json()).messages;
  assert.deepEqual(messages.map((message) => message.id), ['old', 'new']);
  const paginated = await (await authenticated('/api/chat/user_test?limit=1')).json();
  assert.equal(paginated.hasMore, true);
  assert.equal(paginated.messages[0].id, 'new');
  assert.equal((await authenticated('/api/chat/user_test', 'DELETE')).status, 200);
  assert.deepEqual((await (await authenticated('/api/chat/user_test')).json()).messages, []);
  ctx.assertUnchanged();
});

test('existing account sessions remain valid after registry migration', async (t) => {
  const { db, env, call, contexts } = await setup(t);
  const passHash = createHash('sha256').update('alice:old-password').digest('hex');
  const account = { username: 'Alice', passHash, displayName: 'Original', emoji: '🌱', scopeId: 'user_alice', createdAt: 1 };
  const id = env.USER_REGISTRY.idFromName('global').toString();
  const ctx = legacyContext(id, new Map([['accounts', { alice: account }]]));
  contexts.set(id, ctx);
  const token = await deriveToken(env.AUTH_PASSWORD);
  const { createSession } = await loadWorker('worker/recovered/live-backend.mjs');
  const session = (await createSession(db, 'Alice', 'test')).token;
  const headers = { Authorization: 'Bearer ' + token, Cookie: 'account_session=' + session };
  const result = await (await call('/api/account/me', 'GET', undefined, headers)).json();
  assert.equal(result.success, true);
  assert.equal(result.account.displayName, 'Original');
  const login = await (await call('/api/account/login', 'POST', { username: 'Alice', password: 'old-password' })).json();
  assert.equal(login.success, true);
  assert.equal(login.token, undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM account_sessions').first()).count, 2);
  ctx.assertUnchanged();
});


test('maintenance freezes application requests while allowing authenticated migration and leaving sources unchanged', async (t) => {
  const { env, call } = await setup(t);
  env.APP_STORAGE_MODE = 'migration';
  for (const [path, method] of [['/api/account/me', 'GET'], ['/api/account/register', 'POST'], ['/api/expenses/user_test', 'DELETE']]) {
    const response = await call(path, method, method === 'GET' ? undefined : {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '30');
  }
  assert.equal((await call('/api/admin/storage-migration')).status, 401);
  const admin = { 'X-Storage-Migration-Token': env.STORAGE_MIGRATION_TOKEN };
  assert.equal((await call('/api/admin/storage-migration', 'POST', { action: 'registry' }, admin)).status, 200);
  const id = env.USER_REGISTRY.idFromName('global').toString();
  assert.equal((await call('/api/admin/storage-migration', 'POST', { action: 'archive-registry', objectId: id }, admin)).status, 200);
  const verification = await (await call('/api/admin/storage-migration', 'POST', { action: 'verify-registry', objectId: id }, admin)).json();
  assert.equal(verification.unchanged, true);
});

test('all 72 deployed routes remain available in the recovered backend', async () => {
  const { readFile } = await import('node:fs/promises');
  const expected = JSON.parse(await readFile(new URL('./fixtures/deployed-routes.json', import.meta.url)));
  const { liveApp } = await loadWorker('worker/recovered/live-backend.mjs');
  const actual = new Set(liveApp.routes.map(({ method, path }) => method + ' ' + path));
  assert.equal(expected.length, 72);
  for (const { method, path } of expected) assert.ok(actual.has(method + ' ' + path), method + ' ' + path);
});
