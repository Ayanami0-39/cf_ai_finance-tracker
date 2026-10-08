import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorker, sqliteDatabase, legacyContext } from './helpers/runtime.mjs';

const { migrateRegistry, migrateFinanceScope, archiveLegacyObject, migrationComplete, readLegacyStorage } = await loadWorker('worker/db/legacy-migration.ts');
const { UserRegistry } = await loadWorker('worker/durable-objects/UserRegistry.ts');
const { FinanceMemory } = await loadWorker('worker/durable-objects/FinanceMemory.ts');
const { d1GetChat, d1AddChat, d1ImportChat, d1ClearChat } = await loadWorker('worker/db/chat.ts');

async function hash(input) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Buffer.from(bytes).toString('hex');
}

async function fixture() {
  const account = (username, passHash) => ({ username, passHash, displayName: username + ' display', emoji: '🙂', scopeId: 'user_' + username.toLowerCase(), createdAt: 123 });
  const alice = account('Alice', await hash('alice:old-password'));
  const bob = account('Bob', await hash('bob:bob-password'));
  const family = { code: '234567', scopeId: 'family_original', ownerId: alice.scopeId, ownerUsername: 'alice', memberUsernames: ['alice', 'bob'], createdAt: 456 };
  return new Map([
    ['accounts', { alice, bob }], ['families', { '234567': family }],
    ['membership', { alice: '234567', bob: '234567' }], ['extra-legacy-key', { preserve: true }],
  ]);
}

const message = (id, timestamp = 10) => ({ id, role: 'user', content: 'Test ' + id, timestamp, by: 'Alice', byId: 'alice', parsedBy: 'ai' });

test('registry migration preserves hashes, profiles, families and all source keys; reruns are safe', async (t) => {
  const db = await sqliteDatabase(t);
  const source = await fixture();
  const ctx = legacyContext('registry-object', source);
  const registry = new UserRegistry(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  assert.equal((await registry.verify('ALICE', 'old-password')).ok, true);
  assert.equal((await registry.verify('Alice', 'wrong')).ok, false);
  assert.deepEqual(await registry.getProfile('Alice'), source.get('accounts').alice);
  const family = await registry.listFamilyMembers('bob');
  assert.deepEqual(family.family, source.get('families')['234567']);
  assert.equal(family.members.length, 2);
  assert.equal(family.members[0].isOwner, true);
  await migrateRegistry(db, 'registry-object', source);
  const archives = await db.prepare('SELECT key, value_json FROM app_legacy_snapshots').all();
  assert.equal(archives.results.length, source.size);
  for (const row of archives.results) assert.deepEqual(JSON.parse(row.value_json), source.get(row.key));
  assert.equal(await migrationComplete(db, 'registry-v1'), true);
  ctx.assertUnchanged();
});

test('registry conflicts roll back the entire migration without overwriting existing D1 data', async (t) => {
  const db = await sqliteDatabase(t);
  const existing = { protected: true };
  await db.prepare('INSERT INTO app_user_accounts VALUES (?, ?)').bind('bob', JSON.stringify(existing)).run();
  await assert.rejects(migrateRegistry(db, 'registry-object', await fixture()), /UNIQUE/);
  assert.deepEqual(JSON.parse((await db.prepare('SELECT record_json FROM app_user_accounts WHERE username_key = ?').bind('bob').first()).record_json), existing);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_user_accounts').first()).count, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_legacy_snapshots').first()).count, 0);
  assert.equal(await migrationComplete(db, 'registry-v1'), false);
});

