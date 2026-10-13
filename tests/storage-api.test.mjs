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

async function manualSession(t, username = 'manual') {
  const fixture = await setup(t);
  const registry = fixture.env.USER_REGISTRY.get(fixture.env.USER_REGISTRY.idFromName('global'));
  await registry.register(username, 'password');
  const { createSession } = await loadWorker('worker/recovered/live-backend.mjs');
  const session = await createSession(fixture.db, username, username);
  const token = await deriveToken(fixture.env.AUTH_PASSWORD);
  return { ...fixture, registry, request: (path, method = 'GET', body) => fixture.call(path, method, body, { Authorization: 'Bearer ' + token, Cookie: 'account_session=' + session.token }) };
}
const manualBody = { userId: 'user_manual', amount: 123.45, merchant: 'Salary', description: 'October payment', category: 'Income', type: 'income', date: '2026-08-31', idempotencyKey: 'manual-mutation-001' };

test('manual entries preserve date and income, authenticate author, and deduplicate retries without changing records', async t => {
  const { db, request } = await manualSession(t);
  const body = { ...manualBody, memberId: 'spoofed', memberName: 'Spoofed' };
  const responses = await Promise.all([request('/api/expenses', 'POST', body), request('/api/expenses', 'POST', body)]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(results[0].expense.id, results[1].expense.id);
  assert.equal(results[0].expense.date, body.date);
  assert.equal(results[0].expense.type, 'income');
  assert.equal(results[0].expense.byId, 'manual');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count, 1);
  assert.equal((await request('/api/expenses', 'POST', { ...body, amount: 200 })).status, 409);
  assert.equal((await request('/api/expenses', 'POST', { ...body, userId: 'user_someone_else' })).status, 403);
  const id = results[0].expense.id;
  assert.equal((await request('/api/expenses/user_manual/' + id, 'DELETE')).status, 200);
  assert.equal((await request('/api/expenses', 'POST', body)).status, 409, 'a retry cannot resurrect a deleted entry');
  const restored = await (await request('/api/recycle-bin/' + id + '/restore?scope=user_manual', 'POST')).json();
  assert.equal(restored.success, true);
  assert.deepEqual(restored.expense, results[0].expense, 'Undo restores every original field and ID');
});

test('invalid manual input never writes a record', async t => {
  const { db, request } = await manualSession(t);
  for (const invalid of [{ amount: 0 }, { amount: -1 }, { amount: 1.001 }, { amount: 'NaN' }, { date: '2026-02-30' }, { type: 'other' }, { merchant: '', description: '' }, { merchant: 'x'.repeat(161) }, { idempotencyKey: 'short' }]) {
    assert.equal((await request('/api/expenses', 'POST', { ...manualBody, ...invalid })).status, 400, JSON.stringify(invalid));
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count, 0);
});

test('a family viewer cannot create manual entries, while a contributor can', async t => {
  const { registry, request } = await manualSession(t);
  await registry.register('owner', 'password');
  const { family } = await registry.createFamily('owner');
  await registry.joinFamily('manual', family.code);
  await registry.setMemberRole('owner', 'manual', 'viewer');
  const body = { ...manualBody, userId: family.scopeId };
  assert.equal((await request('/api/expenses', 'POST', body)).status, 403);
  await registry.setMemberRole('owner', 'manual', 'contributor');
  assert.equal((await request('/api/expenses', 'POST', body)).status, 200);
});

test('the deployed report and chat routes use the DeepSeek adapter while retaining scoped D1 data', async t => {
  const { env, db, request } = await manualSession(t);
  assert.equal((await request('/api/expenses', 'POST', manualBody)).status, 200);
  env['DEEPSEEK-API-KEY'] = 'synthetic-integration-key';
  env.AI_PROVIDER = 'deepseek';
  t.mock.method(console, 'info', () => {});
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-integration-key');
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.model, 'deepseek-flash');
    const system = body.messages[0].content;
    const content = system.includes('classify user intent') ? '{"intent":"ADD_EXPENSE","confidence":1}' : system.includes('transaction-parsing engine') ? '{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}' : 'Synthetic monthly analysis';
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
  });
  const report = await (await request('/api/report', 'POST', { userId: 'user_manual', month: '2026-08' })).json();
  assert.equal(report.report, 'Synthetic monthly analysis');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count, 1, 'analysis never modifies records');
  const chat = await (await request('/api/voice-command', 'POST', { userId: 'user_manual', input: '今天买咖啡花了25元', idempotencyKey: 'synthetic-chat-key-001' })).json();
  assert.equal(chat.success, true);
  assert.equal(chat.data.expense.amount, 25);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count, 2);
  assert.equal(calls.length, 2, 'one report call and one parsing call for a clear entry');
  assert.equal(JSON.stringify({ report, chat }).includes('synthetic-integration-key'), false);
  assert.equal((await request('/api/report', 'POST', { userId: 'user_someone_else', month: '2026-08' })).status, 403);
  assert.equal(calls.length, 2, 'unauthorized scopes never reach either AI provider');
});

