import { useState, useEffect } from "react";
import { SummaryCards } from "./SummaryCard";
import { ExpenseCard } from "./ExpenseCard";
import { accountApi, getAccount, type AccountInfo } from "@/lib/account";
import type { Expense } from "@/types";

interface ExpensesSectionProps {
  expenses: Expense[];
  onExpensesClick?: () => void;
  onDeleteExpense?: (id: string) => void;
  onEditExpense?: (expense: Expense) => void;
}

export function ExpensesSection({
  expenses,
  onDeleteExpense,
  onEditExpense,
}: ExpensesSectionProps) {
  const sorted = [...expenses].sort((a, b) => b.createdAt - a.createdAt);

  // 记录分页：默认只展示最新 10 条，底部「加载更早」翻页追加，避免长列表一次渲染
  const EXPENSE_PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(EXPENSE_PAGE_SIZE);
  const visible = sorted.slice(0, visibleCount);
  const hasMoreExpenses = sorted.length > visibleCount;

  // 记录者资料从服务端解析：byId 优先（账号名），回退 by（昵称）
  const [profiles, setProfiles] = useState<Record<string, { displayName: string; emoji: string }>>({});
  const me: AccountInfo | null = getAccount();

  useEffect(() => {
    // 只拉取 byId（账号名）的资料；旧记录仅有 by 显示名（如「coco 爸」，非账号）→ 不请求，直接展示原文
    const keys = new Set<string>();
    for (const e of sorted) {
      if (e.byId) keys.add(e.byId);
    }
    const missing = [...keys].filter((k) => !(k in profiles));
    if (missing.length === 0) return;
    let cancelled = false;
    accountApi.getProfiles(missing).then((map) => {
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...map }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses.length]);

  const resolveMember = (e: Expense) => {
    const key = e.byId || e.by;
    const p = key ? profiles[key] : undefined;
    if (p) return { name: p.displayName, emoji: p.emoji };
    if (me && (e.byId === me.username || e.by === me.displayName))
      return { name: me.displayName, emoji: me.emoji };
    return undefined;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Summary band */}
      <div className="p-4 pb-2">
        <SummaryCards expenses={expenses} />
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex items-center justify-between px-1 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            交易记录 / Transactions
          </h2>
          <span className="text-xs text-muted-foreground">
            共 {sorted.length} 笔
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-xl border">
            <p className="text-sm text-muted-foreground">还没有交易记录</p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              在「对话」页语音或文字记一笔吧
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border overflow-hidden">
            {visible.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                member={resolveMember(expense)}
                onDelete={onDeleteExpense}
                onEdit={onEditExpense}
              />
            ))}
          </div>
        )}

        {hasMoreExpenses && (
          <div className="flex justify-center pt-3">
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + EXPENSE_PAGE_SIZE)}
              className="text-xs text-muted-foreground hover:text-foreground h-8 px-4 rounded-full border bg-card hover:bg-muted transition-colors"
            >
              ↑ 加载更早的记录（还有 {sorted.length - visibleCount} 条）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
