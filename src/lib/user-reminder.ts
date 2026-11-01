import type { Plan } from "@/lib/plan";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { bangkokParts, formatThaiDate, fromBangkok, isValidYmd } from "@/lib/thai-date";

export type Repeat = "daily" | "weekly" | "monthly";

export const MAX_REMINDER_TEXT = 200;
/** A reminder further ahead than this is probably a typo in the date. */
export const MAX_AHEAD_DAYS = 366;
/** The time used when only a day was given ("พรุ่งนี้ จ่ายค่าไฟ"). */
export const DEFAULT_HOUR = 9;

/** Reminders a plan may have waiting at once (each one is a push message, so this is also a cost guard). */
const REMINDER_LIMIT: Record<Plan, number> = { free: 3, plus: 30, ultimate: 100 };
export const reminderCapacity = (plan: Plan): number => REMINDER_LIMIT[plan];

/** A reminder as the web app receives it. */
export interface ReminderDto {
  id: string;
  body: string;
  remindAt: string;
  repeat: Repeat | null;
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: "ทุกวัน",
  weekly: "ทุกสัปดาห์",
  monthly: "ทุกเดือน",
};

export type ReminderParse =
  | { ok: true; body: string; remindAt: Date; repeat: Repeat | null; timeDefaulted: boolean }
  | { ok: false; reason: "no_text" | "no_time" | "past" | "too_far" };

const WEEKDAYS: Record<string, number> = {
  อาทิตย์: 0,
  จันทร์: 1,
  อังคาร: 2,
  พุธ: 3,
  พฤหัสบดี: 4,
  พฤหัส: 4,
  ศุกร์: 5,
  เสาร์: 6,
};
const WEEKDAY_RE = "อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์";

const MONTHS: [string, number][] = [
  ["มกราคม", 1],
  ["กุมภาพันธ์", 2],
  ["มีนาคม", 3],
  ["เมษายน", 4],
  ["พฤษภาคม", 5],
  ["มิถุนายน", 6],
  ["กรกฎาคม", 7],
  ["สิงหาคม", 8],
  ["กันยายน", 9],
  ["ตุลาคม", 10],
  ["พฤศจิกายน", 11],
  ["ธันวาคม", 12],
  ["ม.ค.", 1],
  ["ก.พ.", 2],
  ["มี.ค.", 3],
  ["เม.ย.", 4],
  ["พ.ค.", 5],
  ["มิ.ย.", 6],
  ["ก.ค.", 7],
  ["ส.ค.", 8],
  ["ก.ย.", 9],
  ["ต.ค.", 10],
  ["พ.ย.", 11],
  ["ธ.ค.", 12],
];
const MONTH_RE = MONTHS.map(([n]) => n.replace(/\./g, "\\.")).join("|");
const monthOf = (name: string) => MONTHS.find(([n]) => n === name)?.[1] ?? 0;