test('monthly, weekly and chat analysis use DeepSeek while chat entry remains on Workers AI', async t => {
  const { env, db, request } = await manualSession(t);
  assert.equal((await request('/api/expenses', 'POST', manualBody)).status, 200);
  env['DEEPSEEK-API-KEY'] = 'synthetic-analysis-key';
  let workerCalls = 0, deepseekCalls = 0;
  env.AI = { async run(model, options) {
    workerCalls++;
    const system = options.messages[0].content;
    assert.ok(!options.financeTask, 'analysis must never reach Workers AI in this configuration');
    if (system.includes('classify user intent')) return { response: JSON.stringify({ intent: options.messages[1].content.includes('USER INPUT: "这个月花了多少钱"') ? 'QUERY' : 'ADD_EXPENSE', confidence: 1 }) };
    assert.ok(system.includes('transaction-parsing engine'));
    return { response: '{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}' };
  } };
  t.mock.method(console, 'info', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.financeTask, undefined);
    deepseekCalls++;
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Synthetic summary and suggestion' } }] });
  });
  const month = await (await request('/api/report', 'POST', { userId: 'user_manual', month: '2026-08' })).json();
  assert.equal(month.report, 'Synthetic summary and suggestion');
  const week = await (await request('/api/report/weekly-insights', 'POST', { userId: 'user_manual', weekStart: '2026-08-31' })).json();
  assert.equal(week.report, 'Synthetic summary and suggestion');
  const answer = await (await request('/api/voice-command', 'POST', { userId: 'user_manual', input: '这个月花了多少钱' })).json();
  assert.equal(answer.message, 'Synthetic summary and suggestion');
  assert.equal(deepseekCalls, 3);
  assert.equal(workerCalls, 0, 'clear queries skip intent classification');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count, 1);
  const entry = await (await request('/api/voice-command', 'POST', { userId: 'user_manual', input: '今天买咖啡花了25元', idempotencyKey: 'mixed-provider-entry-001' })).json();
  assert.equal(entry.success, true);
  assert.equal(entry.data.expense.amount, 25);
  assert.equal(workerCalls, 1);
  assert.equal(deepseekCalls, 3, 'record commands never call DeepSeek');
});

test('resend replaces only its own AI reply and rejects superseded attempts across reloads', async t => {
  const { db, request } = await manualSession(t);
  const user = { id:'resend-message-0001', role:'user', content:'这个月花了多少钱', timestamp:10, clientMutationId:'resend-message-0001', requestId:'attempt-request-0001', attemptNo:1 };
  const post = body => request('/api/chat/user_manual','POST',body);
  assert.equal((await post(user)).status,200);
  const reply={id:'reply:'+user.id,role:'ai',replyTo:user.id,requestId:user.requestId,attemptNo:1,content:'Original answer',timestamp:11};
  assert.equal((await post(reply)).status,200);
  assert.equal((await post({...user,requestId:'attempt-request-0002',attemptNo:2})).status,200);
  assert.equal((await post({...reply,content:'Late obsolete answer'})).status,409);
  assert.equal((await post({...user,requestId:'outdated-request-0003'})).status,409);
  assert.equal((await post({...reply,requestId:'attempt-request-0002',attemptNo:2,content:'Replacement answer',timestamp:12})).status,200);
  const chat=await (await request('/api/chat/user_manual')).json();
  assert.equal(chat.messages.length,2);
  assert.equal(chat.messages.filter(message=>message.role==='user').length,1);
  assert.equal(chat.messages.find(message=>message.role==='ai').content,'Replacement answer');
  const history=await db.prepare("SELECT value_json FROM app_scope_metadata WHERE key LIKE 'superseded-chat:%'").all();
  assert.ok(history.results.some(row=>JSON.parse(row.value_json).content==='Original answer'));
  assert.equal((await post({...user,content:'Changed money amount',requestId:'attempt-request-0004',attemptNo:3})).status,409);
  await db.prepare('INSERT INTO app_chat_messages(scope,id,timestamp,record_json) VALUES(?,?,?,?)').bind('user_manual','other-author-0001',1,JSON.stringify({...user,id:'other-author-0001',byId:'someone_else'})).run();
  assert.equal((await post({...user,id:'other-author-0001'})).status,403);
});