test('profile/password edits affect only D1; existing login hashes remain compatible', async (t) => {
  const db = await sqliteDatabase(t);
  const ctx = legacyContext('registry-object', await fixture());
  const registry = new UserRegistry(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  assert.equal((await registry.updateProfile('alice', { displayName: 'New name', emoji: '🌱' })).ok, true);
  assert.equal((await registry.verify('alice', 'old-password')).account.displayName, 'New name');
  assert.equal((await registry.changePassword('alice', 'wrong', 'new-password')).ok, false);
  assert.equal((await registry.changePassword('alice', 'old-password', 'new-password')).ok, true);
  assert.equal((await registry.verify('alice', 'old-password')).ok, false);
  assert.equal((await registry.verify('alice', 'new-password')).ok, true);
  ctx.assertUnchanged();
});

test('concurrent account requests are serialized without losing registrations', async (t) => {
  const db = await sqliteDatabase(t);
  const registry = new UserRegistry(legacyContext('registry-object'), { DB: db, APP_STORAGE_MODE: 'd1' });
  const results = await Promise.all([
    registry.register('New', 'password'), registry.register('NEW', 'password'), registry.register('Other', 'password'),
  ]);
  assert.deepEqual(results.map((result) => result.ok), [true, false, true]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_user_accounts').first()).count, 2);
});

test('family code rotation preserves storage identity and all memberships; ownership transfer works', async (t) => {
  const db = await sqliteDatabase(t);
  const ctx = legacyContext('registry-object', await fixture());
  const registry = new UserRegistry(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  const rotated = await registry.regenerateFamilyCode('alice');
  assert.equal(rotated.ok, true);
  assert.equal(rotated.family.scopeId, 'family_original');
  assert.notEqual(rotated.family.code, '234567');
  assert.equal((await registry.getFamilyByCode('234567')).ok, false);
  assert.equal((await registry.listFamilyMembers('bob')).family.code, rotated.family.code);
  assert.equal((await registry.listFamilyMembers('alice')).family.code, rotated.family.code);
  assert.equal((await registry.leaveFamily('alice')).newOwner, 'bob');
  assert.equal((await registry.listFamilyMembers('bob')).members[0].isOwner, true);
  assert.equal((await registry.leaveFamily('bob')).dissolved, true);
  ctx.assertUnchanged();
});

test('removing someone in a different family does not corrupt their membership', async (t) => {
  const db = await sqliteDatabase(t);
  const registry = new UserRegistry(legacyContext('registry-object', await fixture()), { DB: db, APP_STORAGE_MODE: 'd1' });
  await registry.register('Carol', 'password');
  const created = await registry.createFamily('carol');
  assert.equal((await registry.removeFamilyMember('alice', 'carol')).ok, false);
  assert.equal((await registry.listFamilyMembers('carol')).family.code, created.family.code);
});

test('scope migration preserves all messages/metadata and leaves active D1 expenses untouched', async (t) => {
  const db = await sqliteDatabase(t);
  await db.prepare('INSERT INTO expenses (id, scope, amount, category, date, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('active', 'user_alice', 25, 'Food', '2026-10-08', 1).run();
  const source = new Map([
    ['chatMessages', Array.from({ length: 120 }, (_, i) => message('m' + i, i))],
    ['expenses', [{ id: 'old-deleted-expense', amount: 10 }]],
    ['familyMembers', [{ id: 'alice', name: 'Alice', emoji: '🙂' }]], ['unknown-key', { keep: true }],
  ]);
  const ctx = legacyContext('finance-object', source);
  const memory = new FinanceMemory(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  await memory.migrateToD1('user_alice');
  assert.equal((await d1GetChat(db, 'user_alice')).length, 120);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_legacy_snapshots').first()).count, 4);
  const expenses = (await db.prepare('SELECT * FROM expenses').all()).results;
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].id, 'active');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_scope_metadata').first()).count, 2);
  await d1ClearChat(db, 'user_alice');
  await memory.migrateToD1('user_alice');
  assert.deepEqual(await d1GetChat(db, 'user_alice'), []);
  ctx.assertUnchanged();
});

test('chat writes retain more than 100 messages, retries deduplicate and scopes stay isolated', async (t) => {
  const db = await sqliteDatabase(t);
  const messages = Array.from({ length: 125 }, (_, i) => message('m' + i, i));
  assert.equal(await d1ImportChat(db, 'personal', messages), 125);
  assert.equal(await d1ImportChat(db, 'personal', messages), 0);
  await d1AddChat(db, 'personal', { ...messages[0], content: 'Must not overwrite' });
  await d1AddChat(db, 'family', messages[0]);
  assert.equal((await d1GetChat(db, 'personal')).length, 125);
  assert.equal((await d1GetChat(db, 'personal'))[0].content, messages[0].content);
  await d1ClearChat(db, 'personal');
  assert.equal((await d1GetChat(db, 'family')).length, 1);
});

test('chat conflicts fail migration atomically instead of overwriting D1 messages', async (t) => {
  const db = await sqliteDatabase(t);
  const original = message('existing');
  await d1AddChat(db, 'personal', original);
  await assert.rejects(migrateFinanceScope(db, 'finance-object', 'personal', new Map([
    ['chatMessages', [message('new'), { ...original, content: 'Old content' }]],
  ])), /UNIQUE/);
  assert.deepEqual(await d1GetChat(db, 'personal'), [original]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_legacy_snapshots').first()).count, 0);
  assert.equal(await migrationComplete(db, 'finance-v1:finance-object'), false);
});

test('orphan objects can be archived before their scope is known, then migrated without losing snapshots', async (t) => {
  const db = await sqliteDatabase(t);
  const source = new Map([['chatMessages', [message('orphan')]], ['expenses', [{ id: 'legacy-only' }]]]);
  await archiveLegacyObject(db, 'orphan-object', source);
  await archiveLegacyObject(db, 'orphan-object', source);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM app_legacy_snapshots').first()).count, 2);
  await migrateFinanceScope(db, 'orphan-object', 'recovered-scope', source);
  assert.equal((await d1GetChat(db, 'recovered-scope')).length, 1);
  assert.equal((await db.prepare('SELECT scope FROM app_legacy_objects WHERE object_id = ?').bind('orphan-object').first()).scope, 'recovered-scope');
  assert.deepEqual(JSON.parse((await db.prepare("SELECT value_json FROM app_legacy_snapshots WHERE key = 'expenses'").first()).value_json), [{ id: 'legacy-only' }]);
});

test('legacy enumeration includes keys beyond the first storage page', async () => {
  const source = new Map(Array.from({ length: 1005 }, (_, i) => ['key-' + String(i).padStart(4, '0'), i]));
  const ctx = legacyContext('many-keys', source);
  assert.deepEqual(await readLegacyStorage(ctx.storage), source);
  ctx.assertUnchanged();
});

test('existing PBKDF2 hashes migrate verbatim and remain usable without resetting passwords or sessions', async (t) => {
  const { hashPbkdf2Password } = await loadWorker('worker/db/password-verification.ts');
  const db = await sqliteDatabase(t);
  const source = await fixture();
  const originalHash = await hashPbkdf2Password('alice', 'old-password');
  source.get('accounts').alice.passHash = originalHash;
  const ctx = legacyContext('registry-object', source);
  const registry = new UserRegistry(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  assert.equal((await registry.verify('Alice', 'old-password')).ok, true);
  assert.equal((await registry.getProfile('Alice')).passHash, originalHash);
  assert.equal((await registry.verify('Alice', 'wrong')).ok, false);
  assert.equal((await registry.changePassword('Alice', 'old-password', 'new-password')).ok, true);
  assert.match((await registry.getProfile('Alice')).passHash, /^pbkdf2\$/);
  assert.equal((await registry.verify('Alice', 'new-password')).ok, true);
  ctx.assertUnchanged();
});

test('financial accounts and other existing D1 tables are separate from login accounts', async (t) => {
  const db = await sqliteDatabase(t);
  await db.prepare('INSERT INTO accounts (id, scope, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').bind('bank', 'user_alice', 'Existing bank account').run();
  await db.prepare('INSERT INTO account_sessions (id, username, token_hash, created_at, expires_at) VALUES (?, ?, ?, 1, 9999999999999)').bind('session', 'alice', 'existing-session-hash').run();
  await migrateRegistry(db, 'registry-object', await fixture());
  assert.deepEqual((await db.prepare('SELECT id, scope, name FROM accounts').all()).results, [{ id: 'bank', scope: 'user_alice', name: 'Existing bank account' }]);
  assert.deepEqual((await db.prepare('SELECT id, username, token_hash FROM account_sessions').all()).results, [{ id: 'session', username: 'alice', token_hash: 'existing-session-hash' }]);
});

test('viewer roles survive migration and cannot be changed by another viewer', async (t) => {
  const db = await sqliteDatabase(t);
  const source = await fixture();
  source.get('families')['234567'].memberRoles = { alice: 'admin', bob: 'viewer' };
  const ctx = legacyContext('registry-object', source);
  const registry = new UserRegistry(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  assert.equal((await registry.getMemberRole('bob')).role, 'viewer');
  assert.equal((await registry.setMemberRole('bob', 'alice', 'viewer')).ok, false);
  assert.equal((await registry.setMemberRole('alice', 'bob', 'contributor')).ok, true);
  assert.equal((await registry.getMemberRole('bob')).role, 'contributor');
  ctx.assertUnchanged();
});

test('recurring alarms recover their scope after restart, write D1 history and deduplicate charges', async (t) => {
  const db = await sqliteDatabase(t);
  const ctx = legacyContext('alarm-object');
  const env = { DB: db, APP_STORAGE_MODE: 'd1' };
  const memory = new FinanceMemory(ctx, env);
  await memory.migrateToD1('user_alarm');
  await db.prepare('INSERT INTO recurring_expenses (id, scope, name, amount, category, day_of_month, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('subscription', 'user_alarm', 'Test subscription', 9, 'Other', 1, 1, 1).run();
  const restarted = new FinanceMemory(ctx, env);
  await restarted.alarm();
  await restarted.alarm();
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses WHERE scope = ?').bind('user_alarm').first()).count, 1);
  assert.equal((await d1GetChat(db, 'user_alarm')).length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE scope = ?').bind('user_alarm').first()).count, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses WHERE scope = ?').bind('default').first()).count, 0);
  ctx.assertUnchanged();
});

test('old backup restore cannot overwrite current accounts or resurrect financial records', async (t) => {
  const db = await sqliteDatabase(t);
  const source = await fixture();
  const ctx = legacyContext('registry-object', source);
  const registry = new UserRegistry(ctx, { DB: db, APP_STORAGE_MODE: 'd1' });
  await registry.updateProfile('alice', { displayName: 'Current' });
  const { writeDoStorageBackup } = await loadWorker('worker/recovered/live-backend.mjs');
  await writeDoStorageBackup(db, 'UserRegistry', 'global', Object.fromEntries(source));
  await registry.restoreStorageFromBackup();
  assert.equal((await registry.getProfile('alice')).displayName, 'Current');
  const financeCtx = legacyContext('finance-object');
  const memory = new FinanceMemory(financeCtx, { DB: db, APP_STORAGE_MODE: 'd1' });
  await memory.migrateToD1('user_alice');
  await writeDoStorageBackup(db, 'FinanceMemory', 'user_alice', { expenses: [{ id: 'deleted', amount: 7 }], chatMessages: [message('old')] });
  await memory.addChatMessage({ ...message('old'), content: 'Current' });
  await memory.restoreStorageFromBackup();
  assert.equal((await memory.getChatMessages())[0].content, 'Current');
  assert.deepEqual(await memory.getExpenses(), []);
  ctx.assertUnchanged();
  financeCtx.assertUnchanged();
});
