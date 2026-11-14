import type { Plan } from "@/lib/plan";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { bangkokParts, formatThaiDate, fromBangkok, isValidYmd } from "@/lib/thai-date";
import { t } from "@/lib/i18n";

export type Repeat = "daily" | "weekly" | "monthly";

export const MAX_REMINDER_TEXT = 200;
/** A reminder further ahead than this is probably a typo in the date. */
export const MAX_AHEAD_DAYS = 366;
/** The time used when only a day was given ("พรุ่งนี้ จ่ายค่าไฟ"). */
export const DEFAULT_TIME = { hour: 8, minute: 30, label: "08:30" } as const;

/** One-off reminders a plan may have waiting at once (each one is a push message, so also a cost guard). */
const REMINDER_LIMIT: Record<Plan, number> = { free: 5, starter: 50, plus: 100, ultimate: 250 };
/** `extra`: waiting reminders bought on top (add-ons). */
export const reminderCapacity = (plan: Plan, extra = 0): number => REMINDER_LIMIT[plan] + extra;

/** Repeating reminders a plan may have, apart from the one-offs: each sends again every round. */
const REPEAT_LIMIT: Record<Plan, number> = { free: 1, starter: 20, plus: 50, ultimate: 100 };
export const repeatCapacity = (plan: Plan): number => REPEAT_LIMIT[plan];

/** Which limit a reminder counts against. */
export type ReminderKind = "once" | "repeat";
export const reminderKind = (repeat: string | null | undefined): ReminderKind =>
  repeat ? "repeat" : "once";
export const capacityOf = (plan: Plan, kind: ReminderKind, extra = 0): number =>
  kind === "repeat" ? repeatCapacity(plan) : reminderCapacity(plan, extra);

/** A reminder as the web app receives it. */
export interface ReminderDto {
  id: string;
  body: string;
  remindAt: string;
  repeat: Repeat | null;
  /** "done": sent, or ticked before its time. */
  status: ReminderStatus;
  /** A built-in key or the id of one of the person's own categories. */
  category: string | null;
}

export type ReminderStatus = "active" | "done";
export const REMINDER_CATEGORIES = [
  "bill",
  "work",
  "health",
  "family",
  "appointment",
  "shopping",
  "birthday",
  "home",
  "car",
  "study",
  "pet",
  "travel",
] as const;
export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];
export const CATEGORY_INFO: Record<ReminderCategory, { icon: string; label: string }> = {
  bill: { icon: "💳", label: t("บิล") },
  work: { icon: "💼", label: t("งาน") },
  health: { icon: "🩺", label: t("สุขภาพ") },
  family: { icon: "📞", label: t("ครอบครัว") },
  appointment: { icon: "📅", label: t("นัดหมาย") },
  shopping: { icon: "🛒", label: t("ซื้อของ") },
  birthday: { icon: "🎂", label: t("วันเกิด") },
  home: { icon: "🏠", label: t("บ้าน") },
  car: { icon: "🚗", label: t("รถ") },
  study: { icon: "📚", label: t("เรียน") },
  pet: { icon: "🐾", label: t("สัตว์เลี้ยง") },
  travel: { icon: "✈️", label: t("เที่ยว") },
};

/** A reminder category the person named themself; a reminder's `category` holds its id. */
export interface CustomReminderCategory {
  id: string;
  name: string;
  emoji: string;
}
export const MAX_REMINDER_CATEGORY_NAME = 20;
/** Own categories a person may keep. */
export const MAX_CUSTOM_REMINDER_CATEGORIES = 20;

export const isBuiltInCategory = (key: string): key is ReminderCategory =>
  (REMINDER_CATEGORIES as readonly string[]).includes(key);

/** How a reminder's category looks: a built-in one, one of the person's own, or none (deleted). */
export function categoryLook(
  key: string | null | undefined,
  own: readonly CustomReminderCategory[],
): { icon: string; label: string } | null {
  if (!key) return null;
  if (isBuiltInCategory(key)) return CATEGORY_INFO[key];
  const c = own.find((x) => x.id === key);
  return c ? { icon: c.emoji, label: c.name } : null;
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: t("ทุกวัน"),
  weekly: t("ทุกสัปดาห์"),
  monthly: t("ทุกเดือน"),
};

/** The weekday asked (0 Sunday), the nearest such day of the month, and the next one on that weekday. */
export interface WeekdayMismatch {
  asked: number;
  /** "2026-11-27" */
  nearest: string;
  /** The same day of the month on the weekday asked, within three months; null when none. */
  match: string | null;
}