test('concurrent resend and later retries reuse a durable command receipt, including after deletion', async t => {
  const { env, db, request } = await manualSession(t);
  let release, calls=0;const gate=new Promise(resolve=>{release=resolve;});
  env.AI={async run(){calls++;await gate;return {response:'{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}'};}};
  const body={userId:'user_manual',input:'今天买咖啡花了25元',commandId:'safe-command-0001'};
  const first=request('/api/voice-command','POST',body);
  while(!calls)await new Promise(resolve=>setTimeout(resolve,5));
  const second=request('/api/voice-command','POST',{...body,resend:true});
  release();
  const results=await Promise.all([first,second]);
  assert.ok(results.every(response=>response.status===200));
  const payloads=await Promise.all(results.map(response=>response.json()));
  assert.equal(payloads[0].data.expense.id,payloads[1].data.expense.id);
  assert.equal(calls,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,1);
  const third=await (await request('/api/voice-command','POST',{...body,resend:true})).json();
  assert.equal(third.data.expense.id,payloads[0].data.expense.id);
  assert.equal(calls,1);
  await request('/api/expenses/user_manual/'+third.data.expense.id,'DELETE');
  await request('/api/voice-command','POST',{...body,resend:true});
  assert.deepEqual((await (await request('/api/expenses/user_manual')).json()).expenses,[]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,1);
  assert.equal((await request('/api/voice-command','POST',{...body,input:'Changed input'})).status,409);
});

test('legacy resend and an uncertain interrupted command cannot create or repeat financial records', async t => {
  const { db, env, request } = await manualSession(t);
  let calls=0;env.AI={async run(){calls++;throw new Error('Unexpected AI call');}};
  const id='legacy-message-0001';
  await db.prepare('INSERT INTO app_chat_messages(scope,id,timestamp,record_json) VALUES(?,?,?,?)').bind('user_manual',id,1,JSON.stringify({id,role:'user',content:'今天买咖啡花了25元',timestamp:1,byId:'manual'})).run();
  const prepared=await (await request('/api/chat/user_manual','POST',{id,role:'user',content:'今天买咖啡花了25元',requestId:'legacy-attempt-0001',attemptNo:1})).json();
  assert.equal(prepared.legacyResend,true);
  assert.equal((await request('/api/voice-command','POST',{userId:'user_manual',input:'今天买咖啡花了25元',commandId:id,resend:true})).status,200);
  assert.equal(calls,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,0);
  const key='chat-command:'+JSON.stringify(['manual','interrupted-command-0001']);
  await db.prepare('INSERT INTO app_scope_metadata(scope,key,value_json) VALUES(?,?,?)').bind('user_manual',key,JSON.stringify({input:'今天买咖啡花了25元',state:'running'})).run();
  const interrupted=await (await request('/api/voice-command','POST',{userId:'user_manual',input:'今天买咖啡花了25元',commandId:'interrupted-command-0001',resend:true})).json();
  assert.equal(interrupted.needsReview,true);
  assert.equal(calls,0);
});

test('fast routing recognizes clear entries and queries but keeps destructive or hypothetical messages safe', async () => {
  const {detectFastIntent}=await loadWorker('worker/recovered/live-backend.mjs');
  for(const input of ['今天买咖啡花了25元','Coffee 25','午饭30'])assert.equal(detectFastIntent(input),'ADD_EXPENSE');
  for(const input of ['这个月花了多少钱','建议我如何减少支出','Should I delete this expense?'])assert.equal(detectFastIntent(input),'QUERY');
  for(const input of ['删除咖啡记录','每月房租2000','I will buy a watch for 200','October 2026'])assert.equal(detectFastIntent(input),null);
});

