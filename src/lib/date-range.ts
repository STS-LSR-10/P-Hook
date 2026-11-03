import { bangkokParts, fromBangkok, monthName, yearOf } from "@/lib/thai-date";
import { t } from "@/lib/i18n";

/** A calendar day (Bangkok time). */
export interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const MONTHS_FULL = [
  t("มกราคม"),
  t("กุมภาพันธ์"),
  t("มีนาคม"),
  t("เมษายน"),
  t("พฤษภาคม"),
  t("มิถุนายน"),
  t("กรกฎาคม"),
  t("สิงหาคม"),
  t("กันยายน"),
  t("ตุลาคม"),
  t("พฤศจิกายน"),
  t("ธันวาคม"),
];

/** "2026-10-05": a day as a key (sorts and compares as text). */
export const ymdKey = (d: Ymd): string => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export const sameDay = (a: Ymd, b: Ymd): boolean => ymdKey(a) === ymdKey(b);

/** <0 when a is before b, 0 when equal, >0 when after. */
export const compareYmd = (a: Ymd, b: Ymd): number => ymdKey(a).localeCompare(ymdKey(b));

export function ymdOf(date: Date): Ymd {
  const p = bangkokParts(date);
  return { year: p.year, month: p.month, day: p.day };
}

/** The day moved by `days` (negative goes back); month and year overflow is handled. */
export function addDays(d: Ymd, days: number): Ymd {
  return ymdOf(fromBangkok(d.year, d.month, d.day + days));
}

/** Every day of a month as weeks starting on Sunday, with the days around it filled in. */
export function monthGrid(year: number, month: number): (Ymd & { inMonth: boolean })[] {
  const first = ymdOf(fromBangkok(year, month, 1));
  const lead = bangkokParts(fromBangkok(year, month, 1)).weekday; // 0 = Sunday
  const inMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((lead + inMonth) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = addDays(first, i - lead);
    return { ...d, inMonth: d.month === month && d.year === year };
  });
}

/** The API's `from` (included) and `to` (excluded) for a first and last day. */
export function rangeToFilter(start: Ymd, end: Ymd): { from: string; to: string } {
  return {
    from: fromBangkok(start.year, start.month, start.day).toISOString(),
    to: fromBangkok(end.year, end.month, end.day + 1).toISOString(),
  };
}

export type Preset = "month" | "week" | "lastMonth";

/** The quick choices of the calendar: this month, this week (Monday to Sunday), last month. */
export function presetRange(preset: Preset, now: Date): { start: Ymd; end: Ymd } {
  const t = ymdOf(now);
  if (preset === "week") {
    const sinceMonday = (bangkokParts(now).weekday + 6) % 7;
    const start = addDays(t, -sinceMonday);
    return { start, end: addDays(start, 6) };
  }
  const month = preset === "month" ? t.month : t.month - 1;
  const start = ymdOf(fromBangkok(t.year, month, 1));
  const end = ymdOf(fromBangkok(t.year, month + 1, 0));
  return { start, end };
}

const fmt = (d: Ymd) => `${d.day} ${monthName(d.month)} ${yearOf(d.year)}`;

/** "1 ต.ค. 2569 — 31 ต.ค. 2569" */
export const formatRange = (start: Ymd, end: Ymd): string => `${fmt(start)} — ${fmt(end)}`;
