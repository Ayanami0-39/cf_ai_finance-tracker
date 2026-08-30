import { useMemo, useState, useEffect } from "react";
import type { Expense } from "@/types";
import { accountApi } from "@/lib/account";
import {
  aggregateMonth,
  categorySlices,
  changeRate,
  monthLabel,
  monthKey,
  recentMonths,
  shiftMonth,
} from "@/lib/stats";
import { PieChart, PALETTE } from "./PieChart";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Minus,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface StatsSectionProps {
  expenses: Expense[];
}

export function StatsSection({ expenses }: StatsSectionProps) {
  const [cursor, setCursor] = useState<string>(() => monthKey(new Date()));
  const [memberFilter, setMemberFilter] = useState<string>("all");

  // 成员筛选来源：账单中出现过的记录者（byId 优先，旧数据回退 by 名字）
  const [profiles, setProfiles] = useState<Record<string, { displayName: string; emoji: string }>>({});
  const memberKeys = useMemo(() => {
    const set = new Map<string, string>(); // key -> 展示名兜底
    for (const e of expenses) {
      const key = e.byId || e.by;
      if (key && !set.has(key)) set.set(key, e.by || key);
    }
    return [...set.entries()];
  }, [expenses]);

  useEffect(() => {
    const missing = memberKeys.map(([k]) => k).filter((k) => !(k in profiles));
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

  const memberNameOf = (key: string) => profiles[key]?.displayName || memberKeys.find(([k]) => k === key)?.[1] || key;
  const memberEmojiOf = (key: string) => profiles[key]?.emoji || "🙂";

  // 按成员过滤（默认「全部成员」）：byId 精确匹配，by 名字兜底旧数据
  const filtered = useMemo(() => {
    if (memberFilter === "all") return expenses;
    return expenses.filter(
      (e) => e.byId === memberFilter || (!e.byId && e.by === memberFilter)
    );
  }, [expenses, memberFilter]);

  const agg = useMemo(() => aggregateMonth(filtered, cursor), [filtered, cursor]);
  const prevAgg = useMemo(
    () => aggregateMonth(filtered, shiftMonth(cursor, -1)),
    [filtered, cursor]
  );
  const lastYearAgg = useMemo(
    () => aggregateMonth(filtered, shiftMonth(cursor, -12)),
    [filtered, cursor]
  );
  const trend = useMemo(
    () => recentMonths(filtered, cursor, 6),
    [filtered, cursor]
  );
  const slices = useMemo(() => categorySlices(agg.byCategory), [agg]);

  const mom = changeRate(agg.expense, prevAgg.expense);
  const yoy = changeRate(agg.expense, lastYearAgg.expense);

  const currentMonthKey = monthKey(new Date());
  const canGoNext = cursor < currentMonthKey;

  const hasAny = filtered.some((e) => e.date?.slice(0, 7) === cursor);

  const filterLabel =
    memberFilter === "all"
      ? "全部成员"
      : memberNameOf(memberFilter);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6 py-4 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              统计分析 / Statistics
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              按月查看收支与分类占比
            </p>
          </div>
          {/* Member filter */}
          <label className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              成员
            </span>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none">
                {memberFilter === "all"
                  ? "👥"
                  : memberEmojiOf(memberFilter)}
              </span>
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                aria-label="按成员筛选统计"
                className="appearance-none h-8 pl-7 pr-7 text-xs rounded-lg border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer max-w-[130px]"
              >
                <option value="all">全部成员</option>
                {memberKeys.map(([key, fallback]) => (
                  <option key={key} value={key}>
                    {memberNameOf(key) === key && fallback ? fallback : memberNameOf(key)}
                  </option>
                ))}
              </select>
              <ChevronRight className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-muted-foreground pointer-events-none" />
            </div>
          </label>
        </div>

        {/* Month navigator */}
        <div className="flex items-center justify-between bg-card border rounded-xl px-3 py-2.5 mb-4">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setCursor(shiftMonth(cursor, -1))}
            className="w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {monthLabel(cursor)}
          </span>
          <button
            type="button"
            aria-label="下个月"
            disabled={!canGoNext}
            onClick={() => setCursor(shiftMonth(cursor, 1))}
            className="w-9 h-9 rounded-lg hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center text-muted-foreground transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {!hasAny ? (
          <EmptyMonth memberName={filterLabel} />
        ) : (
          <div className="space-y-4">
            {/* Overview cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              <StatCard
                label="支出"
                value={`¥${agg.expense.toFixed(2)}`}
                icon={<ArrowDownRight className="w-4 h-4 text-destructive" />}
                tone="expense"
              />
              <StatCard
                label="收入"
                value={`¥${agg.income.toFixed(2)}`}
                icon={<ArrowUpRight className="w-4 h-4 text-income" />}
                tone="income"
              />
              <StatCard
                label="结余"
                value={`¥${agg.balance.toFixed(2)}`}
                icon={<Wallet className="w-4 h-4 text-primary" />}
                tone={agg.balance < 0 ? "expense" : "neutral"}
              />
              <StatCard
                label="笔数"
                value={String(agg.count)}
                icon={<Minus className="w-4 h-4 text-muted-foreground" />}
                tone="neutral"
              />
            </div>

            {/* Change rates: MoM / YoY */}
            <div className="grid grid-cols-2 gap-2 md:gap-3">
              <ChangeCard
                title="环比上月"
                base={prevAgg.expense}
                rate={mom}
              />
              <ChangeCard
                title="同比去年"
                base={lastYearAgg.expense}
                rate={yoy}
              />
            </div>

            {/* Category pie + ranking */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                分类消费占比
              </h3>
              {slices.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  本月没有支出记录
                </p>
              ) : (
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
                  <div className="flex-shrink-0">
                    <PieChart slices={slices} size={176} />
                  </div>
                  <div className="flex-1 w-full space-y-2">
                    {slices.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ background: PALETTE[i % PALETTE.length] }}
                        />
                        <span className="text-xs text-foreground flex-1 truncate">
                          {s.name}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ¥{s.value.toFixed(2)}
                        </span>
                        <span className="text-xs text-muted-foreground/70 tabular-nums w-11 text-right">
                          {(s.ratio * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 6-month trend */}
            <div className="bg-card border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                近 6 个月趋势
              </h3>
              <TrendBar trend={trend} cursor={cursor} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Sub components ----------

function EmptyMonth({ memberName }: { memberName?: string }) {
  return (
    <div className="text-center py-16 bg-card rounded-xl border">
      <p className="text-sm text-muted-foreground">
        {memberName && memberName !== "全部成员"
          ? `${memberName}在该月份暂无数据`
          : "该月份暂无数据"}
      </p>
      <p className="text-xs text-muted-foreground/70 mt-2">
        在「对话」页记一笔，统计会自动更新
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "expense" | "income" | "neutral";
}) {
  return (
    <div className="bg-card border rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p
        className={`text-base md:text-xl font-semibold tabular-nums ${
          tone === "expense"
            ? "text-destructive"
            : tone === "income"
              ? "text-income"
              : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ChangeCard({
  title,
  base,
  rate,
}: {
  title: string;
  base: number;
  rate: number | null;
}) {
  const up = rate !== null && rate > 0;
  const down = rate !== null && rate < 0;

  return (
    <div className="bg-card border rounded-xl p-3">
      <p className="text-xs text-muted-foreground mb-1.5">{title}</p>
      {rate === null ? (
        <p className="text-sm text-muted-foreground/70">
          {base <= 0 ? "暂无对比数据" : "—"}
        </p>
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span
            className={`inline-flex items-center gap-0.5 text-sm font-semibold ${
              up
                ? "text-destructive"
                : down
                  ? "text-income"
                  : "text-muted-foreground"
            }`}
          >
            {up ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : down ? (
              <TrendingDown className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
            {Math.abs(rate * 100).toFixed(1)}%
          </span>
          <span className="text-[11px] text-muted-foreground">
            上期 ¥{base.toFixed(0)}
          </span>
        </div>
      )}
    </div>
  );
}

function TrendBar({
  trend,
  cursor,
}: {
  trend: Array<{ key: string; agg: { expense: number; income: number } }>;
  cursor: string;
}) {
  const max = Math.max(
    ...trend.map((t) => Math.max(t.agg.expense, t.agg.income)),
    1
  );

  return (
    <div className="flex items-end justify-between gap-1.5 h-32">
      {trend.map((t) => {
        const isCurrent = t.key === cursor;
        const mh = (t.agg.expense / max) * 100;
        const ih = (t.agg.income / max) * 100;
        const [, m] = t.key.split("-");
        return (
          <div key={t.key} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
            <div className="w-full flex items-end justify-center gap-0.5 flex-1">
              <div
                className="w-2.5 md:w-3 rounded-t bg-destructive/70 transition-all"
                style={{ height: `${mh}%`, minHeight: t.agg.expense > 0 ? 3 : 0 }}
                title={`支出 ¥${t.agg.expense.toFixed(0)}`}
              />
              <div
                className="w-2.5 md:w-3 rounded-t bg-income/60 transition-all"
                style={{ height: `${ih}%`, minHeight: t.agg.income > 0 ? 3 : 0 }}
                title={`收入 ¥${t.agg.income.toFixed(0)}`}
              />
            </div>
            <span
              className={`text-[10px] tabular-nums ${
                isCurrent ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              {Number(m)}月
            </span>
          </div>
        );
      })}
    </div>
  );
}
