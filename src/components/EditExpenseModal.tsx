import { useEffect, useRef, useState } from "react";
import { motion, type Variants } from "framer-motion";
import type { Expense } from "@/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Loader2, SquarePen, AlertCircle } from "lucide-react";
import { resolveCategoryMeta } from "@/lib/category-meta";

/** 分类选项（与 AI 分类列表一致，含收入） */
const CATEGORY_OPTIONS = [
  "Food & Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Bills & Utilities",
  "Healthcare",
  "Education",
  "Personal Care",
  "Travel",
  "Income",
  "Other",
] as const;

const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const panelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 24 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 30 },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 12,
    transition: { duration: 0.16, ease: "easeIn" },
  },
};

interface EditExpenseModalProps {
  expense: Expense;
  onClose: () => void;
  /** App 注入的保存逻辑：返回 Promise，成功 resolve 后关弹窗，失败 reject 显示错误 */
  onSave: (expenseId: string, patch: Partial<Expense>) => Promise<void>;
}

/** 交易记录编辑弹窗：修改日期、金额、类型、商家、分类、备注（带进出场动画与分段类型选择器） */
export function EditExpenseModal({
  expense,
  onClose,
  onSave,
}: EditExpenseModalProps) {
  const [date, setDate] = useState(expense.date);
  const [amount, setAmount] = useState(String(expense.amount));
  const [type, setType] = useState<"expense" | "income">(expense.type || "expense");
  const [merchant, setMerchant] = useState(expense.merchant || "");
  const [category, setCategory] = useState(expense.category || "Other");
  const [description, setDescription] = useState(expense.description || "");
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  // 退出动画结束后再真正卸载
  const finishClose = () => {
    if (closeTimer.current !== null) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 190);
  };

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  const requestClose = () => {
    if (saving) return;
    finishClose();
  };

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving]);

  const validateAndBuild = (): Partial<Expense> | null => {
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      setError("金额必须是大于 0 的数字");
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("请选择有效日期");
      return null;
    }
    const patch: Partial<Expense> = {};
    if (num !== expense.amount) patch.amount = num;
    if (date !== expense.date) patch.date = date;
    if (type !== (expense.type || "expense")) patch.type = type;
    if (merchant.trim() !== (expense.merchant || "")) patch.merchant = merchant.trim();
    if (category !== expense.category) patch.category = category;
    if (description.trim() !== (expense.description || "")) patch.description = description.trim();
    return patch;
  };

  const handleSave = async () => {
    if (saving || closing) return;
    setError(null);
    const patch = validateAndBuild();
    if (!patch) return;
    if (Object.keys(patch).length === 0) {
      finishClose();
      return;
    }

    setSaving(true);
    try {
      await onSave(expense.id, patch);
      finishClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  // 切换类型时联动分类（收入 ↔ Income）
  const handleTypeChange = (t: "expense" | "income") => {
    if (t === type) return;
    setType(t);
    if (t === "income") {
      if (category !== "Income") setCategory("Income");
    } else if (category === "Income") {
      setCategory("Other");
    }
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <motion.div
        variants={backdropVariants}
        initial="hidden"
        animate={closing ? "exit" : "visible"}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={requestClose}
      />

      {/* 面板 */}
      <motion.div
        variants={panelVariants}
        initial="hidden"
        animate={closing ? "exit" : "visible"}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-card border rounded-2xl shadow-2xl overflow-hidden">
          <div className="max-h-[85dvh] overflow-y-auto">
            {/* Header：图标 + 标题 + 原记录摘要 */}
            <div className="flex items-center gap-3 px-5 py-4 border-b sticky top-0 bg-card z-10">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <SquarePen className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground leading-tight">
                  编辑交易记录
                </h3>
                <p className="text-[11px] text-muted-foreground truncate">
                  ¥{expense.amount.toFixed(2)} · {expense.merchant || expense.category} · {expense.date}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={requestClose}
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <div className="px-5 py-4 space-y-4">
              {/* 金额：主角字段，大号输入 */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">金额</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-muted-foreground">
                    ¥
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={submitOnEnter}
                    autoFocus
                    className="h-12 pl-9 pr-3 text-lg font-semibold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>

              {/* 类型：分段选择器，滑块动画 */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">类型</label>
                <div className="relative grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted border border-border">
                  {(["expense", "income"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTypeChange(t)}
                      className={`relative h-8 rounded-md text-sm transition-colors ${
                        type === t
                          ? t === "expense"
                            ? "text-primary font-medium"
                            : "text-income font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {type === t && (
                        <motion.span
                          layoutId="edit-expense-type-pill"
                          className="absolute inset-0 rounded-md bg-card shadow-sm border border-border"
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10">{t === "expense" ? "支出" : "收入"}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 日期 + 分类 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">日期</label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">
                    分类{category ? ` · ${category}` : ""}
                  </label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {CATEGORY_OPTIONS.map((opt) => {
                      const m = resolveCategoryMeta(opt);
                      const Icon = m.icon;
                      const selected = category === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          title={opt}
                          aria-label={opt}
                          aria-pressed={selected}
                          onClick={() => setCategory(opt)}
                          className={`relative aspect-square rounded-lg bg-gradient-to-br ${m.gradient} flex items-center justify-center transition-all ${
                            selected
                              ? "ring-2 ring-primary ring-offset-1 ring-offset-card scale-105 shadow-md"
                              : "opacity-80 hover:opacity-100 hover:scale-105 active:scale-95"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 商家 */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">商家 / 项目</label>
                <Input
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  onKeyDown={submitOnEnter}
                  placeholder="如：星巴克、工资"
                  className="h-9 text-sm"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">备注</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="原始输入或补充说明"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {error && (
                <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-destructive leading-relaxed">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t sticky bottom-0 bg-card">
              <Button
                type="button"
                variant="ghost"
                onClick={requestClose}
                disabled={saving}
                className="h-9 text-sm"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="h-9 text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    保存中…
                  </>
                ) : (
                  "保存"
                )}
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
