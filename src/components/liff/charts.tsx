"use client";

/**
 * Recharts lives only in this file so the analytics pages can load it lazily
 * (next/dynamic): the other pages never download the charting library.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/lib/money";
import { sliceColor } from "@/components/liff/slice-color";

// the page theme (tokens.css) decides the colours; graphical objects need 3:1, which they meet
export const INCOME_FILL = "var(--income)";
export const EXPENSE_FILL = "var(--expense)";
const LINE = "var(--primary)";

const compact = (baht: number) => {
  const abs = Math.abs(baht);
  const sign = baht < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${sign}${abs}`;
};

/** A chart value (whole units) with the person's currency sign. */
const unitsMoney = (v: unknown) => money(Math.round(Number(v) * 100));

export interface FlowPoint {
  label: string;
  income: number; // baht, for drawing only
  expense: number;
}

export function FlowBarChart({ data }: { data: FlowPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.25} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={compact} />
          <Tooltip
            formatter={(v, name) => [unitsMoney(v), name === "income" ? "รายรับ" : "รายจ่าย"]}
          />
          <Bar dataKey="income" fill={INCOME_FILL} radius={[6, 6, 0, 0]} />
          <Bar dataKey="expense" fill={EXPENSE_FILL} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutSlice {
  key: string;
  name: string;
  value: number; // baht
  color: string | null;
}

export function CategoryDonutChart({ slices }: { slices: DonutSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius={56}
          outerRadius={86}
          paddingAngle={2}
          stroke="none"
        >
          {slices.map((s, i) => (
            <Cell key={s.key} fill={sliceColor(s.color, i)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

/** The small ring on the summary page (the share of each category in the spending). */
export function MiniDonut({ slices }: { slices: DonutSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius="68%"
          outerRadius="100%"
          paddingAngle={2}
          stroke="none"
          isAnimationActive={false}
        >
          {slices.map((s, i) => (
            <Cell key={s.key} fill={sliceColor(s.color, i)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Six small bars (one per month) for the history inside the category sheet. */
export function MiniBarChart({ points }: { points: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} />
        <Tooltip formatter={(v) => [unitsMoney(v), "ใช้จ่าย"]} cursor={false} />
        <Bar
          dataKey="value"
          fill="var(--primary)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface SavingsPoint {
  label: string;
  net: number; // baht kept in the period
  total: number; // baht kept so far
}

export function SavingsChart({ points }: { points: SavingsPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.25} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={compact} />
          <Tooltip
            formatter={(v, name) => [unitsMoney(v), name === "net" ? "เก็บได้" : "เก็บสะสม"]}
          />
          <Bar dataKey="net" radius={[6, 6, 0, 0]}>
            {points.map((p, i) => (
              <Cell key={i} fill={p.net >= 0 ? INCOME_FILL : EXPENSE_FILL} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="total" stroke={LINE} strokeWidth={3} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface GoalPoint {
  label: string;
  total: number; // baht saved so far
}

/** Money saved over time towards a goal, with the target as a dashed line. */
export function GoalChart({ points, target }: { points: GoalPoint[]; target: number }) {
  return (
    <div className="h-48 w-full" role="img" aria-label="กราฟยอดออมสะสม">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.25} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={compact}
            domain={[0, Math.max(target, ...points.map((p) => p.total))]}
          />
          <Tooltip formatter={(v) => [unitsMoney(v), "ออมสะสม"]} />
          <ReferenceLine y={target} stroke={EXPENSE_FILL} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="total" stroke={LINE} strokeWidth={3} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
