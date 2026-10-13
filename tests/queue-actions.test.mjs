import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const source = await readFile(new URL('../frontend/refinements/entry-tools.js', import.meta.url), 'utf8');
function runtime() {
  const rows = new Map(), events = [], window = new EventTarget();
  window.FiscusUI = { translate: value => value };
  window.addEventListener('fiscus:sync-failed', event => events.push(event.detail));
  const context = vm.createContext({ window, Event, CustomEvent, Date, Map, Set, Promise, crypto: { randomUUID },
    setTimeout: () => 1, clearTimeout() {}, Yi: { username: 'owner', scopeId: 'personal' },
    Jo: () => ({ username: 'owner' }), An: 'queue',
    async kM(entry) { rows.set(entry.id, structuredClone(entry)); },
    async gd() { return { transaction() { return { objectStore() { return { getAll() { const request = {}; queueMicrotask(() => { request.result = [...rows.values()]; request.onsuccess(); }); return request; } }; } }; } }; },
  });
  vm.runInContext(source + '\nglobalThis.ledger=FiscusLedger;', context);
  return { ledger: context.ledger, rows, events, window };
}

test('queued edits, deletion and Undo overlay in order without altering another ledger', async () => {
  const { ledger, rows } = runtime();
  const expense = { id: 'original', amount: 25, date: '2026-08-31', merchant: 'Lunch' };
  await ledger.saveMutation('edit', 'personal', expense.id, { amount: 35 });
  await ledger.saveMutation('delete', 'personal', expense.id, undefined, { ...expense, amount: 35 });
  assert.equal(ledger.mergeExpenses([expense], 'personal', 'owner').length, 0);
  await ledger.saveMutation('restore', 'personal', expense.id, undefined, { ...expense, amount: 35 });
  assert.equal(ledger.mergeExpenses([expense], 'personal', 'owner')[0].amount, 35);
  assert.equal(ledger.mergeExpenses([expense], 'personal', 'owner')[0].date, '2026-08-31');
  assert.equal(ledger.mergeExpenses([expense], 'family', 'owner')[0].amount, 25);
  assert.equal(ledger.mergeExpenses([expense], 'personal', 'other')[0].amount, 25);
  const queued = [...rows.values()];
  assert.ok(queued[0].queuedAt < queued[1].queuedAt && queued[1].queuedAt < queued[2].queuedAt);
  assert.equal(new Set(queued.map(entry => entry.clientMutationId)).size, 3);
});

test('three failures persist a paused action and notify once before explicit retry', async () => {
  const { ledger, rows, events, window } = runtime();
  await ledger.saveMutation('edit', 'personal', 'record', { amount: 35 });
  const id = [...rows.keys()][0];
  for (let failure = 1; failure <= 3; failure++) {
    await ledger.retry(rows.get(id));
    assert.equal(rows.get(id).failures, failure);
    assert.equal(events.length, failure === 3 ? 1 : 0);
  }
  assert.equal(rows.get(id).syncState, 'failed');
  assert.equal(rows.get(id).patch.amount, 35);
  rows.set('foreign', { ...rows.get(id), id: 'foreign', scopeId: 'family' });
  window.dispatchEvent(new Event('fiscus:retry-failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows.get(id).failures, 0);
  assert.equal(rows.get(id).syncState, 'saved');
  assert.equal(rows.get('foreign').syncState, 'failed');
});
