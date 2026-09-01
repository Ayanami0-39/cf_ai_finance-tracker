import { useMemo, useState, useEffect, useRef } from "react";
import type { Expense } from "@/types";
import { accountApi, getAccount } from "@/lib/account";
import { api } from "@/lib/api";
import {
  aggregateMonth,
  aggregateDateRange,
  categorySlices,
  changeRate,
  monthLabel,
  monthKey,
  recentMonths,
  shiftMonth,
  type MonthAgg,
} from "@/lib/stats";
import { PieChart, PALETTE } from "./PieChart";
import { normalizeIncomeMerchant } from "@/lib/income-merchant";
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
  Store,
  CalendarRange,
  Sparkles,
  Loader2,
  Coins,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface StatsSectionProps {
  expenses: Expense[];
}

// ===== 周视图工具 =====

/** ISO 周起始（周一）日期字符串 */
function weekStartOf(d: Date): string {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 周一=0
  date.setDate(date.getDate() - day);
  return toDateStr(date);
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toDateStr(dt);
}

export function StatsSection({ expenses }: StatsSectionProps) {
  const [cursor, setCursor] = useState<string>(() => monthKey(new Date()));
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [trendMonth, setTrendMonth] = useState<string | null>(null);
  // 月视图 / 周视图切换
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [weekAnchor, setWeekAnchor] = useState<string>(() => toDateStr(new Date()));
  const [showReport, setShowReport] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // 切换月份时清空图表选中态
  useEffect(() => {
    setSelectedCategory(null);
    setTrendMonth(null);
  }, [cursor, weekAnchor]);

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

  // ---- 作用区间：月视图按 cursor 月；周视图按 weekAnchor 所在周 ----
  const range = useMemo(() => {
    if (viewMode === "week") {
      const from = weekStartOf(new Date(weekAnchor + "T00:00:00"));
      const to = addDays(from, 6);
      const label = `${from.slice(5).replace("-", "/")} ~ ${to.slice(5).replace("-", "/")}`;
      return { from, to, label };
    }
    return null;
  }, [viewMode, weekAnchor]);

  const agg = useMemo(() => {
    if (viewMode === "week" && range) return aggregateDateRange(filtered, range.from, range.to);
    return aggregateMonth(filtered, cursor);
  }, [filtered, cursor, viewMode, range]);

  // 对比区间：月视图比上月；周视图比上一周
  const prevAgg = useMemo(() => {
    if (viewMode === "week" && range) {
      return aggregateDateRange(filtered, addDays(range.from, -7), addDays(range.to, -7));
    }
    return aggregateMonth(filtered, shiftMonth(cursor, -1));
  }, [filtered, cursor, viewMode, range]);

  const lastYearAgg = useMemo(
    () => aggregateMonth(filtered, shiftMonth(cursor, -12)),
    [filtered, cursor]
  );

  const trend = useMemo(
    () => recentMonths(filtered, cursor, 6),
    [filtered, cursor]
  );
  // 6 个月合计的分类金额降序作为堆叠顺序，保证各月颜色一致（柱图与明细共用）
  const trendStackOrder = useMemo(() => {
    const sum: Record<string, number> = {};
    for (const t of trend)
      for (const [c, v] of Object.entries(t.agg.byCategory))
        sum[c] = (sum[c] || 0) + v;
    return Object.entries(sum)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [trend]);
  const slices = useMemo(() => categorySlices(agg.byCategory), [agg]);

  const mom = changeRate(agg.expense, prevAgg.expense);

  // 日均支出：当前月按已过天数折算，历史月份按整月天数；周视图按已过天数（未来周按 7 天）
  const dailyAvg = useMemo(() => {
    if (viewMode === "week" && range) {
      const today = toDateStr(new Date());
      const days = range.to >= today ? Math.max(1, daysBetween(range.from, today) + 1) : 7;
      return days > 0 ? agg.expense / days : 0;
    }
    const [y, m] = cursor.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const now = new Date();
    const isCurrent = cursor === monthKey(now);
    const days = isCurrent ? now.getDate() : daysInMonth;
    return days > 0 ? agg.expense / days : 0;
  }, [agg.expense, cursor, viewMode, range]);

  const currentMonthKey = monthKey(new Date());
  const canGoNext =
    viewMode === "week"
      ? range ? range.to < toDateStr(new Date()) : false
      : cursor < currentMonthKey;

  const hasAny =
    viewMode === "week" && range
      ? filtered.some((e) => e.date >= range.from && e.date <= range.to)
      : filtered.some((e) => e.date?.slice(0, 7) === cursor);

  // 周视图导航时同步移动 weekAnchor
  const goPrev = () => {
    if (viewMode === "week" && range) setWeekAnchor(addDays(range.from, -7));
    else setCursor(shiftMonth(cursor, -1));
  };
  const goNext = () => {
    if (viewMode === "week" && range) setWeekAnchor(addDays(range.from, 7));
    else setCursor(shiftMonth(cursor, 1));
  };

  // ---- 分类环比（当月 vs 上月，按分类金额） ----
  const categoryMom = useMemo(() => {
    const prevByCat = prevAgg.byCategory;
    return Object.entries(agg.byCategory)
      .map(([name, value]) => ({
        name,
        value,
        prev: prevByCat[name] || 0,
        rate: prevByCat[name] > 0 ? (value - prevByCat[name]) / prevByCat[name] : null,
      }))
      .sort((a, b) => b.value - a.value);
  }, [agg, prevAgg]);

  // 涨幅最快的分类（涨幅绝对值最大且本期有消费）
  const fastestGrowing = useMemo(
    () =>
      [...categoryMom]
        .filter((c) => c.rate !== null)
        .sort((a, b) => (b.rate! - a.rate!))[0] || null,
    [categoryMom]
  );

  // ---- Top 商户（支出，按 merchant 聚合） ----
  const topMerchants = useMemo(() => {
    const inRange = viewMode === "week" && range
      ? filtered.filter((e) => e.date >= range.from && e.date <= range.to)
      : filtered.filter((e) => e.date?.slice(0, 7) === cursor);
    const byMerchant: Record<string, number> = {};
    for (const e of inRange) {
      if (e.type === "income") continue;
      const key = (e.merchant || e.description || "其他").trim().slice(0, 10) || "其他";
      byMerchant[key] = (byMerchant[key] || 0) + e.amount;
    }
    return Object.entries(byMerchant)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [filtered, cursor, viewMode, range]);

  // ---- 收入来源分析（收入，按 merchant/description 聚合） ----
  const incomeSources = useMemo(() => {
    const inRange = viewMode === "week" && range
      ? filtered.filter((e) => e.date >= range.from && e.date <= range.to)
      : filtered.filter((e) => e.date?.slice(0, 7) === cursor);
    const incomes = inRange.filter((e) => e.type === "income");
    const total = incomes.reduce((s, e) => s + e.amount, 0);
    const bySource: Record<string, number> = {};
    for (const e of incomes) {
      const raw = (e.merchant || e.description || "其他收入").trim();
      const key = normalizeIncomeMerchant(raw) || "其他收入";
      bySource[key] = (bySource[key] || 0) + e.amount;
    }
    return {
      total,
      list: Object.entries(bySource)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, v]) => ({ name, value: v, ratio: total > 0 ? v / total : 0 })),
    };
  }, [filtered, cursor, viewMode, range]);

  // ---- AI 月报生成（仅月视图可用） ----
  const handleGenerateReport = async () => {
    const account = getAccount();
    if (!account) return;
    setReportLoading(true);
    setReportError(null);
    setReportText(null);
    try {
      const res = await api.getMonthlyReport(
        account.scopeId,
        cursor,
        memberFilter
      );
      if (res.success && res.report) {
        setReportText(res.report);
        setShowReport(true);
      } else {
        setReportError(res.error || "生成失败，请稍后再试");
        setShowReport(true);
      }
    } catch {
      setReportError("网络异常，生成失败");
      setShowReport(true);
    } finally {
      setReportLoading(false);
    }
  };

  const filterLabel =
    memberFilter === "all"
      ? "全部成员"
      : memberNameOf(memberFilter);

  const periodLabel = viewMode === "week" && range ? range.label : monthLabel(cursor);

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
              按月或按周查看收支与分类占比
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

        {/* Period navigator：月/周切换 + 前后导航 */}
        <div className="flex items-center gap-2 bg-card border rounded-xl px-3 py-2.5 mb-4">
          <button
            type="button"
            aria-label="上一期"
            onClick={goPrev}
            className="w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors active:bg-muted flex-shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground tabular-nums flex-1 text-center">
            {periodLabel}
          </span>
          <button
            type="button"
            aria-label="下一期"
            disabled={!canGoNext}
            onClick={goNext}
            className="w-9 h-9 rounded-lg hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center text-muted-foreground transition-colors active:bg-muted flex-shrink-0"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          {/* 月 / 周切换 */}
          <div className="flex bg-muted rounded-lg p-0.5 flex-shrink-0 ml-1">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`px-2.5 h-7 text-xs rounded-md transition-colors ${
                viewMode === "month"
                  ? "bg-card shadow-sm text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              月
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`px-2.5 h-7 text-xs rounded-md transition-colors ${
                viewMode === "week"
                  ? "bg-card shadow-sm text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              周
            </button>
          </div>
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
              className="grid grid-cols-2 gap-2 md:gap-3"
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

            {/* Change rates: MoM / YoY（周视图显示周环比 + 近6月趋势参考） */}
            <motion.div className="grid grid-cols-2 gap-2 md:gap-3" variants={cardVariants}>
              <ChangeCard
                title={viewMode === "week" ? "环比上周" : "环比上月"}
                base={prevAgg.expense}
                rate={mom}
              />
              {viewMode === "week" ? (
                <div className="bg-card border rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1.5">统计区间</p>
                  <p className="text-sm text-foreground flex items-center gap-1.5">
                    <CalendarRange className="w-3.5 h-3.5 text-muted-foreground" />
                    {range?.label}
                  </p>
                </div>
              ) : (
                <ChangeCard
                  title="同比去年"
                  base={lastYearAgg.expense}
                  rate={changeRate(agg.expense, lastYearAgg.expense)}
                />
              )}
            </motion.div>

            {/* Category pie + ranking + 分类环比箭头 */}
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
                  本期没有支出记录
                </p>
              ) : (
                <div className="flex flex-col items-center gap-4">
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
                      const cm = categoryMom.find((c) => c.name === s.name);
                      return (
                        <button
                          type="button"
                          key={s.name}
                          onClick={() =>
                            setSelectedCategory(isActive ? null : s.name)
                          }
                          className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors relative ${
                            isActive ? "bg-muted" : "hover:bg-muted/60 active:bg-muted"
                          }`}
                          style={{ opacity: dimmed ? 0.45 : 1 }}
                        >
                          {/* 选中指示竖条：与饼图选中态联动 */}
                          {isActive && (
                            <span
                              className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                              style={{ background: PALETTE[i % PALETTE.length] }}
                            />
                          )}
                          <span
                            className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${isActive ? "ring-2 ring-offset-1" : ""}`}
                            style={{
                              background: PALETTE[i % PALETTE.length],
                              ...(isActive
                                ? ({
                                    "--tw-ring-color": `${PALETTE[i % PALETTE.length]}55`,
                                    ringOffsetColor: "transparent",
                                  } as React.CSSProperties)
                                : {}),
                            }}
                          />
                          <span
                            className={`text-xs flex-1 min-w-0 truncate text-left ${
                              isActive ? "text-foreground font-semibold" : "text-foreground"
                            }`}
                          >
                            {s.name}
                          </span>
                          {/* 分类环比箭头：与上月/上周同分类对比 */}
                          {cm && cm.rate !== null && (
                            <span
                              title={`上期 ¥${cm.prev.toFixed(0)}`}
                              className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums flex-shrink-0 ${
                                cm.rate > 0
                                  ? "text-destructive"
                                  : cm.rate < 0
                                    ? "text-income"
                                    : "text-muted-foreground/60"
                              }`}
                            >
                              {cm.rate > 0 ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : cm.rate < 0 ? (
                                <TrendingDown className="w-3 h-3" />
                              ) : (
                                <Minus className="w-3 h-3" />
                              )}
                              {Math.abs(cm.rate * 100).toFixed(0)}%
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap flex-shrink-0">
                            ¥{s.value >= 1000 ? s.value.toFixed(0) : s.value.toFixed(2)}
                          </span>
                          <span className="text-xs text-muted-foreground/70 tabular-nums w-12 text-right flex-shrink-0">
                            {(s.ratio * 100).toFixed(1)}%
                          </span>
                        </button>
                      );
                    })}
                    {fastestGrowing && fastestGrowing.rate! > 0 && (
                      <p className="text-[10px] text-muted-foreground pt-1 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-destructive" />
                        {fastestGrowing.name}涨幅最快（+
                        {(fastestGrowing.rate! * 100).toFixed(0)}%）
                      </p>
                    )}
                  </div>
                </div>
              )}
            </motion.div>

            {/* Top 商户 + 收入来源（周/月通用） */}
            <motion.div
              className="grid grid-cols-1 gap-2 md:gap-3"
              variants={cardVariants}
            >
              <TopMerchantsCard merchants={topMerchants} total={agg.expense} />
              <IncomeSourcesCard
                sources={incomeSources.list}
                total={incomeSources.total}
              />
            </motion.div>

            {/* 6-month trend（仅月视图显示） */}
            {viewMode === "month" && (
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
                  stackOrder={trendStackOrder}
                />
                <AnimatePresence initial={false}>
                  {trendMonth && (
                    <TrendDetail
                      key={trendMonth}
                      monthKeyStr={trendMonth}
                      agg={trend.find((t) => t.key === trendMonth)!.agg}
                      isCursor={trendMonth === cursor}
                      stackOrder={trendStackOrder}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* AI 月报（仅月视图） */}
            {viewMode === "month" && (
              <motion.div className="bg-card border rounded-xl p-4" variants={cardVariants}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-primary" />
                      AI 消费报告
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      根据本月账单生成一段消费总结与建议
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateReport}
                    disabled={reportLoading}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors active:scale-95"
                  >
                    {reportLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        生成中…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        {reportText ? "重新生成" : "生成报告"}
                      </>
                    )}
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {showReport && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 rounded-lg bg-muted/50 border p-3">
                        {reportError ? (
                          <p className="text-xs text-destructive">{reportError}</p>
                        ) : (
                          <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                            {reportText}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
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
          ? `${memberName}在该时间段暂无数据`
          : "该时间段暂无数据"}
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
        className={`text-base md:text-lg font-semibold truncate ${
          tone === "expense"
            ? "text-destructive"
            : tone === "income"
              ? "text-income"
              : "text-foreground"
        }`}
      >
        <AnimatedNumber value={value} decimals={Math.abs(value) >= 1000 ? 0 : decimals} />
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

/** Top 商户排行（条形排行样式） */
function TopMerchantsCard({
  merchants,
  total,
}: {
  merchants: Array<[string, number]>;
  total: number;
}) {
  if (merchants.length === 0) {
    return (
      <div className="bg-card border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
          <Store className="w-4 h-4 text-muted-foreground" />
          消费商户 Top 5
        </h3>
        <p className="text-xs text-muted-foreground py-4 text-center">
          本期没有支出记录
        </p>
      </div>
    );
  }
  const max = merchants[0][1];
  return (
    <div className="bg-card border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
        <Store className="w-4 h-4 text-muted-foreground" />
        消费商户 Top 5
      </h3>
      <div className="space-y-2">
        {merchants.map(([name, value], i) => {
          // 渐变色阶：数值越高（排名越靠前）色号越深
          const fill = RANK_SHADES[i % RANK_SHADES.length];
          return (
          <div key={name} className="flex items-center gap-2">
            <span className="w-4 text-[10px] text-muted-foreground tabular-nums text-right flex-shrink-0">
              {i + 1}
            </span>
            <span className="text-xs text-foreground min-w-0 w-20 truncate flex-shrink-0">
              {name}
            </span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${fill}B3 0%, ${fill} 100%)`,
                }}
                initial={{ width: 0 }}
                animate={{ width: `${(value / max) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums text-right flex-shrink-0 whitespace-nowrap">
              <span className="text-foreground">¥{value.toFixed(0)}</span>
              {total > 0 && (
                <span className="text-muted-foreground/60"> · {((value / total) * 100).toFixed(0)}%</span>
              )}
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}

/** 收入来源分析 */
function IncomeSourcesCard({
  sources,
  total,
}: {
  sources: Array<{ name: string; value: number; ratio: number }>;
  total: number;
}) {
  return (
    <div className="bg-card border rounded-xl p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
        <Coins className="w-4 h-4 text-income" />
        收入来源分析
      </h3>
      {sources.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          本期没有收入记录
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            本期收入共 ¥{total >= 1000 ? total.toFixed(0) : total.toFixed(2)}，来自{" "}
            {sources.length} 个来源
          </p>
          {sources.map((s, i) => {
            // 渐变色阶：数值越高（排名越靠前）色号越深
            const fill = RANK_SHADES_GREEN[i % RANK_SHADES_GREEN.length];
            return (
            <div key={s.name} className="flex items-center gap-2">
              <span className="text-xs text-foreground min-w-0 w-20 truncate flex-shrink-0">
                {s.name}
              </span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${fill}B3 0%, ${fill} 100%)`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(s.ratio * 100, 4)}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums text-right flex-shrink-0 whitespace-nowrap">
                <span className="text-foreground">¥{s.value >= 1000 ? s.value.toFixed(0) : s.value.toFixed(0)}</span>
                <span className="text-muted-foreground/60"> · {(s.ratio * 100).toFixed(0)}%</span>
              </span>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- utils ----------

/** 排行条渐变色阶：数值越高（排名越靠前）色号越深，支出侧 primary 色系 */
const RANK_SHADES = ["#4f46e5", "#6366f1", "#818cf8", "#a5b4fc", "#c7d2fe"];
/** 收入侧绿色系（与 income 色呼应），同样由深到浅 */
const RANK_SHADES_GREEN = ["#15803d", "#16a34a", "#22c55e", "#4ade80", "#86efac"];

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000
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
  stackOrder,
}: {
  trend: Array<{ key: string; agg: MonthAgg }>;
  cursor: string;
  selected: string | null;
  onSelect: (key: string) => void;
  stackOrder: string[];
}) {
  const rawMax = Math.max(
    ...trend.map((t) => Math.max(t.agg.expense, t.agg.income)),
    1
  );
  const scaleMax = niceMax(rawMax);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((r) => Math.round(scaleMax * r));

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
            const topIdx = stack.findIndex((seg) => seg.value > 0);
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
                  {/* 支出：按分类堆叠的多色柱（金额大的分类在前 → 渲染在上，圆角给最上段） */}
                  <div className="w-2.5 md:w-3 h-full flex flex-col justify-end overflow-hidden">
                    {stack.map((seg, si) =>
                      seg.value > 0 ? (
                        <motion.div
                          key={seg.name}
                          className={`w-full ${si === topIdx ? "rounded-t" : ""}`}
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
                  {/* 收入：与支出柱同宽同圆角，仅颜色不同 */}
                  <motion.div
                    className={`w-2.5 md:w-3 rounded-t bg-income/60 ${
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
      {/* 图例：收入（绿）居首，分类按堆叠顺序排列 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-border/50">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="w-2 h-2 rounded-sm bg-income/70" />
          收入
        </span>
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
      </div>
    </div>
  );
}

/** 点击柱状图后展开的当月明细 */
function TrendDetail({
  monthKeyStr,
  agg,
  isCursor,
  stackOrder,
}: {
  monthKeyStr: string;
  agg: MonthAgg;
  isCursor: boolean;
  stackOrder: string[];
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
        {/* 支出分类占比：与柱图同色，仅列出有金额的分类 */}
        {agg.expense > 0 && (
          <div className="mt-3 pt-2.5 border-t border-border/50 space-y-1.5">
            <p className="text-[10px] text-muted-foreground">支出分类占比</p>
            {Object.entries(agg.byCategory)
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([name, value]) => {
                const colorIdx = stackOrder.indexOf(name);
                const ratio = agg.expense > 0 ? value / agg.expense : 0;
                return (
                  <div key={name} className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{
                        background: PALETTE[(colorIdx >= 0 ? colorIdx : 0) % PALETTE.length],
                      }}
                    />
                    <span className="text-[11px] text-foreground truncate flex-1 min-w-0">
                      {name}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      ¥{value >= 1000 ? value.toFixed(0) : value.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right whitespace-nowrap">
                      {(ratio * 100).toFixed(1)}%
                    </span>
                  </div>
                );
              })}
          </div>
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
