import type { Expense } from '../types/expense';

/**
 * D1 数据访问层：交易记录统一存 D1（scope 隔离个人/家庭数据）。
 * 行结构与 Expense 对象一一对应（snake_case 列 ↔ camelCase 字段），
 * 数值列（amount/by_id）存 NULL 表示"无此字段"，读取时转回 undefined。
 */

function rowToExpense(r: Record<string, unknown>): Expense {
  const e: Expense = {
    id: String(r.id),
    amount: Number(r.amount),
    category: String(r.category),
    merchant: r.merchant === null || r.merchant === undefined ? undefined : String(r.merchant),
    description: String(r.description ?? ''),
    date: String(r.date),
    createdAt: Number(r.created_at),
    type: r.type === 'income' ? 'income' : 'expense',
  };
  if (r.by !== null && r.by !== undefined) e.by = String(r.by);
  if (r.by_id !== null && r.by_id !== undefined) e.byId = String(r.by_id);
  if (r.parsed_by !== null && r.parsed_by !== undefined) e.parsedBy = String(r.parsed_by) as 'ai' | 'fallback';
  return e;
}

export async function d1GetExpenses(db: D1Database, scope: string): Promise<Expense[]> {
  const { results } = await db
    .prepare('SELECT * FROM expenses WHERE scope = ? ORDER BY date ASC, created_at ASC')
    .bind(scope)
    .all<Record<string, unknown>>();
  return (results || []).map(rowToExpense);
}

export async function d1AddExpense(db: D1Database, scope: string, e: Expense): Promise<void> {
  await db
    .prepare(
      `INSERT INTO expenses (id, scope, amount, category, merchant, description, date, created_at, type, by, by_id, parsed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      e.id, scope, e.amount, e.category, e.merchant ?? null, e.description,
      e.date, e.createdAt, e.type ?? 'expense', e.by ?? null, e.byId ?? null, e.parsedBy ?? null
    )
    .run();
}

export async function d1DeleteExpense(db: D1Database, scope: string, expenseId: string): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM expenses WHERE scope = ? AND id = ?')
    .bind(scope, expenseId)
    .run();
  return (res.meta.changes || 0) > 0;
}

export async function d1UpdateExpense(
  db: D1Database,
  scope: string,
  expenseId: string,
  patch: Partial<Omit<Expense, 'id' | 'createdAt' | 'by' | 'byId'>>
): Promise<Expense | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };

  if (patch.amount !== undefined) push('amount', patch.amount);
  if (patch.date !== undefined) push('date', patch.date);
  if (patch.type !== undefined) push('type', patch.type);
  if (patch.category !== undefined) push('category', patch.category);
  if (patch.merchant !== undefined) push('merchant', patch.merchant || null);
  if (patch.description !== undefined) push('description', patch.description);
  if (sets.length === 0) return null;

  // Return the persisted row atomically, so the response cannot contain pre-edit values.
  vals.push(scope, expenseId);
  const updated = await db
    .prepare(`UPDATE expenses SET ${sets.join(', ')} WHERE scope = ? AND id = ? RETURNING *`)
    .bind(...vals)
    .first<Record<string, unknown>>();

  return updated ? rowToExpense(updated) : null;
}

/** 按 id 去重导入（家庭合并/数据迁移用），返回新增条数 */
export async function d1ImportExpenses(db: D1Database, scope: string, list: Expense[]): Promise<number> {
  const existing = await d1GetExpenses(db, scope);
  const seen = new Set(existing.map((e) => e.id));
  let added = 0;
  for (const e of list) {
    if (e && e.id && !seen.has(e.id)) {
      await d1AddExpense(db, scope, e);
      seen.add(e.id);
      added++;
    }
  }
  return added;
}

export async function d1ClearExpenses(db: D1Database, scope: string): Promise<void> {
  await db.prepare('DELETE FROM expenses WHERE scope = ?').bind(scope).run();
}
