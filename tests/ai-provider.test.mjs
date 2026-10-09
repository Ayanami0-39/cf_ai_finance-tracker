import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWorker } from './helpers/runtime.mjs';

const { financeAI } = await loadWorker('worker/ai/provider.ts');
const { extractAiText } = await loadWorker('worker/ai/extract-ai-text.ts');
const model = '@cf/zai-org/glm-4.7-flash';
const request = { messages: [{ role: 'user', content: 'Synthetic coffee entry' }], max_tokens: 4000, chat_template_kwargs: { enable_thinking: false } };
const env = { 'DEEPSEEK-API-KEY': 'test-only-key' };

test('without the DeepSeek secret, the original Workers AI binding is preserved', () => {
  const original = { run() {} };
  assert.equal(financeAI({ AI: original }), original);
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
