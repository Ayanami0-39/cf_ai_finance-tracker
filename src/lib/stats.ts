import type { Expense } from "@/types";

// ============ 工具 ============

/** "2026-08" 格式 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${y} 年 ${m} 月`;
}

export function isMonthAfter(a: string, b: string): boolean {
  return a > b;
}

// ============ 聚合 ============

export interface MonthAgg {
  income: number;
  expense: number;
  balance: number;
  count: number;
  byCategory: Record<string, number>;
}

export function aggregateMonth(expenses: Expense[], key: string): MonthAgg {
  const agg: MonthAgg = {
    income: 0,
    expense: 0,
    balance: 0,
    count: 0,
    byCategory: {},
  };

  for (const e of expenses) {
    // date 为 "YYYY-MM-DD"，直接取前 7 位比对，避免时区问题
    if (!e.date || e.date.slice(0, 7) !== key) continue;
    if (e.type === "income") {
      agg.income += e.amount;
    } else {
      agg.expense += e.amount;
      agg.byCategory[e.category] = (agg.byCategory[e.category] || 0) + e.amount;
    }
    agg.count++;
  }

  agg.balance = agg.income - agg.expense;
  return agg;
}

/** 分类占比列表（仅支出），按金额降序 */
export interface CategorySlice {
  name: string;
  value: number;
  ratio: number; // 0~1
}

export function categorySlices(byCategory: Record<string, number>): CategorySlice[] {
  const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return Object.entries(byCategory)
    .map(([name, value]) => ({ name, value, ratio: value / total }))
    .sort((a, b) => b.value - a.value);
}

/** 同比（去年同月）/ 环比（上月）变化率，返回 null 表示无法计算 */
export function changeRate(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

/** 近 N 个月（含指定月）的月度序列，旧 → 新 */
export function recentMonths(
  expenses: Expense[],
  endKey: string,
  n: number
): Array<{ key: string; agg: MonthAgg }> {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(shiftMonth(endKey, -i));
  return keys.map((k) => ({ key: k, agg: aggregateMonth(expenses, k) }));
}
