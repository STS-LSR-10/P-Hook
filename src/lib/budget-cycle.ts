import type { BudgetCycle } from "@/lib/types";
import { bangkokParts, fromBangkok } from "@/lib/thai-date";

export interface DateRange {
  /** inclusive */
  from: Date;
  /** exclusive */
  to: Date;
}

/** Bangkok calendar day containing `now`. */
export function dayRange(now: Date): DateRange {
  const p = bangkokParts(now);
  return { from: fromBangkok(p.year, p.month, p.day), to: fromBangkok(p.year, p.month, p.day + 1) };
}

/** Bangkok calendar month containing `now`. */
export function calendarMonthRange(now: Date): DateRange {
  const p = bangkokParts(now);
  return { from: fromBangkok(p.year, p.month, 1), to: fromBangkok(p.year, p.month + 1, 1) };
}

/** The highest day a monthly cycle may start on. */
export const MAX_START_DAY = 31;

/** A start day kept to 1-31. */
export const clampStartDay = (day: number) => Math.min(Math.max(Math.trunc(day), 1), MAX_START_DAY);

/**
 * 00:00 Bangkok on `day` of the month, or on the month's last day when the month is shorter
 * (31 in April is the 30th). `month` may run outside 1-12 and rolls over the year.
 */
export function monthStart(year: number, month: number, day: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return fromBangkok(y, m, Math.min(clampStartDay(day), last));
}

/**
 * The budget cycle containing `now`.
 * monthly: starts on `startDay` (1-31; the last day of a shorter month) each month;
 * weekly: starts on Monday.
 */
export function cycleRange(now: Date, cycle: BudgetCycle, startDay = 1): DateRange {
  const p = bangkokParts(now);
  if (cycle === "weekly") {
    const sinceMonday = (p.weekday + 6) % 7;
    return {
      from: fromBangkok(p.year, p.month, p.day - sinceMonday),
      to: fromBangkok(p.year, p.month, p.day - sinceMonday + 7),
    };
  }
  const startMonth = now >= monthStart(p.year, p.month, startDay) ? p.month : p.month - 1;
  return {
    from: monthStart(p.year, startMonth, startDay),
    to: monthStart(p.year, startMonth + 1, startDay),
  };
}
