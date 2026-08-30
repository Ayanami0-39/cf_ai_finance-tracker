import { SummaryCards } from "./SummaryCard";
import { ExpenseCard } from "./ExpenseCard";
import type { Expense } from "@/types";

interface ExpensesSectionProps {
  expenses: Expense[];
  onExpensesClick?: () => void;
}

export function ExpensesSection({ expenses }: ExpensesSectionProps) {
  const sorted = [...expenses].sort((a, b) => b.createdAt - a.createdAt);

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
              通过左侧对话框语音或文字记一笔吧
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-xl border overflow-hidden">
            {sorted.map((expense) => (
              <ExpenseCard key={expense.id} expense={expense} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
