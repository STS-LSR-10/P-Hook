import type { DateRange } from "@/lib/budget-cycle";
import { addLocalDays, bangkokParts, fromBangkok, isValidYmd } from "@/lib/thai-date";

/** A day as typed: the year is optional ("25/9" or "25/9/2026", Buddhist years allowed). */
export interface DaySpec {
  day: number;
  month: number;
  year: number | null;
}

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

export type RangeResult =
  | {
      ok: true;
      /** [from, to): from 00:00 of the first day to 00:00 after the last day (Bangkok). */
      range: DateRange;
      /** The same length right before `range`. */
      previous: DateRange;
      days: number;
      /** The last day included. */
      lastDay: Date;
    }
  | { ok: false; reason: "invalid" | "order" | "too_long" };

/** Gregorian year from what was typed: 2569 -> 2026, 26 -> 2026. */
function gregorian(year: number): number {
  if (year >= 2400) return year - 543;
  if (year < 100) return year + 2000;
  return year;
}

/**
 * The latest year in which day/month is not after `limit` (no year typed -> "the most recent one",
 * like a backdated entry). Null when the date does not exist in any recent year.
 */
function latestYmd(spec: DaySpec, limit: Date): Date | null {
  const lim = bangkokParts(limit);
  for (let year = lim.year; year >= lim.year - 4; year--) {
    if (!isValidYmd(year, spec.month, spec.day)) continue;
    const at = fromBangkok(year, spec.month, spec.day);
    if (at.getTime() <= limit.getTime()) return at;
  }
  return null;
}

function resolveDay(spec: DaySpec, limit: Date): Date | null {
  if (spec.year === null) return latestYmd(spec, limit);
  const year = gregorian(spec.year);
  return isValidYmd(year, spec.month, spec.day) ? fromBangkok(year, spec.month, spec.day) : null;
}

/**
 * The days a person asked for, e.g. "25/9 ถึง 24/10". `end` null means today. An end after today is
 * cut to today; a start without a year is the latest such date not after the end.
 */
export function resolveRange(start: DaySpec, end: DaySpec | null, now: Date): RangeResult {
  const today = bangkokParts(now);
  const todayStart = fromBangkok(today.year, today.month, today.day);

  let last = end ? resolveDay(end, todayStart) : todayStart;
  if (end && end.year !== null && last && last.getTime() > todayStart.getTime()) last = todayStart;
  if (!last) return { ok: false, reason: "invalid" };

  const first = resolveDay(start, last);
  if (!first) return { ok: false, reason: "invalid" };
  if (first.getTime() > last.getTime()) return { ok: false, reason: "order" };

  const days = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, reason: "too_long" };

  const to = fromBangkok(
    bangkokParts(last).year,
    bangkokParts(last).month,
    bangkokParts(last).day + 1,
  );
  return {
    ok: true,
    range: { from: first, to },
    previous: { from: addLocalDays(first, -days), to: first },
    days,
    lastDay: last,
  };
}

/** "2026-10-12" from the LINE date picker as a DaySpec (null when it is not a real date). */
export function daySpecFromIso(value: string | undefined): DaySpec | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const spec = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidYmd(spec.year, spec.month, spec.day) ? spec : null;
}