/** Remove the first match of `re` from `s`; returns the groups and the rest. */
function take(s: string, re: RegExp): { m: RegExpExecArray | null; rest: string } {
  const m = re.exec(s);
  if (!m) return { m: null, rest: s };
  return { m, rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` };
}

const yearOf = (raw: string | undefined): number | null => {
  if (!raw) return null;
  let y = Number(raw);
  if (y < 100) y += 2000;
  if (y >= 2400) y -= 543;
  return y;
};

interface Clock {
  hour: number;
  minute: number;
  /** "เที่ยงคืน": 24:00, i.e. 00:00 of the day after. */
  midnight?: boolean;
  /** "คืนนี้" / "ตอนเย็น" and the like also fix the day to today. */
  today?: boolean;
}

/** Thai ways to say a time of day. Null when none is in the text. */
function takeTime(s: string): { clock: Clock | null; rest: string } {
  let r = take(s, /(\d{1,2})[:.](\d{2})\s*(?:น\.?)?/);
  if (r.m) {
    const hour = Number(r.m[1]);
    const minute = Number(r.m[2]);
    if (hour < 24 && minute < 60) return { clock: { hour, minute }, rest: r.rest };
  }
  r = take(s, /เที่ยงคืน/);
  if (r.m) return { clock: { hour: 0, minute: 0, midnight: true }, rest: r.rest };
  r = take(s, /เที่ยง(?!คืน)/);
  if (r.m) return { clock: { hour: 12, minute: 0 }, rest: r.rest };
  r = take(s, /ตี\s*(\d{1,2})/);
  if (r.m && Number(r.m[1]) >= 1 && Number(r.m[1]) <= 5) {
    return { clock: { hour: Number(r.m[1]), minute: 0 }, rest: r.rest };
  }
  r = take(s, /บ่าย\s*(?:(\d{1,2})\s*(?:โมง)?|โมง)/);
  if (r.m) {
    const n = r.m[1] ? Number(r.m[1]) : 1;
    if (n >= 1 && n <= 5) return { clock: { hour: 12 + n, minute: 0 }, rest: r.rest };
  }
  r = take(s, /(\d{1,2})\s*โมง\s*(เช้า|เย็น)?/);
  if (r.m) {
    const n = Number(r.m[1]);
    const part = r.m[2];
    let hour = -1;
    if (part === "เย็น" && n >= 4 && n <= 6) hour = 12 + n;
    else if (part === "เช้า" && n >= 6 && n <= 11) hour = n;
    else if (!part && n >= 1 && n <= 5)
      hour = 12 + n; // "2 โมง" as people say it: 14:00
    else if (!part && n >= 6 && n <= 12) hour = n;
    if (hour >= 0) return { clock: { hour, minute: 0 }, rest: r.rest };
  }
  r = take(s, /(\d{1,2})?\s*ทุ่ม/);
  if (r.m) {
    const n = r.m[1] ? Number(r.m[1]) : 1;
    if (n >= 1 && n <= 5) return { clock: { hour: 18 + n, minute: 0 }, rest: r.rest };
  }
  r = take(s, /คืนนี้/);
  if (r.m) return { clock: { hour: 20, minute: 0, today: true }, rest: r.rest };
  r = take(s, /ตอน(เช้า|สาย|บ่าย|เย็น|ค่ำ)/);
  if (r.m) {
    const hour = { เช้า: 7, สาย: 10, บ่าย: 14, เย็น: 17, ค่ำ: 19 }[r.m[1] ?? "เช้า"] ?? 9;
    return { clock: { hour, minute: 0 }, rest: r.rest };
  }
  return { clock: null, rest: s };
}

type DateSpec =
  | { kind: "offset"; days: number }
  | { kind: "weekday"; day: number }
  | { kind: "ymd"; year: number | null; month: number; day: number }
  | { kind: "dom"; day: number };

function takeDate(s: string): { date: DateSpec | null; rest: string } {
  let r = take(s, /วันนี้/);
  if (r.m) return { date: { kind: "offset", days: 0 }, rest: r.rest };
  r = take(s, /พรุ่งนี้/);
  if (r.m) return { date: { kind: "offset", days: 1 }, rest: r.rest };
  r = take(s, /มะรืน(?:นี้)?/);
  if (r.m) return { date: { kind: "offset", days: 2 }, rest: r.rest };
  r = take(s, new RegExp(`วัน(${WEEKDAY_RE})(?:\\s*(?:หน้า|นี้|ถัดไป))?`));
  if (r.m) return { date: { kind: "weekday", day: WEEKDAYS[r.m[1] ?? ""] ?? 0 }, rest: r.rest };
  r = take(s, /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (r.m) {
    return {
      date: { kind: "ymd", year: yearOf(r.m[3]), month: Number(r.m[2]), day: Number(r.m[1]) },
      rest: r.rest,
    };
  }
  r = take(s, new RegExp(`(\\d{1,2})\\s*(${MONTH_RE})(?:\\s*(\\d{4}))?`));
  if (r.m) {
    return {
      date: {
        kind: "ymd",
        year: yearOf(r.m[3]),
        month: monthOf(r.m[2] ?? ""),
        day: Number(r.m[1]),
      },
      rest: r.rest,
    };
  }
  r = take(s, /วันที่\s*(\d{1,2})/);
  if (r.m) return { date: { kind: "dom", day: Number(r.m[1]) }, rest: r.rest };
  return { date: null, rest: s };
}

const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
};

const NUMBER_WORDS: Record<string, number> = {
  หนึ่ง: 1,
  สอง: 2,
  สาม: 3,
  สี่: 4,
  ห้า: 5,
  หก: 6,
  เจ็ด: 7,
  แปด: 8,
  เก้า: 9,
  สิบ: 10,
  สิบเอ็ด: 11,
  สิบสอง: 12,
};
const NUMBER_WORD_RE = "สิบเอ็ด|สิบสอง|สิบ|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า";

/** "บ่ายสาม" -> "บ่าย 3", "เก้าโมง" -> "9 โมง", "สองทุ่ม" -> "2 ทุ่ม", "ตีห้า" -> "ตี 5" (only next to a time word). */
function numberWordsToDigits(s: string): string {
  return s
    .replace(
      new RegExp(`(${NUMBER_WORD_RE})\\s*(โมง|ทุ่ม)`, "g"),
      (_, w: string, unit: string) => `${NUMBER_WORDS[w]} ${unit}`,
    )
    .replace(
      new RegExp(`(บ่าย|ตี)\\s*(${NUMBER_WORD_RE})`, "g"),
      (_, unit: string, w: string) => `${unit} ${NUMBER_WORDS[w]}`,
    );
}

/** Parse what follows "เตือน": when, how often and what about. Times are Asia/Bangkok. */
export function parseReminder(input: string, now: Date): ReminderParse {
  let s = ` ${numberWordsToDigits(normalizeThaiDigits(input).replace(/\s+/g, " ").trim())} `;

  // how often
  let repeat: Repeat | null = null;
  let anchorWeekday: number | null = null;
  let anchorDom: number | null = null;
  let r = take(s, new RegExp(`ทุก(?:วัน)?(${WEEKDAY_RE})`));
  if (r.m) {
    repeat = "weekly";
    anchorWeekday = WEEKDAYS[r.m[1] ?? ""] ?? 0;
    s = r.rest;
  } else if ((r = take(s, /ทุกวันที่\s*(\d{1,2})/)).m) {
    repeat = "monthly";
    anchorDom = Number(r.m?.[1]);
    s = r.rest;
  } else if ((r = take(s, /ทุก(?:สัปดาห์|อาทิตย์)/)).m) {
    repeat = "weekly";
    s = r.rest;
  } else if ((r = take(s, /ทุกเดือน/)).m) {
    repeat = "monthly";
    s = r.rest;
  } else if ((r = take(s, /ทุกวัน(?!ที่)/)).m) {
    repeat = "daily";
    s = r.rest;
  }

  // "อีก 30 นาที": counted from now, no day or clock time
  let relativeMs: number | null = null;
  r = take(s, /อีก\s*(\d+)\s*(นาที|ชั่วโมง|ชม\.?|วัน|สัปดาห์|อาทิตย์)/);
  if (r.m) {
    const n = Number(r.m[1]);
    const unit = r.m[2] ?? "";
    const minute = 60_000;
    relativeMs =
      n *
      (unit === "นาที"
        ? minute
        : unit.startsWith("ชั่วโมง") || unit.startsWith("ชม")
          ? 60 * minute
          : unit === "วัน"
            ? 1440 * minute
            : 10_080 * minute);
    s = r.rest;
  }

  const timed = takeTime(s);
  s = timed.rest;
  const dated = takeDate(s);
  s = dated.rest;

  let body = s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:ให้|ว่า|เรื่อง|ตอน|เวลา|เมื่อ|ที่|คือ|ด้วย)\s+)+/, "")
    .replace(/^[,:;.\-–]+\s*|\s*[,:;.\-–]+$/g, "")
    .trim();
  if (!body) return { ok: false, reason: "no_text" };
  if (body.length > MAX_REMINDER_TEXT) body = body.slice(0, MAX_REMINDER_TEXT).trim();

  const maxAt = now.getTime() + MAX_AHEAD_DAYS * 86_400_000;
  if (relativeMs !== null) {
    const remindAt = new Date(Math.floor((now.getTime() + relativeMs) / 60_000) * 60_000);
    if (remindAt.getTime() > maxAt) return { ok: false, reason: "too_far" };
    return { ok: true, body, remindAt, repeat, timeDefaulted: false };
  }

  const clock = timed.clock;
  const date: DateSpec | null =
    dated.date ??
    (anchorWeekday !== null ? { kind: "weekday", day: anchorWeekday } : null) ??
    (anchorDom !== null ? { kind: "dom", day: anchorDom } : null);
  if (!clock && !date && !repeat) return { ok: false, reason: "no_time" };

  const today = bangkokParts(now);
  const at = (y: number, m: number, d: number) => {
    const h = clock?.hour ?? DEFAULT_HOUR;
    const mi = clock?.minute ?? 0;
    return clock?.midnight ? fromBangkok(y, m, d + 1, 0, 0) : fromBangkok(y, m, d, h, mi);
  };
  const future = (t: Date) => t.getTime() > now.getTime() + 30_000;
  const explicitDay = Boolean(dated.date) || Boolean(clock?.today);
  let remindAt: Date | null = null;

  if (!date || clock?.today) {
    // a time alone (or only "ทุกวัน"): today if it is still ahead, else tomorrow
    const t0 = at(today.year, today.month, today.day);
    if (future(t0)) remindAt = t0;
    else if (clock?.today) return { ok: false, reason: "past" };
    else {
      const n = addDays(today.year, today.month, today.day, 1);
      remindAt = at(n.year, n.month, n.day);
    }
  } else if (date.kind === "offset") {
    const n = addDays(today.year, today.month, today.day, date.days);
    remindAt = at(n.year, n.month, n.day);
    if (!future(remindAt)) return { ok: false, reason: "past" };
  } else if (date.kind === "weekday") {
    for (let i = 0; i <= 7 && !remindAt; i += 1) {
      const n = addDays(today.year, today.month, today.day, i);
      const wd = new Date(Date.UTC(n.year, n.month - 1, n.day)).getUTCDay();
      if (wd !== date.day) continue;
      const t = at(n.year, n.month, n.day);
      if (future(t)) remindAt = t;
    }
  } else if (date.kind === "dom") {
    for (let i = 0; i < 14 && !remindAt; i += 1) {
      const month = ((today.month - 1 + i) % 12) + 1;
      const year = today.year + Math.floor((today.month - 1 + i) / 12);
      if (!isValidYmd(year, month, date.day)) continue;
      const t = at(year, month, date.day);
      if (future(t)) remindAt = t;
    }
  } else {
    if (!isValidYmd(date.year ?? today.year, date.month, date.day)) {
      return { ok: false, reason: "no_time" };
    }
    if (date.year !== null) {
      remindAt = at(date.year, date.month, date.day);
      if (!future(remindAt)) return { ok: false, reason: "past" };
    } else {
      // no year: this year, or next when the day has gone by
      for (const y of [today.year, today.year + 1]) {
        if (!isValidYmd(y, date.month, date.day)) continue;
        const t = at(y, date.month, date.day);
        if (future(t)) {
          remindAt = t;
          break;
        }
      }
    }
  }
  if (!remindAt) return { ok: false, reason: explicitDay ? "past" : "no_time" };
  if (remindAt.getTime() > maxAt) return { ok: false, reason: "too_far" };
  return { ok: true, body, remindAt, repeat, timeDefaulted: !clock };
}

/** "พรุ่งนี้ 28 ต.ค. 2569 09:00 · ทุกวัน": how a reminder is shown back to the person. */
/**
 * The new time of a reminder from what was typed. A time alone stays on the reminder's day, and a day
 * alone keeps its time, so "3 ทุ่ม" on Friday's reminder does not bring it forward to tonight.
 */
export function moveReminderTime(when: string, current: Date, now: Date): ReminderParse {
  const parsed = parseReminder(`${when} x`, now);
  if (!parsed.ok || parsed.repeat) return parsed;
  const typed = numberWordsToDigits(normalizeThaiDigits(when));
  if (/อีก\s*\d/.test(typed)) return parsed;
  const { clock, rest } = takeTime(typed);
  const { date } = takeDate(rest);
  const kept = bangkokParts(current);

  if (clock && !date && !clock.today) {
    const hour = clock.midnight ? 24 : clock.hour;
    const remindAt = fromBangkok(kept.year, kept.month, kept.day, hour, clock.minute);
    return remindAt > now ? { ...parsed, remindAt } : parsed;
  }
  if (date && !clock) {
    const day = bangkokParts(parsed.remindAt);
    const remindAt = fromBangkok(day.year, day.month, day.day, kept.hour, kept.minute);
    if (remindAt <= now) return { ok: false, reason: "past" };
    return { ...parsed, remindAt, timeDefaulted: false };
  }
  return parsed;
}

export function describeReminder(remindAt: Date, repeat: Repeat | null): string {
  return `${formatThaiDate(remindAt, true)}${repeat ? ` · ${REPEAT_LABEL[repeat]}` : ""}`;
}
