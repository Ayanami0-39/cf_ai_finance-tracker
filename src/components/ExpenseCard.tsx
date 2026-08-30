import { useState } from "react";
import type { Expense } from "@/types";
import {
  Trash2,
  X,
  Check,
  Pencil,
} from "lucide-react";
import { resolveCategoryMeta } from "@/lib/category-meta";

interface ExpenseCardProps {
  expense: Expense;
  member?: { name: string; emoji: string };
  onDelete?: (id: string) => void;
  onEdit?: (expense: Expense) => void;
}

export function ExpenseCard({ expense, member, onDelete, onEdit }: ExpenseCardProps) {
  const [confirming, setConfirming] = useState(false);
  const isIncome = expense.type === "income";
  const meta = resolveCategoryMeta(expense.category);
  const Icon = meta.icon;
  const byMember = member;

  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b last:border-b-0 hover:bg-muted/40 transition-colors">
      <div className="relative flex-shrink-0">
        <div
          className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center shadow-sm ring-1 ring-black/5`}
        >
          <Icon className="w-4 h-4 text-white" strokeWidth={2.2} />
        </div>
        {byMember && (
          <span
            className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-card border flex items-center justify-center text-[9px] leading-none"
            title={`由 ${byMember.name} 记录`}
          >
            {byMember.emoji}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {expense.merchant || expense.description}
        </p>
        <p className="text-xs text-muted-foreground">
          {byMember ? `${byMember.name} • ` : ""}
          {expense.category} •{" "}
          {new Date(expense.date).toLocaleDateString("zh-CN", {
            month: "numeric",
            day: "numeric",
          })}
        </p>
      </div>

      <div className="text-right flex-shrink-0">
        <p
          className={`text-sm font-semibold tabular-nums ${
            isIncome ? "text-income" : "text-foreground"
          }`}
        >
          {isIncome ? "+" : "-"}¥{expense.amount.toFixed(2)}
        </p>
      </div>

      {(onDelete || onEdit) && (
        <div className="flex-shrink-0 -mr-1 flex items-center gap-0.5">
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="确认删除"
                onClick={() => onDelete?.(expense.id)}
                className="w-7 h-7 rounded-md bg-destructive text-white flex items-center justify-center hover:bg-destructive/90 active:scale-95 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="取消删除"
                onClick={() => setConfirming(false)}
                className="w-7 h-7 rounded-md bg-muted text-muted-foreground flex items-center justify-center hover:bg-muted/80 active:scale-95 transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-muted-foreground mr-1">
                确认删除？
              </span>
            </div>
          ) : (
            <>
              {onEdit && (
                <button
                  type="button"
                  aria-label="编辑该记录"
                  onClick={() => onEdit(expense)}
                  className="w-7 h-7 rounded-md text-muted-foreground/60 hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  aria-label="删除该记录"
                  onClick={() => setConfirming(true)}
                  className="w-7 h-7 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
