import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../worker/db/expenses.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { d1UpdateExpense } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

// Execute the helper's real SQL against disposable, in-memory SQLite only.
function database() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              calls.push({ sql, values });
              const result = spawnSync('python3', ['-c', `
import json, sqlite3, sys
sql, values = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('CREATE TABLE expenses (id TEXT, scope TEXT, amount REAL, category TEXT, merchant TEXT, description TEXT, date TEXT, created_at INTEGER, type TEXT, by TEXT, by_id TEXT, parsed_by TEXT)')
db.execute('INSERT INTO expenses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ('expense-1', 'personal', 10, 'Food', 'Old shop', 'Old description', '2026-10-01', 123, 'expense', 'Owner', 'owner-id', 'ai'))
row = db.execute(sql, values).fetchone()
print(json.dumps(dict(row) if row else None))
`], { input: JSON.stringify([sql, values]), encoding: 'utf8' });
              assert.equal(result.status, 0, result.stderr);
              return JSON.parse(result.stdout);
            },
          };
        },
      };
    },
  };
}

test('edits return saved fields and preserve identity and account attribution', async () => {
  const db = database();
  const result = await d1UpdateExpense(db, 'personal', 'expense-1', {
    amount: 25, date: '2026-10-08', type: 'income', category: 'Salary',
    merchant: '', description: 'Updated description',
  });
  assert.deepEqual(result, {
    id: 'expense-1', amount: 25, date: '2026-10-08', type: 'income',
    category: 'Salary', merchant: undefined, description: 'Updated description',
    createdAt: 123, by: 'Owner', byId: 'owner-id', parsedBy: 'ai',
  });
  assert.equal(db.calls.length, 1);
});

test('partial edits preserve omitted fields', async () => {
  const result = await d1UpdateExpense(database(), 'personal', 'expense-1', { amount: 0 });
  assert.equal(result.amount, 0);
  assert.equal(result.merchant, 'Old shop');
  assert.equal(result.category, 'Food');
  assert.equal(result.description, 'Old description');
});

test('missing expenses and expenses belonging to another scope return null', async () => {
  assert.equal(await d1UpdateExpense(database(), 'personal', 'missing', { amount: 25 }), null);
  assert.equal(await d1UpdateExpense(database(), 'other-account', 'expense-1', { amount: 25 }), null);
});

test('empty edits do not access storage', async () => {
  const db = database();
  assert.equal(await d1UpdateExpense(db, 'personal', 'expense-1', {}), null);
  assert.equal(db.calls.length, 0);
});
