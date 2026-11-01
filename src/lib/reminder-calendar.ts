import { bangkokParts, fromBangkok, toBangkokInputValue } from "@/lib/thai-date";
import type { ReminderDto, Repeat } from "@/lib/user-reminder";

const MAX_STEPS = 5000;

/** The round after `at`, in Bangkok time, stepping as `claim_due_reminders` does. */
export function nextOccurrence(at: Date, repeat: Repeat): Date {
  const { year, month, day, hour, minute } = bangkokParts(at);
  if (repeat === "daily") return fromBangkok(year, month, day + 1, hour, minute);
  if (repeat === "weekly") return fromBangkok(year, month, day + 7, hour, minute);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromBangkok(year, month + 1, Math.min(day, lastDay), hour, minute);
}

/** Where a repeat goes when this round is skipped: the next one still ahead. */
export function roundAfter(at: Date, repeat: Repeat, now: Date): Date {
  let next = nextOccurrence(at, repeat);
  for (let i = 0; next <= now && i < MAX_STEPS; i += 1) next = nextOccurrence(next, repeat);
  return next;
}

/** "2026-11-02": the Bangkok day of a moment. */
export const ymdOf = (date: Date): string => toBangkokInputValue(date).slice(0, 10);

const toUtc = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);

export function addDays(ymd: string, days: number): string {
  const date = toUtc(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Sunday of the week `ymd` falls in. */
export const weekStart = (ymd: string): string => addDays(ymd, -toUtc(ymd).getUTCDay());

const pad = (n: number) => String(n).padStart(2, "0");

/** Every cell of a month's calendar, in whole weeks from Sunday. */
export function monthGrid(year: number, month: number): { ymd: string; inMonth: boolean }[] {
  const prefix = `${year}-${pad(month)}`;
  const first = weekStart(`${prefix}-01`);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = addDays(weekStart(`${prefix}-${pad(last)}`), 6);
  const cells: { ymd: string; inMonth: boolean }[] = [];
  for (let ymd = first; ymd <= end; ymd = addDays(ymd, 1)) {
    cells.push({ ymd, inMonth: ymd.startsWith(prefix) });
  }
  return cells;
}

export interface DayEntry {
  reminder: ReminderDto;
  /** When this round falls. */
  at: Date;
  /** The round the reminder is waiting for; later rounds of a repeat are only worked out. */
  next: boolean;
}

/**
 * What falls on each day of a range. Only the next round of a repeat is stored, so the later ones are
 * worked out here; rounds that have gone by are not kept, so they do not show.
 */
export function buildDayMap(
  reminders: ReminderDto[],
  range: { from: string; to: string },
): Map<string, DayEntry[]> {
  const days = new Map<string, DayEntry[]>();
  const add = (reminder: ReminderDto, at: Date, next: boolean) => {
    const ymd = ymdOf(at);
    if (ymd < range.from || ymd > range.to) return;
    days.set(ymd, [...(days.get(ymd) ?? []), { reminder, at, next }]);
  };

  for (const reminder of reminders) {
    const first = new Date(reminder.remindAt);
    add(reminder, first, true);
    const { repeat } = reminder;
    if (!repeat || reminder.status === "done") continue;
    let at = nextOccurrence(first, repeat);
    for (let i = 0; ymdOf(at) <= range.to && i < MAX_STEPS; i += 1) {
      add(reminder, at, false);
      at = nextOccurrence(at, repeat);
    }
  }
  for (const entries of days.values()) entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  return days;
}
