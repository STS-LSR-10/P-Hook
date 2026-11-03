import type { DateRange } from "@/lib/budget-cycle";
import { previousRange } from "@/lib/summary-report";
import { addLocalDays, bangkokParts, fromBangkok } from "@/lib/thai-date";

const DAY_MS = 86_400_000;

export interface SpanPair {
  current: DateRange;
  previous: DateRange;
  /** Days covered on each side (the previous side can be shorter if its month is). */
  days: number;
}

/**
 * This budget cycle so far against the same number of days at the start of the cycle before, so
 * half a month is never held against a whole one. On the last day of a cycle the two spans are the
 * whole cycles (the earlier one is cut to its own length if it is shorter). `startDay`: the chosen
 * start day of a monthly cycle (see `previousRange`).
 */
export function sameSpanRanges(cycle: DateRange, now: Date, startDay?: number): SpanPair {
  const today = bangkokParts(now);
  const tomorrow = fromBangkok(today.year, today.month, today.day + 1);
  const end = tomorrow.getTime() < cycle.to.getTime() ? tomorrow : cycle.to;
  const days = Math.max(1, Math.round((end.getTime() - cycle.from.getTime()) / DAY_MS));

  const before = previousRange("monthly", cycle, startDay);
  const spanEnd = Math.min(addLocalDays(before.from, days).getTime(), before.to.getTime());
  return {
    current: { from: cycle.from, to: end },
    previous: { from: before.from, to: new Date(spanEnd) },
    days,
  };
}

export type ChangeKind = "up" | "down" | "same" | "new" | "gone";

export interface CompareRow {
  name: string;
  currentSatang: number;
  previousSatang: number;
  /** Whole percent against the previous side; null when there is nothing to divide by. */
  changePercent: number | null;
  kind: ChangeKind;
  /** The "อื่นๆ (n หมวด)" line that gathers the smallest categories. */
  other?: boolean;
}

export const MAX_COMPARE_ROWS = 8;

function describe(current: number, previous: number) {
  if (previous <= 0) {
    return { kind: (current > 0 ? "new" : "same") as ChangeKind, changePercent: null };
  }
  if (current <= 0) return { kind: "gone" as ChangeKind, changePercent: -100 };
  const changePercent = Math.round(((current - previous) * 100) / previous);
  const kind: ChangeKind = current > previous ? "up" : current < previous ? "down" : "same";
  return { kind, changePercent };
}

/**
 * Expense per category on both sides, joined by category name. Biggest this period first, then the
 * ones that were only in the earlier period; categories with nothing on either side are dropped.
 * Past `max` rows the rest become one line.
 */
export function buildCompareRows(
  current: { name: string; amountSatang: number }[],
  previous: { name: string; amountSatang: number }[],
  max = MAX_COMPARE_ROWS,
): CompareRow[] {
  const byName = new Map<string, { cur: number; prev: number }>();
  for (const c of current) {
    const e = byName.get(c.name) ?? { cur: 0, prev: 0 };
    e.cur += c.amountSatang;
    byName.set(c.name, e);
  }
  for (const p of previous) {
    const e = byName.get(p.name) ?? { cur: 0, prev: 0 };
    e.prev += p.amountSatang;
    byName.set(p.name, e);
  }
  const all = [...byName.entries()]
    .map(([name, v]) => ({ name, cur: v.cur, prev: v.prev }))
    .filter((r) => r.cur > 0 || r.prev > 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev);

  const head = all.slice(0, max);
  const rest = all.slice(max);
  const rows: CompareRow[] = head.map((r) => ({
    name: r.name,
    currentSatang: r.cur,
    previousSatang: r.prev,
    ...describe(r.cur, r.prev),
  }));
  if (rest.length > 0) {
    const cur = rest.reduce((s, r) => s + r.cur, 0);
    const prev = rest.reduce((s, r) => s + r.prev, 0);
    rows.push({
      name: `อื่นๆ (${rest.length} หมวด)`,
      currentSatang: cur,
      previousSatang: prev,
      ...describe(cur, prev),
      other: true,
    });
  }
  return rows;
}

/** The total of one side, and the same change description as a row. */
export function describeTotals(current: number, previous: number) {
  return { currentSatang: current, previousSatang: previous, ...describe(current, previous) };
}