test('resending a linked legacy entry returns its saved record without another AI call or financial write', async t => {
  const {env,db,request}=await manualSession(t);let calls=0;
  env.AI={async run(){calls++;return {response:'{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}'};}};
  const input='今天买咖啡花了25元';
  const result=await (await request('/api/voice-command','POST',{userId:'user_manual',input,idempotencyKey:'legacy-original-command'})).json();
  const user={id:'legacy-linked-user-001',role:'user',content:input,timestamp:1,byId:'manual'};
  await request('/api/chat/user_manual','POST',user);
  await request('/api/chat/user_manual','POST',{id:'legacy-linked-reply-001',role:'ai',content:'Original confirmation',timestamp:2,expense:result.data.expense});
  await request('/api/chat/user_manual','POST',{...user,attemptNo:1,requestId:'legacy-new-attempt-001'});
  const repeated=await (await request('/api/voice-command','POST',{userId:'user_manual',input,commandId:user.id,resend:true})).json();
  assert.equal(repeated.data.expense.id,result.data.expense.id);
  assert.equal(calls,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,1);
});

test('legacy queued retries cannot resurrect a soft-deleted expense', async t => {
  const {env,db,request}=await manualSession(t);
  env.AI={async run(){return {response:'{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}'};}};
  const body={userId:'user_manual',input:'今天买咖啡花了25元',idempotencyKey:'legacy-queued-command-001'};
  const first=await (await request('/api/voice-command','POST',body)).json();
  await request('/api/expenses/user_manual/'+first.data.expense.id,'DELETE');
  const retry=await (await request('/api/voice-command','POST',body)).json();
  assert.equal(retry.success,true);
  assert.equal(retry.data?.expense,undefined);
  assert.deepEqual((await (await request('/api/expenses/user_manual')).json()).expenses,[]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,1);
});

test('AI timeout retry is safe to re-execute and keeps the original message date', async t => {
  const {env,db,request}=await manualSession(t);let calls=0;
  env.AI={async run(){calls++;if(calls===1)throw new Error('AI response timed out');return {response:'{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}'};}};
  const user={id:'timeout-retry-user-001',role:'user',content:'Coffee 25',timestamp:Date.parse('2026-08-31T10:00:00Z'),attemptNo:1,requestId:'timeout-attempt-0001'};
  assert.equal((await request('/api/chat/user_manual','POST',user)).status,200);
  const body={userId:'user_manual',input:user.content,commandId:user.id};
  const timed=await request('/api/voice-command','POST',body);assert.equal(timed.status,400);
  assert.equal((await timed.json()).safeToRetry,true);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,0,'a timeout never books a guessed amount');
  const retry=await (await request('/api/voice-command','POST',{...body,resend:true})).json();
  assert.equal(retry.success,true);assert.equal(retry.data.expense.date,'2026-08-31');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,1);
  assert.equal(calls,2);
});

test('resend reads an edited saved record instead of returning stale financial fields', async t => {
  const {env,request}=await manualSession(t);let calls=0;
  env.AI={async run(){calls++;return {response:'{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}'};}};
  const body={userId:'user_manual',input:'今天买咖啡花了25元',commandId:'edited-resend-command-001'};
  const first=await (await request('/api/voice-command','POST',body)).json();
  await request('/api/expenses/user_manual/'+first.data.expense.id,'PATCH',{amount:35,merchant:'Edited coffee'});
  const retry=await (await request('/api/voice-command','POST',{...body,resend:true})).json();
  assert.equal(retry.data.expense.amount,35);assert.equal(retry.data.expense.merchant,'Edited coffee');assert.equal(calls,1);
});

