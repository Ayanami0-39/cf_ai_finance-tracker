import { useMemo, useState, useEffect, useRef } from "react";
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
  type MonthAgg,
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
  Receipt,
  Users,
  CalendarDays,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface StatsSectionProps {
  expenses: Expense[];
}

export function StatsSection({ expenses }: StatsSectionProps) {
  const [cursor, setCursor] = useState<string>(() => monthKey(new Date()));
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [trendMonth, setTrendMonth] = useState<string | null>(null);

  // 切换月份时清空图表选中态
  useEffect(() => {
    setSelectedCategory(null);
    setTrendMonth(null);
  }, [cursor]);

  // 成员筛选来源：账单中出现过的记录者（byId 优先，旧数据回退 by 名字）
  const [profiles, setProfiles] = useState<Record<string, { displayName: string; emoji: string }>>({});
  const memberKeys = useMemo(() => {
    const set = new Map<string, { fallback: string; isAccount: boolean }>();
    for (const e of expenses) {
      const key = e.byId || e.by;
      if (!key) continue;
      const prev = set.get(key);
      // isAccount：该 key 是否为账号名（byId）。仅 by 显示名（旧本地成员，如「coco 爸」）不是账号，不查资料
      set.set(key, { fallback: e.by || key, isAccount: prev?.isAccount || Boolean(e.byId) });
    }
    return [...set.entries()];
  }, [expenses]);

  useEffect(() => {
    // 只拉取账号名（byId）的资料；旧本地显示名不请求（避免必然 404），筛选项直接展示原文
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

  const memberNameOf = (key: string) => profiles[key]?.displayName || memberKeys.find(([k]) => k === key)?.[1].fallback || key;
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

  // 日均支出：仅对当前月按已过天数折算，历史月份按整月天数
  const dailyAvg = useMemo(() => {
    const [y, m] = cursor.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const now = new Date();
    const isCurrent = cursor === monthKey(now);
    const days = isCurrent ? now.getDate() : daysInMonth;
    return days > 0 ? agg.expense / days : 0;
  }, [agg.expense, cursor]);

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
                {memberKeys.map(([key, meta]) => (
                  <option key={key} value={key}>
                    {memberNameOf(key) === key && meta.fallback ? meta.fallback : memberNameOf(key)}
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
            className="w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors active:bg-muted"
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
            className="w-9 h-9 rounded-lg hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center text-muted-foreground transition-colors active:bg-muted"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {!hasAny ? (
          <EmptyMonth memberName={filterLabel} />
        ) : (
          <motion.div
            className="space-y-4"
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.06 } },
            }}
          >
            {/* Overview cards */}
            <motion.div
              className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3"
              variants={cardVariants}
            >
              <StatCard
                label="支出"
                value={agg.expense}
                icon={<ArrowDownRight className="w-4 h-4 text-destructive" />}
                tone="expense"
              />
              <StatCard
                label="收入"
                value={agg.income}
                icon={<ArrowUpRight className="w-4 h-4 text-income" />}
                tone="income"
              />
              <StatCard
                label="结余"
                value={agg.balance}
                icon={<Wallet className="w-4 h-4 text-primary" />}
                tone={agg.balance < 0 ? "expense" : "neutral"}
              />
              <StatCard
                label="日均支出"
                value={dailyAvg}
                icon={<CalendarDays className="w-4 h-4 text-muted-foreground" />}
                tone="neutral"
                decimals={1}
              />
            </motion.div>

            {/* Change rates: MoM / YoY */}
            <motion.div className="grid grid-cols-2 gap-2 md:gap-3" variants={cardVariants}>
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
            </motion.div>

            {/* Category pie + ranking */}
            <motion.div className="bg-card border rounded-xl p-4" variants={cardVariants}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  分类消费占比
                </h3>
                {selectedCategory && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors active:scale-95"
                  >
                    <X className="w-3 h-3" />
                    清除选中
                  </button>
                )}
              </div>
              {slices.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  本月没有支出记录
                </p>
              ) : (
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
                  <div className="flex-shrink-0">
                    <PieChart
                      slices={slices}
                      size={176}
                      selected={selectedCategory}
                      onSelect={setSelectedCategory}
                    />
                  </div>
                  <div className="flex-1 w-full space-y-1.5">
                    {slices.map((s, i) => {
                      const isActive = selectedCategory === s.name;
                      const dimmed = selectedCategory !== null && !isActive;
                      return (
                        <button
                          type="button"
                          key={s.name}
                          onClick={() =>
                            setSelectedCategory(isActive ? null : s.name)
                          }
                          className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors ${
                            isActive ? "bg-muted" : "hover:bg-muted/60 active:bg-muted"
                          }`}
                          style={{ opacity: dimmed ? 0.45 : 1 }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                            style={{ background: PALETTE[i % PALETTE.length] }}
                          />
                          <span className="text-xs text-foreground flex-1 truncate text-left">
                            {s.name}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            ¥{s.value.toFixed(2)}
                          </span>
                          <span className="text-xs text-muted-foreground/70 tabular-nums w-11 text-right">
                            {(s.ratio * 100).toFixed(1)}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>

            {/* 6-month trend */}
            <motion.div className="bg-card border rounded-xl p-4" variants={cardVariants}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  近 6 个月趋势
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  点击柱子查看明细
                </span>
              </div>
              <TrendBar
                trend={trend}
                cursor={cursor}
                selected={trendMonth}
                onSelect={(k) => setTrendMonth(k === trendMonth ? null : k)}
              />
              <AnimatePresence initial={false}>
                {trendMonth && (
                  <TrendDetail
                    key={trendMonth}
                    monthKeyStr={trendMonth}
                    agg={trend.find((t) => t.key === trendMonth)!.agg}
                    isCursor={trendMonth === cursor}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ---------- Motion variants ----------

const cardVariants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" as const },
  },
};

// ---------- Sub components ----------

/** 数字滚动动画（金额） */
function AnimatedNumber({
  value,
  decimals = 2,
}: {
  value: number;
  decimals?: number;
}) {
  const spring = useSpringNumber(value);
  return (
    <span className="tabular-nums">
      ¥{spring.toFixed(decimals)}
    </span>
  );
}

function useSpringNumber(target: number): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const currentRef = useRef(target);

  useEffect(() => {
    const from = currentRef.current;
    const start = performance.now();
    const duration = 500;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (target - from) * eased;
      currentRef.current = val;
      setDisplay(val);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return display;
}

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
  decimals = 2,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "expense" | "income" | "neutral";
  decimals?: number;
}) {
  return (
    <div className="bg-card border rounded-xl p-3 active:scale-[0.98] transition-transform">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p
        className={`text-base md:text-xl font-semibold ${
          tone === "expense"
            ? "text-destructive"
            : tone === "income"
              ? "text-income"
              : "text-foreground"
        }`}
      >
        <AnimatedNumber value={value} decimals={decimals} />
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
        <div className="flex items-baseline gap-1.5 flex-wrap">
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

const fmtY = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`;

/** 将最大值向上取整到「好看」的刻度（1/2/2.5/5 × 10^n） */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= max) return m * pow;
  }
  return 10 * pow;
}

function TrendBar({
  trend,
  cursor,
  selected,
  onSelect,
}: {
  trend: Array<{ key: string; agg: MonthAgg }>;
  cursor: string;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const rawMax = Math.max(
    ...trend.map((t) => Math.max(t.agg.expense, t.agg.income)),
    1
  );
  const scaleMax = niceMax(rawMax);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((r) => Math.round(scaleMax * r));

  // 6 个月合计的分类金额降序作为堆叠顺序，保证各月颜色一致
  const stackOrder = useMemo(() => {
    const sum: Record<string, number> = {};
    for (const t of trend)
      for (const [c, v] of Object.entries(t.agg.byCategory))
        sum[c] = (sum[c] || 0) + v;
    return Object.entries(sum)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [trend]);

  return (
    <div>
      <div className="relative h-36 pl-9">
        {/* 纵轴刻度 + 网格线 */}
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute left-9 right-0 flex items-center"
            style={{ bottom: `${(t / scaleMax) * 100}%` }}
          >
            <span className="absolute -left-9 w-8 text-right text-[9px] text-muted-foreground/80 tabular-nums leading-none">
              {fmtY(t)}
            </span>
            <div
              className={`flex-1 border-t ${
                t === 0
                  ? "border-border"
                  : "border-dashed border-muted-foreground/15"
              }`}
            />
          </div>
        ))}
        {/* 柱子区域 */}
        <div className="absolute left-11 right-0 bottom-0 top-0 flex items-end justify-between gap-1.5">
          {trend.map((t) => {
            const isCurrent = t.key === cursor;
            const isSelected = t.key === selected;
            const dimmed = selected !== null && !isSelected;
            const ih = (t.agg.income / scaleMax) * 100;
            const [, m] = t.key.split("-");
            const stack = stackOrder.map((c, i) => ({
              name: c,
              value: t.agg.byCategory[c] || 0,
              color: PALETTE[i % PALETTE.length],
            }));
            return (
              <button
                type="button"
                key={t.key}
                onClick={() => onSelect(t.key)}
                className={`flex-1 flex flex-col items-center gap-1 h-full justify-end rounded-lg outline-none transition-opacity ${
                  dimmed ? "opacity-40" : "opacity-100"
                }`}
              >
                <div className="w-full flex items-end justify-center gap-0.5 flex-1">
                  {/* 支出：按分类堆叠的多色柱 */}
                  <div className="w-2.5 md:w-3 h-full flex flex-col justify-end rounded-t overflow-hidden">
                    {stack.map((seg) =>
                      seg.value > 0 ? (
                        <motion.div
                          key={seg.name}
                          className="w-full"
                          style={{ background: seg.color, minHeight: 2 }}
                          initial={{ height: 0 }}
                          animate={{
                            height: `${(seg.value / scaleMax) * 100}%`,
                          }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                          title={`${seg.name} ¥${seg.value.toFixed(0)}`}
                        />
                      ) : null
                    )}
                  </div>
                  {/* 收入：独立细柱 */}
                  <motion.div
                    className={`w-1.5 rounded-t bg-income/60 ${
                      isSelected ? "bg-income" : ""
                    }`}
                    initial={{ height: 0 }}
                    animate={{ height: `${ih}%` }}
                    transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
                    style={{ minHeight: t.agg.income > 0 ? 3 : 0 }}
                    title={`收入 ¥${t.agg.income.toFixed(0)}`}
                  />
                </div>
                <span
                  className={`text-[10px] tabular-nums ${
                    isCurrent || isSelected
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  {Number(m)}月
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-border/50">
        {stackOrder.map((c, i) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <span
              className="w-2 h-2 rounded-sm"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            {c}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-2 h-2 rounded-sm bg-income/70" />
          收入
        </span>
      </div>
    </div>
  );
}

/** 点击柱状图后展开的当月明细 */
function TrendDetail({
  monthKeyStr,
  agg,
  isCursor,
}: {
  monthKeyStr: string;
  agg: MonthAgg;
  isCursor: boolean;
}) {
  const [y, m] = monthKeyStr.split("-").map(Number);
  const balancePositive = agg.balance >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="mt-3 rounded-lg bg-muted/50 border p-3">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1">
            <Receipt className="w-3.5 h-3.5 text-muted-foreground" />
            {y} 年 {m} 月明细
            {isCursor && (
              <span className="text-[10px] text-primary font-normal">（当前查看）</span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center gap-0.5">
              <ArrowDownRight className="w-3 h-3 text-destructive" />
              支出
            </p>
            <p className="text-sm font-semibold text-destructive tabular-nums">
              ¥{agg.expense.toFixed(2)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center gap-0.5">
              <ArrowUpRight className="w-3 h-3 text-income" />
              收入
            </p>
            <p className="text-sm font-semibold text-income tabular-nums">
              ¥{agg.income.toFixed(2)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-center gap-0.5">
              <Wallet className="w-3 h-3 text-muted-foreground" />
              结余
            </p>
            <p
              className={`text-sm font-semibold tabular-nums ${
                balancePositive ? "text-foreground" : "text-destructive"
              }`}
            >
              ¥{agg.balance.toFixed(2)}
            </p>
          </div>
        </div>
        {agg.count > 0 && (
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            共 {agg.count} 笔记录
          </p>
        )}
        {agg.count === 0 && (
          <p className="text-[11px] text-muted-foreground/70 mt-2 text-center flex items-center justify-center gap-1">
            <Users className="w-3 h-3" />
            该月暂无记录
          </p>
        )}
      </div>
    </motion.div>
  );
}
