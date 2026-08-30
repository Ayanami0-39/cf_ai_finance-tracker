import { useState, useEffect } from "react";
import { SummaryCards } from "./SummaryCard";
import { ExpenseCard } from "./ExpenseCard";
import { accountApi, getAccount, type AccountInfo } from "@/lib/account";
import type { Expense } from "@/types";

interface ExpensesSectionProps {
  expenses: Expense[];
  onExpensesClick?: () => void;
  onDeleteExpense?: (id: string) => void;
}

export function ExpensesSection({
  expenses,
  onDeleteExpense,
}: ExpensesSectionProps) {
  const sorted = [...expenses].sort((a, b) => b.createdAt - a.createdAt);

  // 记录者资料从服务端解析：byId 优先（账号名），回退 by（昵称）
  const [profiles, setProfiles] = useState<Record<string, { displayName: string; emoji: string }>>({});
  const me: AccountInfo | null = getAccount();

  useEffect(() => {
    const keys = new Set<string>();
    for (const e of sorted) {
      if (e.byId) keys.add(e.byId);
      else if (e.by) keys.add(e.by);
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
            {sorted.map((expense) => (
              <ExpenseCard
                key={expense.id}
                expense={expense}
                member={resolveMember(expense)}
                onDelete={onDeleteExpense}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
