import type { Command } from "@/lib/commands";
import type { DaySpec } from "@/lib/summary-range";
import { addLocalDays, bangkokParts, fromBangkok, isValidYmd } from "@/lib/thai-date";

/**
 * The days a question about money can be about. The AI only names one; the dates themselves are
 * worked out here, from the person's own today, so a model that cannot count days does no harm.
 */
export const QUERY_PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "this_year",
  "last_year",
  "custom",
] as const;
export type QueryPeriod = (typeof QUERY_PERIODS)[number];

export interface MoneyQuery {
  period: QueryPeriod;
  /** "2026-10-05", only for `custom`. */
  fromDate: string | null;
  toDate: string | null;
  /** One thing the question is about ("กาแฟ"), or null for everything. */
  searchTerm: string | null;
}

const daySpec = (d: Date): DaySpec => {
  const p = bangkokParts(d);
  return { year: p.year, month: p.month, day: p.day };
};

function isoDay(value: string | null): DaySpec | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const spec = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidYmd(spec.year, spec.month, spec.day) ? spec : null;
}

/** First and last day asked about ("today" when it runs up to now). Null when it cannot be told. */
function daysOf(q: MoneyQuery, now: Date): { start: DaySpec; end: DaySpec | "today" } | null {
  const p = bangkokParts(now);
  const today = fromBangkok(p.year, p.month, p.day);
  const back = (n: number) => daySpec(addLocalDays(today, -n));
  // weeks start on Monday
  const sinceMonday = (p.weekday + 6) % 7;
  switch (q.period) {
    case "today":
      return { start: daySpec(today), end: "today" };
    case "yesterday":
      return { start: back(1), end: back(1) };
    case "this_week":
      return { start: back(sinceMonday), end: "today" };
    case "last_week":
      return { start: back(sinceMonday + 7), end: back(sinceMonday + 1) };
    case "this_month":
      return { start: { year: p.year, month: p.month, day: 1 }, end: "today" };
    case "last_month": {
      const lastDay = daySpec(addLocalDays(fromBangkok(p.year, p.month, 1), -1));
      return { start: { ...lastDay, day: 1 }, end: lastDay };
    }
    case "last_7_days":
      return { start: back(6), end: "today" };
    case "last_30_days":
      return { start: back(29), end: "today" };
    case "this_year":
      return { start: { year: p.year, month: 1, day: 1 }, end: "today" };
    case "last_year":
      return {
        start: { year: p.year - 1, month: 1, day: 1 },
        end: { year: p.year - 1, month: 12, day: 31 },
      };
    case "custom": {
      const start = isoDay(q.fromDate);
      const end = isoDay(q.toDate);
      return start && end ? { start, end } : null;
    }
  }
}

/**
 * "เดือนที่แล้วใช้ไปเท่าไร", "อาทิตย์นี้กินกาแฟไปกี่บาท": the command that answers it with the
 * person's own numbers, added up by the code (never by the AI). Null when the days make no sense.
 */
export function queryCommand(q: MoneyQuery, now: Date): Command | null {
  const term = q.searchTerm?.trim() || null;
  if (!term && q.period === "today") return { kind: "summary", scope: "today" };
  if (!term && q.period === "this_month") return { kind: "summary", scope: "month" };
  const days = daysOf(q, now);
  if (!days) return null;
  return term ? { kind: "search", term, ...days } : { kind: "summary-range", ...days };
}

/** Is this a real calendar day as "2026-10-05"? */
export const isIsoDay = (value: string | null): boolean => isoDay(value) !== null;