export type ReminderParse =
  | {
      ok: true;
      body: string;
      remindAt: Date;
      repeat: Repeat | null;
      timeDefaulted: boolean;
      /** A time alone had already gone by today, so it was set for tomorrow. */
      rolledToTomorrow: boolean;
      /** "วันอาทิตย์ 27" when the nearest 27th is not a Sunday: worth asking before saving. */
      weekdayMismatch?: WeekdayMismatch;
    }
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

/** Words that make the number before them a count, not a day ("2 เม็ด", "5 กม."). */
const COUNT_WORDS =
  "หลอด|แผง|จาน|คน|ชิ้น|อัน|กล่อง|แพ็ก|แพ็ค|ถุง|ขวด|ตัว|แก้ว|ชุด|ห่อ|เม็ด|ฟอง|เล่ม|คู่|โหล|ถ้วย|ชาม|ซอง|กระป๋อง|กก|กิโล|ลิตร|กรัม|นาที|ชั่วโมง|ชม|กม|ก้าว|ใบ|ครั้ง|รอบ|คืน|คัน|ลูก|เส้น|บาท|(?:วัน|เดือน|ปี)(?![ก-๙])";
/**
 * "วันอาทิตย์ 27", "วันศุกร์ที่ 27": a weekday, then a day of the month. Groups: 1 the weekday,
 * 2 "ที่", 3 the day. Not a count, a time or a full date ("วันพุธ 2 เม็ด", "วันศุกร์ 10.30", "27/12").
 */
