import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorker } from './helpers/runtime.mjs';

const { financeAI } = await loadWorker('worker/ai/provider.ts');
const { extractAiText } = await loadWorker('worker/ai/extract-ai-text.ts');
const model = '@cf/zai-org/glm-4.7-flash';
const request = { messages: [{ role: 'user', content: 'Synthetic coffee entry' }], max_tokens: 4000, chat_template_kwargs: { enable_thinking: false } };
const env = { AI_PROVIDER: 'deepseek', 'DEEPSEEK-API-KEY': 'test-only-key' };

test('without the DeepSeek secret, analysis safely uses Workers AI without internal markers', async () => {
  const original = { async run(name, input) { assert.equal(name, model); assert.equal(input.financeTask, undefined); return { response: 'Workers AI' }; } };
  assert.deepEqual(await financeAI({ AI: original }).run(model, { ...request, financeTask: 'analysis' }), { response: 'Workers AI' });
});

test('the exact deployed secret name routes text calls to the verified Flash model without leaking it', async t => {
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.deepEqual(JSON.parse(options.body), { model: 'deepseek-flash', messages: request.messages, max_tokens: 600, thinking: { type: 'disabled' }, stream: false });
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"amount":25}' } }] });
  });
  const response = await financeAI(env).run(model, request);
  assert.equal(extractAiText(response), '{"amount":25}');
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(JSON.stringify(response).includes('test-only-key'), false);
  assert.equal(JSON.stringify(logs).includes('test-only-key'), false);
  assert.equal(JSON.stringify(logs).includes('Synthetic coffee entry'), false);
});

test('provider errors and incomplete outputs fail safely without slow cross-provider retries', async t => {
  t.mock.method(console, 'info', () => {});
  let cloudflareCalls = 0;
  const ai = financeAI({ ...env, AI: { run() { cloudflareCalls++; } } });
  for (const response of [new Response('private-provider-error', { status: 429 }), Response.json({ choices: [] }), Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"amount":' } }] })]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(ai.run(model, request), error => error.message === 'AI request unavailable' && !error.message.includes('private-provider-error'));
  }
  assert.equal(cloudflareCalls, 0);
});

test('a stalled provider request is aborted at 12 seconds', async t => {
  t.mock.method(console, 'info', () => {});
  let timerCallback, delay, cleared = false;
  t.mock.method(globalThis, 'setTimeout', (callback, duration) => { timerCallback = callback; delay = duration; return 123; });
  t.mock.method(globalThis, 'clearTimeout', id => { assert.equal(id, 123); cleared = true; });
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = financeAI(env).run(model, request);
  assert.equal(delay, 12000);
  timerCallback();
  await assert.rejects(pending, /AI request unavailable/);
  assert.equal(cleared, true);
});

test('non-finance models retain their original binding and classification keeps its small budget', async t => {
  t.mock.method(console, 'info', () => {});
  const original = { async run(name, input) { return { name, input }; } };
  const ai = financeAI({ ...env, AI: original });
  assert.deepEqual(await ai.run('other-model', { input: 'synthetic' }), { name: 'other-model', input: { input: 'synthetic' } });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.max_tokens, 50); assert.equal(body.temperature, 0.1);
    return Response.json({ choices: [{ message: { content: '{"intent":"ADD_EXPENSE"}' }, finish_reason: 'stop' }] });
  });
  await ai.run(model, { ...request, max_tokens: 50, temperature: 0.1 });
});

 test('Workers AI remains the default even when the DeepSeek secret is retained', async t => {
  const original = { async run() { return { response: 'Workers AI' }; } };
  t.mock.method(globalThis, 'fetch', () => { throw new Error('DeepSeek must not be called'); });
  for (const provider of [undefined, 'cloudflare']) {
    const ai = financeAI({ AI: original, AI_PROVIDER: provider, 'DEEPSEEK-API-KEY': 'retained-key' });
    assert.deepEqual(await ai.run(model, request), { response: 'Workers AI' });
  }
});

test('analysis is routed to DeepSeek while entry parsing stays on Workers AI', async t => {
  t.mock.method(console, 'info', () => {});
  const calls = [];
  const original = { async run(name, input) { calls.push({ name, input }); return { response: 'Workers AI' }; } };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(options.body).financeTask, undefined, 'internal routing marker stays server-side');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'DeepSeek summary and suggestion' } }] });
  });
  const ai = financeAI({ AI: original, 'DEEPSEEK-API-KEY': 'retained-key' });
  assert.deepEqual(await ai.run(model, request), { response: 'Workers AI' });
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await ai.run(model, { ...request, financeTask: 'analysis' }), { response: 'DeepSeek summary and suggestion' });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(calls.length, 1);
});

test('Workers AI has bounded waiting without allowing its late result to replace a timeout', async t => {
  let timeoutCallback, duration;
  t.mock.method(globalThis,'setTimeout',(callback,ms)=>{timeoutCallback=callback;duration=ms;return 123;});
  t.mock.method(globalThis,'clearTimeout',()=>{});
  let release;const late=new Promise(resolve=>{release=resolve;});
  const ai=financeAI({AI:{run(){return late;}}});
  const response=ai.run(model,{...request,max_tokens:50});
  assert.equal(duration,4500);
  timeoutCallback();
  await assert.rejects(response,/timed out/);
  release({response:'Late answer'});
});
