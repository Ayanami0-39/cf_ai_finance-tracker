import type { CategorySlice } from "@/lib/stats";

interface PieChartProps {
  slices: CategorySlice[];
  size?: number;
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

export function PieChart({ slices, size = 180 }: PieChartProps) {
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

  let angle = -90; // 从顶部开始
  const arcs = slices.map((s, i) => {
    const sweep = s.ratio * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;

    const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
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

    return { d, color: PALETTE[i % PALETTE.length], slice: s };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((a, i) => (
        <path key={i} d={a.d} fill={a.color} stroke="white" strokeWidth="1.5" />
      ))}
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
    </svg>
  );
}

export { PALETTE };