test('a family legacy receipt is linked only when its expense belongs to the sender and matches the message', async t => {
  const {env,registry,request}=await manualSession(t);
  await registry.register('owner','password');const {family}=await registry.createFamily('owner');await registry.joinFamily('manual',family.code);
  let calls=0;env.AI={async run(){calls++;return {response:'{"type":"expense","amount":25,"merchant":"Coffee","category":"Food & Dining"}'};}};
  const input='今天买咖啡花了25元';
  const first=await (await request('/api/voice-command','POST',{userId:family.scopeId,input,memberId:'manual',idempotencyKey:'family-legacy-command-001'})).json();
  const user={id:'family-legacy-user-001',role:'user',content:input,timestamp:1,byId:'manual'};
  await request('/api/chat/'+family.scopeId,'POST',user);
  await request('/api/chat/'+family.scopeId,'POST',{id:'family-legacy-reply-001',role:'ai',content:'Saved',timestamp:2,expense:first.data.expense});
  const prepared=await (await request('/api/chat/'+family.scopeId,'POST',{...user,requestId:'family-attempt-0001',attemptNo:1})).json();
  assert.equal(prepared.supersededReplyId,'family-legacy-reply-001');
  const retry=await (await request('/api/voice-command','POST',{userId:family.scopeId,input,commandId:user.id,resend:true})).json();
  assert.equal(retry.data.expense.id,first.data.expense.id);assert.equal(calls,1);
});

test('a failed command receipt is reconciled with saved data without rerunning its financial action', async t => {
  const {env,db,request}=await manualSession(t);let calls=0;env.AI={async run(){calls++;throw new Error('Must not rerun');}};
  const commandId='failed-receipt-command-001',input='Original salary entry';
  const saved=await (await request('/api/expenses','POST',{...manualBody,idempotencyKey:commandId})).json();
  const key='chat-command:'+JSON.stringify(['manual',commandId]);
  await db.prepare('INSERT INTO app_scope_metadata(scope,key,value_json) VALUES(?,?,?)').bind('user_manual',key,JSON.stringify({input,state:'done',result:{status:500,body:{success:false,commandKind:'ADD_EXPENSE'}}})).run();
  const result=await (await request('/api/voice-command','POST',{userId:'user_manual',input,commandId,resend:true})).json();
  assert.equal(result.success,true);assert.equal(result.data.expense.id,saved.expense.id);assert.equal(calls,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,1);
});

test('Chinese shorthand and financial summaries route without a classifier call', async () => {
  const {detectFastIntent,classifyIntent}=await loadWorker('worker/recovered/live-backend.mjs');
  const forbidden={run(){throw new Error('Classification should be skipped');}};
  for(const input of ['午餐25','今天打车45','记账买手表5900','午饭花30','昨天奶茶18元','今天收入300']) {
    assert.equal(detectFastIntent(input),'ADD_EXPENSE',input);
    assert.equal(await classifyIntent(forbidden,input),'ADD_EXPENSE',input);
  }
  for(const input of ['本月消费情况','最近收支','这个月账单']) assert.equal(await classifyIntent(forbidden,input),'QUERY',input);
  for(const input of ['你好','帮助','hello']) assert.equal(await classifyIntent(forbidden,input),'HELP',input);
  for(const input of ['预算午餐25','计划买手表5900','删除午餐25','每月房租2000','2026年10月13日']) assert.equal(detectFastIntent(input),null,input);
});

test('intent names are normalized and invalid or unknown classifier results use safe fallback', async () => {
  const {classifyIntent}=await loadWorker('worker/recovered/live-backend.mjs');
  const ai=intent=>({async run(){return {response:JSON.stringify({intent})};}});
  assert.equal(await classifyIntent({async run(){throw new Error('AI response timed out');}},'查一下账本'),'QUERY');
  assert.equal(await classifyIntent({async run(){return {response:'{broken JSON'};}},'查一下账本'),'QUERY');
  assert.equal(await classifyIntent(ai(' query '),'我的餐饮开销怎么样'),'QUERY');
  assert.equal(await classifyIntent(ai('delete expense'),'删除上一笔'),'DELETE_EXPENSE');
  for(const intent of ['UNKNOWN','nonsense',null,{}]) {
    assert.equal(await classifyIntent(ai(intent),'查一下账本'),'QUERY');
    assert.equal(await classifyIntent(ai(intent),'随便聊聊'),'UNKNOWN');
  }
});

test('ambiguous messages receive useful clarification without writing financial records', async t => {
  const {env,db,request}=await manualSession(t);
  env.AI={async run(){return {response:'{"intent":"nonsense"}'};}};
  const result=await (await request('/api/voice-command','POST',{userId:'user_manual',input:'随便聊聊'})).json();
  assert.equal(result.success,true);
  assert.match(result.message,/项目和金额/);
  assert.doesNotMatch(result.message,/我没太理解/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM expenses').first()).count,0);
});