export const WEEKDAY_DAY_SOURCE = `วัน(${WEEKDAY_RE})\\s*(ที่)?\\s*([12]?\\d|3[01])(?![\\d:./])(?!\\s*(?:${COUNT_WORDS}|${MONTH_RE}))`;

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
  // "ครึ่ง" right after a time is half past ("9 โมงครึ่ง", "บ่าย 3 ครึ่ง", "4 โมงเย็นครึ่ง")
  r = take(s, /เที่ยง(?!คืน)(\s*ครึ่ง(?!\s*(?:ชั่วโมง|ชม|นึง|หนึ่ง|วัน|เดือน|ปี|ทาง)))?/);
  if (r.m) return { clock: { hour: 12, minute: r.m[1] ? 30 : 0 }, rest: r.rest };
  r = take(s, /ตี\s*(\d{1,2})(\s*ครึ่ง(?!\s*(?:ชั่วโมง|ชม|นึง|หนึ่ง|วัน|เดือน|ปี|ทาง)))?/);
  if (r.m && Number(r.m[1]) >= 1 && Number(r.m[1]) <= 5) {
    return { clock: { hour: Number(r.m[1]), minute: r.m[2] ? 30 : 0 }, rest: r.rest };
  }
  r = take(
    s,
    /บ่าย\s*(?:(\d{1,2})\s*(?:โมง)?|โมง)(\s*ครึ่ง(?!\s*(?:ชั่วโมง|ชม|นึง|หนึ่ง|วัน|เดือน|ปี|ทาง)))?/,
  );
  if (r.m) {
    const n = r.m[1] ? Number(r.m[1]) : 1;
    const minute = r.m[2] ? 30 : 0;
    if (n >= 1 && n <= 5) return { clock: { hour: 12 + n, minute }, rest: r.rest };
  }
  r = take(
    s,
    /(\d{1,2})\s*โมง(\s*ครึ่ง(?!\s*(?:ชั่วโมง|ชม|นึง|หนึ่ง|วัน|เดือน|ปี|ทาง)))?\s*(เช้า|เย็น)?(\s*ครึ่ง(?!\s*(?:ชั่วโมง|ชม|นึง|หนึ่ง|วัน|เดือน|ปี|ทาง)))?/,
  );
  if (r.m) {
    const n = Number(r.m[1]);
    const part = r.m[3];
    const minute = r.m[2] || r.m[4] ? 30 : 0;
    let hour = -1;
    if (part === "เย็น" && n >= 4 && n <= 6) hour = 12 + n;
    else if (part === "เช้า" && n >= 6 && n <= 11) hour = n;
    else if (!part && n >= 1 && n <= 5)
      hour = 12 + n; // "2 โมง" as people say it: 14:00
    else if (!part && n >= 6 && n <= 12) hour = n;
    if (hour >= 0) return { clock: { hour, minute }, rest: r.rest };
  }
  r = take(s, /(\d{1,2})?\s*ทุ่ม(\s*ครึ่ง(?!\s*(?:ชั่วโมง|ชม|นึง|หนึ่ง|วัน|เดือน|ปี|ทาง)))?/);
  if (r.m) {
    const n = r.m[1] ? Number(r.m[1]) : 1;
    const minute = r.m[2] ? 30 : 0;
    if (n >= 1 && n <= 5) return { clock: { hour: 18 + n, minute }, rest: r.rest };
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
  /** A day of the month; `weekday` when it was said with one ("วันอาทิตย์ 27"). */
  | { kind: "dom"; day: number; weekday?: number };

function takeDate(s: string): { date: DateSpec | null; rest: string } {
  let r = take(s, /วันนี้/);
  if (r.m) return { date: { kind: "offset", days: 0 }, rest: r.rest };
  r = take(s, /พรุ่งนี้/);
  if (r.m) return { date: { kind: "offset", days: 1 }, rest: r.rest };
  r = take(s, /มะรืน(?:นี้)?/);
  if (r.m) return { date: { kind: "offset", days: 2 }, rest: r.rest };
  // "วันอาทิตย์ 27", "วันศุกร์ที่ 27": that day of the month, in a month where it falls on that weekday
  r = take(s, new RegExp(WEEKDAY_DAY_SOURCE));
  if (r.m && Number(r.m[3]) >= 1) {
    return {
      date: { kind: "dom", day: Number(r.m[3]), weekday: WEEKDAYS[r.m[1] ?? ""] ?? 0 },
      rest: r.rest,
    };
  }
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

const weekdayOfYmd = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const ymdText = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

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

/**
 * A voice message is heard with the words of a day apart: "ทุก วัน พฤหัสบดี", "ทุก เดือน", "วัน ที่ 1".
 * Joined again, they read as typed ("ทุกวันพฤหัสบดี"); only these pairs, so other words keep their spaces.
 */
function joinDayWords(s: string): string {
  return s
    .replace(new RegExp(`ทุก\\s+(?=วัน|สัปดาห์|อาทิตย์|เดือน|${WEEKDAY_RE})`, "g"), "ทุก")
    .replace(new RegExp(`วัน\\s+(?=ที่\\s*\\d|${WEEKDAY_RE})`, "g"), "วัน");
}

/** Parse what follows "เตือน": when, how often and what about. Times are Asia/Bangkok. */
export function parseReminder(input: string, now: Date): ReminderParse {
  let s = ` ${joinDayWords(numberWordsToDigits(normalizeThaiDigits(input).replace(/\s+/g, " ").trim()))} `;

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
    return { ok: true, body, remindAt, repeat, timeDefaulted: false, rolledToTomorrow: false };
  }

  const clock = timed.clock;
  const date: DateSpec | null =
    dated.date ??
    (anchorWeekday !== null ? { kind: "weekday", day: anchorWeekday } : null) ??
    (anchorDom !== null ? { kind: "dom", day: anchorDom } : null);
  if (!clock && !date && !repeat) return { ok: false, reason: "no_time" };

  const today = bangkokParts(now);
  const at = (y: number, m: number, d: number) => {
    const h = clock?.hour ?? DEFAULT_TIME.hour;
    const mi = clock ? clock.minute : DEFAULT_TIME.minute;
    return clock?.midnight ? fromBangkok(y, m, d + 1, 0, 0) : fromBangkok(y, m, d, h, mi);
  };
  const future = (t: Date) => t.getTime() > now.getTime() + 30_000;
  const explicitDay = Boolean(dated.date) || Boolean(clock?.today);
  let remindAt: Date | null = null;
  let weekdayMismatch: WeekdayMismatch | undefined;
  let rolledToTomorrow = false;

  if (!date || clock?.today) {
    // a time alone (or only "ทุกวัน"): today if it is still ahead, else tomorrow
    const t0 = at(today.year, today.month, today.day);
    if (future(t0)) remindAt = t0;
    else if (clock?.today) return { ok: false, reason: "past" };
    else {
      const n = addDays(today.year, today.month, today.day, 1);
      remindAt = at(n.year, n.month, n.day);
      rolledToTomorrow = clock !== null && !repeat;
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
    // the next such day of the month; with a weekday, also one soon (this month or the next two) that
    // falls on it: that one is used, and a mismatch is said so it can be asked about
    const next = (span: number, weekday?: number) => {
      for (let i = 0; i < span; i += 1) {
        const month = ((today.month - 1 + i) % 12) + 1;
        const year = today.year + Math.floor((today.month - 1 + i) / 12);
        if (!isValidYmd(year, month, date.day)) continue;
        if (weekday !== undefined && weekdayOfYmd(year, month, date.day) !== weekday) continue;
        const t = at(year, month, date.day);
        if (future(t)) return { t, ymd: ymdText(year, month, date.day), year, month };
      }
      return null;
    };
    const nearest = next(14);
    const match = date.weekday === undefined ? null : next(3, date.weekday);
    remindAt = (match ?? nearest)?.t ?? null;
    if (
      nearest &&
      date.weekday !== undefined &&
      weekdayOfYmd(nearest.year, nearest.month, date.day) !== date.weekday
    ) {
      weekdayMismatch = { asked: date.weekday, nearest: nearest.ymd, match: match?.ymd ?? null };
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
  return {
    ok: true,
    body,
    remindAt,
    repeat,
    timeDefaulted: !clock,
    rolledToTomorrow,
    ...(weekdayMismatch ? { weekdayMismatch } : {}),
  };
}

/** "พรุ่งนี้ 28 ต.ค. 2569 09:00 · ทุกวัน": how a reminder is shown back to the person. */
/**
 * The new time of a reminder from what was typed. A time alone stays on the reminder's day, and a day
 * alone keeps its time, so "3 ทุ่ม" on Friday's reminder does not bring it forward to tonight.
 */
export function moveReminderTime(when: string, current: Date, now: Date): ReminderParse {
  const parsed = parseReminder(`${when} x`, now);
  if (!parsed.ok || parsed.repeat) return parsed;
  const typed = joinDayWords(numberWordsToDigits(normalizeThaiDigits(when)));
  if (/อีก\s*\d/.test(typed)) return parsed;
  const { clock, rest } = takeTime(typed);
  const { date } = takeDate(rest);
  const kept = bangkokParts(current);

  if (clock && !date && !clock.today) {
    const hour = clock.midnight ? 24 : clock.hour;
    const remindAt = fromBangkok(kept.year, kept.month, kept.day, hour, clock.minute);
    return remindAt > now ? { ...parsed, remindAt, rolledToTomorrow: false } : parsed;
  }
  if (date && !clock) {
    const day = bangkokParts(parsed.remindAt);
    const remindAt = fromBangkok(day.year, day.month, day.day, kept.hour, kept.minute);
    if (remindAt <= now) return { ok: false, reason: "past" };
    return { ...parsed, remindAt, timeDefaulted: false, rolledToTomorrow: false };
  }
  return parsed;
}

export function describeReminder(remindAt: Date, repeat: Repeat | null): string {
  return `${formatThaiDate(remindAt, true)}${repeat ? ` · ${REPEAT_LABEL[repeat]}` : ""}`;
}

/** The later times a reminder that was just sent can be moved to. */
export type Snooze = "10" | "60" | "tm";
export const isSnooze = (s: string | null): s is Snooze => s === "10" || s === "60" || s === "tm";

/**
 * When a snoozed reminder comes back: in 10 minutes or an hour (on the minute, as the cron runs), or
 * at 08:30 tomorrow; in the small hours "tomorrow morning" is this morning.
 */
export function snoozeTime(snooze: Snooze, now: Date): Date {
  if (snooze === "tm") {
    const p = bangkokParts(now);
    const day = p.day + (p.hour < 5 ? 0 : 1);
    return fromBangkok(p.year, p.month, day, DEFAULT_TIME.hour, DEFAULT_TIME.minute);
  }
  const minute = Math.ceil(now.getTime() / 60_000) * 60_000;
  return new Date(minute + Number(snooze) * 60_000);
}

/** "ตอน 10:40" today, "พรุ่งนี้ 09:00" tomorrow, the full date further on. */
export function whenFromNow(at: Date, now: Date): string {
  const p = bangkokParts(at);
  const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const today = bangkokParts(now);
  const tomorrow = bangkokParts(fromBangkok(today.year, today.month, today.day + 1));
  const same = (a: typeof p, b: typeof p) =>
    a.year === b.year && a.month === b.month && a.day === b.day;
  if (same(p, today)) return `ตอน ${clock}`;
  if (same(p, tomorrow)) return `พรุ่งนี้ ${clock}`;
  return formatThaiDate(at, true);
}
