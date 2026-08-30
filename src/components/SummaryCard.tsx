import { Card } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import type { Expense } from "@/types";

interface SummaryCardsProps {
  expenses: Expense[];
}

export function SummaryCards({ expenses }: SummaryCardsProps) {
  const totalExpense = expenses
    .filter((e) => e.type !== "income")
    .reduce((sum, e) => sum + e.amount, 0);
  const totalIncome = expenses
    .filter((e) => e.type === "income")
    .reduce((sum, e) => sum + e.amount, 0);
  const balance = totalIncome - totalExpense;

  return (
    <div className="grid grid-cols-3 lg:grid-cols-3 gap-2 md:gap-3">
      {/* Balance - prominent */}
      <Card className="p-3 md:p-5 bg-primary text-primary-foreground border-primary rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <Wallet className="w-4 h-4 opacity-80" />
          <p className="text-xs opacity-80">结余 / Balance</p>
        </div>
        <p className="text-xl md:text-3xl font-bold tabular-nums tracking-tight">
          {balance < 0 ? "-" : ""}¥{Math.abs(balance).toFixed(2)}
        </p>
      </Card>

      {/* Income */}
      <Card className="p-3 md:p-5 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <ArrowUpRight className="w-4 h-4 text-income" />
          <p className="text-xs text-muted-foreground">收入 / Income</p>
        </div>
        <p className="text-lg md:text-2xl font-semibold tabular-nums text-income">
          +¥{totalIncome.toFixed(2)}
        </p>
      </Card>

      {/* Expense */}
      <Card className="p-3 md:p-5 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <ArrowDownRight className="w-4 h-4 text-destructive" />
          <p className="text-xs text-muted-foreground">支出 / Expense</p>
        </div>
        <p className="text-lg md:text-2xl font-semibold tabular-nums text-destructive">
          -¥{totalExpense.toFixed(2)}
        </p>
      </Card>
    </div>
  );
}
