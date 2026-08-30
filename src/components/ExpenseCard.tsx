import type { Expense } from "@/types";
import {
  ShoppingBag,
  Coffee,
  Car,
  Receipt,
  Utensils,
  Film,
  Heart,
  Package,
  GraduationCap,
  Scissors,
  Plane,
  ArrowUpRight,
} from "lucide-react";

interface ExpenseCardProps {
  expense: Expense;
}

const categoryIcons: Record<string, React.ReactNode> = {
  "Food & Dining": <Utensils className="w-4 h-4" />,
  Transportation: <Car className="w-4 h-4" />,
  Shopping: <ShoppingBag className="w-4 h-4" />,
  Entertainment: <Film className="w-4 h-4" />,
  "Bills & Utilities": <Receipt className="w-4 h-4" />,
  Healthcare: <Heart className="w-4 h-4" />,
  Education: <GraduationCap className="w-4 h-4" />,
  "Personal Care": <Scissors className="w-4 h-4" />,
  Travel: <Plane className="w-4 h-4" />,
  Income: <ArrowUpRight className="w-4 h-4" />,
  Other: <Package className="w-4 h-4" />,
};

// 兜底：Coffee 等旧分类映射
function resolveIcon(category: string): React.ReactNode {
  return (
    categoryIcons[category] ||
    (category.toLowerCase().includes("coffee") ? (
      <Coffee className="w-4 h-4" />
    ) : (
      categoryIcons["Other"]
    ))
  );
}

export function ExpenseCard({ expense }: ExpenseCardProps) {
  const isIncome = expense.type === "income";
  const icon = resolveIcon(expense.category);

  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b last:border-b-0 hover:bg-muted/40 transition-colors">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isIncome
            ? "bg-income/10 text-income"
            : "bg-secondary text-primary"
        }`}
      >
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {expense.merchant || expense.description}
        </p>
        <p className="text-xs text-muted-foreground">
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
          {isIncome ? "+" : "-"}${expense.amount.toFixed(2)}
        </p>
      </div>
    </div>
  );
}
