import { useState, useEffect, useMemo } from "react";
import { SummaryCards } from "./SummaryCard";
import { ExpenseCard } from "./ExpenseCard";
import { accountApi, getAccount, type AccountInfo } from "@/lib/account";
import { exportExpensesToCsv } from "@/lib/api";
import { Search, Download, X, ChevronDown } from "lucide-react";
import type { Expense } from "@/types";

interface ExpensesSectionProps {
  expenses: Expense[];
  onExpensesClick?: () => void;
  onDeleteExpense?: (id: string) => void;
  onEditExpense?: (expense: Expense) => void;
}

/** 筛选状态：分类 / 成员 / 关键字 */
type MemberKey = string;

export function ExpensesSection({
  expenses,
  onDeleteExpense,
  onEditExpense,
}: ExpensesSectionProps) {
  // ---- 筛选状态 ----
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [memberFilter, setMemberFilter] = useState<MemberKey>("all");
  const [keyword, setKeyword] = useState("");

  // 记录分页：默认只展示最新 10 条，底部「加载更早」翻页追加，避免长列表一次渲染
  const EXPENSE_PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(EXPENSE_PAGE_SIZE);

  // ---- 候选项 ----
  const categories = useMemo(
    () => [...new Set(expenses.map((e) => e.category))].sort(),
    [expenses]
  );

  // 记录者资料从服务端解析：byId 优先（账号名），回退 by（昵称）
  const [profiles, setProfiles] = useState<Record<string, { displayName: string; emoji: string }>>({});
  const me: AccountInfo | null = getAccount();

  const memberKeys = useMemo(() => {
    const set = new Map<string, { fallback: string; isAccount: boolean }>();
    for (const e of expenses) {
      const key = e.byId || e.by;
      if (!key) continue;
      const prev = set.get(key);
      set.set(key, { fallback: e.by || key, isAccount: prev?.isAccount || Boolean(e.byId) });
    }
    return [...set.entries()];
  }, [expenses]);

  useEffect(() => {
    // 只拉取 byId（账号名）的资料；旧记录仅有 by 显示名（如「coco 爸」，非账号）→ 不请求，直接展示原文
    const missing = memberKeys
      .filter(([k, v]) => v.isAccount && !(k in profiles))
      .map(([k]) => k);
    if (missing.length === 0) return;
    let cancelled = false;
    accountApi.getProfiles(missing).then((map) => {
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...map }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKeys]);

  const memberNameOf = (key: string) =>
    profiles[key]?.displayName || memberKeys.find(([k]) => k === key)?.[1].fallback || key;
  const memberEmojiOf = (key: string) => profiles[key]?.emoji || "🙂";

  // ---- 过滤链：分类 → 成员 → 关键字（商户名/描述/金额模糊匹配） ----
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return [...expenses]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((e) => {
        if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
        if (
          memberFilter !== "all" &&
          e.byId !== memberFilter &&
          (e.byId || e.by !== memberFilter)
        )
          return false;
        if (kw) {
          const hay = `${e.merchant || ""} ${e.description || ""} ${e.category} ${e.amount}`.toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      });
  }, [expenses, categoryFilter, memberFilter, keyword]);

  // 任一筛选生效时显示清除按钮
  const hasActiveFilter =
    categoryFilter !== "all" || memberFilter !== "all" || keyword.trim() !== "";

  const clearAllFilters = () => {
    setCategoryFilter("all");
    setMemberFilter("all");
    setKeyword("");
  };

  // ---- 按月分组（在已过滤列表上）----
  const monthGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: Expense[]; income: number; expense: number }> = [];
    let current: string | null = null;
    for (const e of filtered) {
      const key = e.date?.slice(0, 7) || "未知";
      if (key !== current) {
        groups.push({ key, label: formatMonthLabel(key), items: [], income: 0, expense: 0 });
        current = key;
      }
      const g = groups[groups.length - 1];
      if (e.type === "income") g.income += e.amount;
      else g.expense += e.amount;
      g.items.push(e);
    }
    return groups;
  }, [filtered]);

  // 筛选条件变化时重置分页
  useEffect(() => {
    setVisibleCount(EXPENSE_PAGE_SIZE);
  }, [categoryFilter, memberFilter, keyword]);

  // 分页作用于「拍平后的分组列表」：统计每组内前 N 条
  const visibleGroups = useMemo(() => {
    let budget = visibleCount;
    const groups: typeof monthGroups = [];
    for (const g of monthGroups) {
      if (budget <= 0) break;
      const items = g.items.slice(0, budget);
      if (items.length === 0) break;
      groups.push({ ...g, items });
      budget -= items.length;
    }
    return groups;
  }, [monthGroups, visibleCount]);

  const visibleTotal = visibleGroups.reduce((s, g) => s + g.items.length, 0);
  const hasMoreExpenses = filtered.length > visibleTotal;

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

      {/* 筛选栏：关键字搜索 + 分类/成员下拉 + 导出 */}
      <div className="px-4 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1.5 bg-card border rounded-full px-3 h-8 focus-within:ring-2 focus-within:ring-primary/30">
            <Search className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索商户、备注、金额…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 min-w-0"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword("")}
                aria-label="清除搜索"
                className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => exportExpensesToCsv(filtered)}
            title="导出当前筛选结果为 CSV"
            aria-label="导出 CSV"
            className="h-8 w-8 flex-shrink-0 rounded-full border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            allLabel="全部分类"
            options={categories.map((c) => ({ value: c, label: c }))}
          />
          <FilterSelect
            value={memberFilter}
            onChange={setMemberFilter}
            allLabel="全部成员"
            allEmoji="👥"
            options={memberKeys.map(([k, meta]) => ({
              value: k,
              label: memberNameOf(k) === k && meta.fallback ? meta.fallback : memberNameOf(k),
              emoji: memberEmojiOf(k),
            }))}
          />
          {hasActiveFilter && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground h-7 px-2 rounded-full border bg-card hover:bg-muted transition-colors"
            >
              <X className="w-3 h-3" />
              清除
            </button>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
            {filtered.length === expenses.length
              ? `共 ${filtered.length} 笔`
              : `${filtered.length} / ${expenses.length} 笔`}
          </span>
        </div>
      </div>

      {/* Transaction list：按月分组 */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {filtered.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-xl border">
            <p className="text-sm text-muted-foreground">
              {expenses.length === 0 ? "还没有交易记录" : "没有符合筛选条件的记录"}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              {expenses.length === 0 ? "在「对话」页语音或文字记一笔吧" : "试试调整或清除筛选条件"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleGroups.map((g) => (
              <div key={g.key}>
                {/* 月份小节标题：月份 + 该组收支小计 */}
                <div className="flex items-center justify-between px-1 py-1.5 sticky top-0 bg-background/95 backdrop-blur-sm z-10 -mx-1 px-3">
                  <h3 className="text-xs font-semibold text-foreground min-w-0 truncate">
                    {g.label}
                  </h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0 whitespace-nowrap">
                    支出 ¥{g.expense.toFixed(0)}
                    {g.income > 0 && ` · 收入 ¥${g.income.toFixed(0)}`}
                  </span>
                </div>
                <div className="bg-card rounded-xl border overflow-hidden">
                  {g.items.map((expense) => (
                    <ExpenseCard
                      key={expense.id}
                      expense={expense}
                      member={resolveMember(expense)}
                      onDelete={onDeleteExpense}
                      onEdit={onEditExpense}
                    />
                  ))}
                </div>
              </div>
            ))}

            {hasMoreExpenses && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + EXPENSE_PAGE_SIZE)}
                  className="text-xs text-muted-foreground hover:text-foreground h-8 px-4 rounded-full border bg-card hover:bg-muted transition-colors"
                >
                  ↑ 加载更早的记录（还有 {filtered.length - visibleTotal} 条）
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- 小组件 ----

/** 下拉筛选器：与统计页成员筛选风格一致 */
function FilterSelect({
  value,
  onChange,
  allLabel,
  allEmoji,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  allEmoji?: string;
  options: Array<{ value: string; label: string; emoji?: string }>;
}) {
  const active = value !== "all";
  const current = options.find((o) => o.value === value);
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={allLabel}
        className={`appearance-none h-7 pl-2 pr-6 text-[11px] rounded-full border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer max-w-[120px] ${
          active ? "text-primary border-primary/40 font-medium" : "text-foreground"
        }`}
      >
        <option value="all">{allEmoji ? `${allEmoji} ${allLabel}` : allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.emoji ? `${o.emoji} ${o.label}` : o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      {active && current && (
        <span className="absolute -top-1 -right-0.5 w-2 h-2 rounded-full bg-primary pointer-events-none" />
      )}
    </div>
  );
}

/** "2026-08" → "2026 年 8 月"；当前月标注「本月」 */
function formatMonthLabel(key: string): string {
  if (key === "未知") return "未知月份";
  const [y, m] = key.split("-").map(Number);
  const now = new Date();
  const isCurrent = key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `${y} 年 ${m} 月${isCurrent ? "（本月）" : ""}`;
}
