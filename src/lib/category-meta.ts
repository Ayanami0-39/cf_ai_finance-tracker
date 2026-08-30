import {
  Utensils,
  Car,
  ShoppingBag,
  Film,
  Receipt,
  HeartPulse,
  GraduationCap,
  Sparkles,
  Plane,
  Banknote,
  Package,
  Coffee,
  type LucideIcon,
} from "lucide-react";

/**
 * 分类视觉元数据：图标 + 渐变底色（与 PieChart PALETTE 色系一一对应）。
 * 列表图标、编辑弹窗等处统一从这里取，保证全站分类视觉一致。
 */
export interface CategoryMeta {
  icon: LucideIcon;
  /** Tailwind gradient stops，用于图标底衬 */
  gradient: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  "Food & Dining": { icon: Utensils, gradient: "from-amber-400 to-orange-500" },
  Transportation: { icon: Car, gradient: "from-sky-400 to-blue-500" },
  Shopping: { icon: ShoppingBag, gradient: "from-violet-400 to-purple-500" },
  Entertainment: { icon: Film, gradient: "from-pink-400 to-rose-500" },
  "Bills & Utilities": { icon: Receipt, gradient: "from-teal-400 to-emerald-500" },
  Healthcare: { icon: HeartPulse, gradient: "from-red-400 to-rose-500" },
  Education: { icon: GraduationCap, gradient: "from-indigo-400 to-blue-500" },
  "Personal Care": { icon: Sparkles, gradient: "from-fuchsia-400 to-pink-500" },
  Travel: { icon: Plane, gradient: "from-orange-400 to-amber-500" },
  Income: { icon: Banknote, gradient: "from-emerald-400 to-teal-500" },
  Other: { icon: Package, gradient: "from-slate-400 to-gray-500" },
};

/** 兜底：Coffee 等旧分类映射到 Food 配色 */
export function resolveCategoryMeta(category: string): CategoryMeta {
  if (CATEGORY_META[category]) return CATEGORY_META[category];
  const lower = category.toLowerCase();
  if (lower.includes("coffee")) {
    return { icon: Coffee, gradient: CATEGORY_META["Food & Dining"].gradient };
  }
  return CATEGORY_META["Other"];
}
