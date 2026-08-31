import { motion } from "framer-motion";
import type { CategorySlice } from "@/lib/stats";

interface PieChartProps {
  slices: CategorySlice[];
  size?: number;
  /** 当前选中的分类（受控）；null 表示未选中，中心显示总支出 */
  selected?: string | null;
  /** 点击扇形回调；再次点击已选中的扇形时传 null */
  onSelect?: (name: string | null) => void;
}

// 分类配色（与 ExpenseCard 图标色系呼应）
const PALETTE = [
  "#f59e0b", // amber  Food
  "#3b82f6", // blue   Transport
  "#8b5cf6", // violet Shopping
  "#ec4899", // pink   Entertainment
  "#14b8a6", // teal   Bills
  "#ef4444", // red    Healthcare
  "#6366f1", // indigo Education
  "#d946ef", // fuchsia Personal Care
  "#f97316", // orange Travel
  "#64748b", // slate  Other
];

export function PieChart({ slices, size = 180, selected = null, onSelect }: PieChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const innerR = r * 0.58; // 环形

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return (
      <div
        className="rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs"
        style={{ width: size, height: size }}
      >
        暂无支出
      </div>
    );
  }

  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;

  // 从顶部 12 点钟方向开始顺时针
  let angle = 0;
  const arcs = slices.map((s, i) => {
    const sweep = s.ratio * 360;
    const start = angle;
    const end = angle + sweep;
    const mid = start + sweep / 2;
    angle = end;

    const largeArc = sweep > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(rad(start));
    const y1 = cy + r * Math.sin(rad(start));
    const x2 = cx + r * Math.cos(rad(end));
    const y2 = cy + r * Math.sin(rad(end));
    const x3 = cx + innerR * Math.cos(rad(end));
    const y3 = cy + innerR * Math.sin(rad(end));
    const x4 = cx + innerR * Math.cos(rad(start));
    const y4 = cy + innerR * Math.sin(rad(start));

    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
      "Z",
    ].join(" ");

    return { d, color: PALETTE[i % PALETTE.length], slice: s, mid };
  });

  const active = selected ? slices.find((s) => s.name === selected) : undefined;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((a, i) => {
        const isActive = selected === a.slice.name;
        const dimmed = selected !== null && !isActive;
        const off = isActive ? 7 : 0;
        return (
          <motion.path
            key={a.slice.name}
            d={a.d}
            fill={a.color}
            stroke="white"
            strokeWidth={isActive ? 2 : 1.5}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{
              opacity: dimmed ? 0.3 : 1,
              scale: 1,
              x: Math.cos(rad(a.mid)) * off,
              y: Math.sin(rad(a.mid)) * off,
            }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            style={{ cursor: onSelect ? "pointer" : "default" }}
            onClick={onSelect ? () => onSelect(isActive ? null : a.slice.name) : undefined}
          />
        );
      })}
      {/* 中心文字：未选中显示总支出，选中显示该分类明细 */}
      <g className="pointer-events-none">
        {active ? (
          <motion.g
            key={active.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            <text
              x={cx}
              y={cy - 14}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: size * 0.062 }}
            >
              {active.name}
            </text>
            <text
              x={cx}
              y={cy + 3}
              textAnchor="middle"
              className="fill-foreground font-semibold"
              style={{ fontSize: size * 0.095 }}
            >
              ¥{active.value.toFixed(0)}
            </text>
            <text
              x={cx}
              y={cy + 17}
              textAnchor="middle"
              className="fill-muted-foreground tabular-nums"
              style={{ fontSize: size * 0.062 }}
            >
              占比 {(active.ratio * 100).toFixed(1)}%
            </text>
          </motion.g>
        ) : (
          <motion.g key="total" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              className="fill-foreground font-semibold"
              style={{ fontSize: size * 0.11 }}
            >
              ¥{total.toFixed(0)}
            </text>
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: size * 0.07 }}
            >
              总支出
            </text>
          </motion.g>
        )}
      </g>
    </svg>
  );
}

export { PALETTE };
