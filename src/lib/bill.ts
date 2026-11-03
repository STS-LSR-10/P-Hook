import { money } from "@/lib/money";
import { parseAmountToSatang } from "@/lib/parse/thai-number";
import { bangkokParts } from "@/lib/thai-date";
import { balanceOf, type Wallet } from "@/lib/wallet";

export type BillCadence = "monthly" | "yearly" | "once";

export const MAX_BILL_NAME = 40;
export const MAX_BILL_NOTE = 100;
export const MAX_ACTIVE_BILLS = 30;
export const DEFAULT_REMIND_HOUR = 9;
export const REMIND_DAY_CHOICES = [0, 1, 2, 3, 7] as const;
/** Cards remind 3 days and 1 day before their due day, at 09:00. */
export const CARD_REMIND_DAYS = [3, 1];

/** A bill as the web app and the reminder job see it. Amounts are integer satang. */
export interface BillDto {
  id: string;
  name: string;
  amountSatang: number | null;
  cadence: BillCadence;
  dayOfMonth: number;
  monthOfYear: number | null;
  /** YYYY-MM-DD */
  nextDueOn: string;
  remindDays: number[];
  remindHour: number;
  /** YYYY-MM-DD: remind once more on this day. */
  snoozedOn: string | null;
  note: string | null;
  isActive: boolean;
  /** Made from a credit card's due day (read only; change it on the wallet). */
  fromCard?: boolean;
}

// ───────────── dates as YYYY-MM-DD strings (calendar math only, no time zones) ─────────────

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parseKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

export function addDays(key: string, delta: number): string {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function todayKey(now: Date): string {
  const p = bangkokParts(now);
  return keyOf(p.year, p.month, p.day);
}

/** The date a month-day falls on in a month: "the 31st" is the last day of a short month. */
const clamp = (y: number, m: number, day: number) => keyOf(y, m, Math.min(day, daysInMonth(y, m)));

/** First due date on or after `fromKey`. */
export function firstDue(
  cadence: BillCadence,
  dayOfMonth: number,
  monthOfYear: number | null,
  fromKey: string,
): string {
  const { y, m } = parseKey(fromKey);
  if (cadence === "monthly") {
    const here = clamp(y, m, dayOfMonth);
    if (here >= fromKey) return here;
    return m === 12 ? clamp(y + 1, 1, dayOfMonth) : clamp(y, m + 1, dayOfMonth);
  }
  const month = monthOfYear ?? m;
  const thisYear = clamp(y, month, dayOfMonth);
  return thisYear >= fromKey ? thisYear : clamp(y + 1, month, dayOfMonth);
}

/**
 * The due date after paying (or skipping) the one on `dueOn`: the next month / year, never in the
 * past; null for a one-off bill, which is finished.
 */
export function nextDueAfter(
  bill: Pick<BillDto, "cadence" | "dayOfMonth" | "monthOfYear">,
  dueOn: string,
  today: string,
): string | null {
  if (bill.cadence === "once") return null;
  let next = firstDue(bill.cadence, bill.dayOfMonth, bill.monthOfYear, addDays(dueOn, 1));
  while (next < today) {
    next = firstDue(bill.cadence, bill.dayOfMonth, bill.monthOfYear, addDays(next, 1));
  }
  return next;
}

// ───────────── what to send ─────────────

export type ReminderKind = "before" | "due" | "overdue" | "snooze";

export interface DueReminder {
  /** Stored once sent, so it is never sent again. */
  key: string;
  bill: BillDto;
  kind: ReminderKind;
  daysBefore: number;
}

/**
 * The reminders to send right now: for each live bill, the ones whose day has come and whose hour
 * has been reached (an hour the hourly job missed is made up later the same day) and that were not
 * sent yet. `sent` holds the keys already sent.
 */
export function dueReminders(
  bills: BillDto[],
  now: Date,
  sent: ReadonlySet<string>,
): DueReminder[] {
  const today = todayKey(now);
  const hour = bangkokParts(now).hour;
  const out: DueReminder[] = [];
  for (const bill of bills) {
    if (!bill.isActive || hour < bill.remindHour) continue;
    for (const d of bill.remindDays) {
      if (addDays(today, d) !== bill.nextDueOn) continue;
      const key = `${bill.id}:${bill.nextDueOn}:${d}`;
      if (!sent.has(key)) out.push({ key, bill, kind: d === 0 ? "due" : "before", daysBefore: d });
    }
    // the day after a due date that was neither paid nor skipped
    if (addDays(bill.nextDueOn, 1) === today) {
      const key = `${bill.id}:${bill.nextDueOn}:overdue`;
      if (!sent.has(key)) out.push({ key, bill, kind: "overdue", daysBefore: -1 });
    }
    if (bill.snoozedOn && bill.snoozedOn <= today) {
      const key = `${bill.id}:snooze:${bill.snoozedOn}`;
      if (!sent.has(key)) out.push({ key, bill, kind: "snooze", daysBefore: 0 });
    }
  }
  return out;
}

const when = (key: string) => {
  const { y, m, d } = parseKey(key);
  return `${d}/${m}/${y + 543}`;
};

/** "พรุ่งนี้ครบกำหนดจ่ายค่าไฟ ประมาณ ฿1,250 (15/11/2569)" */
export function billReminderText(r: DueReminder): string {
  const { bill } = r;
  const amount = bill.amountSatang ? ` ประมาณ ${money(bill.amountSatang)}` : "";
  const date = `(${when(bill.nextDueOn)})`;
  switch (r.kind) {
    case "overdue":
      return `เลยกำหนดจ่าย${bill.name}มาแล้ว${amount} ${date} จ่ายแล้วหรือยังนะ?`;
    case "snooze":
      return `เตือนอีกครั้ง: ${bill.name}${amount} ครบกำหนด ${when(bill.nextDueOn)}`;
    case "due":
      return `วันนี้ครบกำหนดจ่าย${bill.name}${amount} ${date}`;
    default: {
      const days = r.daysBefore;
      return `${days === 1 ? "พรุ่งนี้" : `อีก ${days} วัน`}ครบกำหนดจ่าย${bill.name}${amount} ${date}`;
    }
  }
}

/** The bills made from credit cards that have a due day. */
export function cardBills(wallets: Wallet[], today: string): BillDto[] {
  return wallets
    .filter((w) => w.kind === "card" && w.dueDay)
    .map((w) => {
      const owed = Math.max(0, -balanceOf(w));
      return {
        id: `card:${w.id}`,
        name: `บัตร ${w.name}`,
        amountSatang: owed > 0 ? owed : null,
        cadence: "monthly" as const,
        dayOfMonth: w.dueDay ?? 1,
        monthOfYear: null,
        nextDueOn: firstDue("monthly", w.dueDay ?? 1, null, today),
        remindDays: CARD_REMIND_DAYS,
        remindHour: DEFAULT_REMIND_HOUR,
        snoozedOn: null,
        note: null,
        isActive: true,
        fromCard: true,
      };
    });
}

// ───────────── chat ─────────────

export type BillCommand =
  | { kind: "bills" }
  | {
      kind: "bill-new";
      name: string;
      amountSatang: number | null;
      cadence: BillCadence;
      dayOfMonth: number;
      monthOfYear: number | null;
      remindDays: number[];
      remindHour: number;
    }
  | { kind: "bill-new-usage" }
  | { kind: "bill-pay"; name: string };

const AMOUNT_AT_END = /^(.+?)\s+(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน|ล้าน)?\s*(?:บาท)?$/;

/**
 * Bill phrases (text already trimmed, spaces collapsed, Thai digits turned into numbers):
 *   บิล · เตือนบิล                                         -> the list
 *   บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15 [เตือนก่อน 2 วัน] [เวลา 20:00]
 *   บิล ใหม่ ประกันรถ 12000 ทุกปี 1/3
 *   บิล ใหม่ ค่าส่วนกลาง 800 วันที่ 25/12                  -> once
 *   จ่ายบิล ค่าไฟ                                          -> paid this round
 */
export function parseBillText(text: string): BillCommand | null {
  if (["บิล", "เตือนบิล", "bills"].includes(text.toLowerCase())) return { kind: "bills" };

  let m = /^จ่ายบิล\s+(.+)$/.exec(text);
  if (m?.[1]) return { kind: "bill-pay", name: m[1].trim() };

  m = /^บิล\s+ใหม่(?:\s+(.+))?$/.exec(text);
  if (!m) return null;
  let rest = m[1] ?? "";
  if (!rest) return { kind: "bill-new-usage" };

  let remindHour = DEFAULT_REMIND_HOUR;
  const time = /\s*เวลา\s*(\d{1,2})(?::(\d{2}))?(?:\s*น\.?)?/.exec(rest);
  if (time?.[1]) {
    remindHour = Number(time[1]);
    if (remindHour > 23) return { kind: "bill-new-usage" };
    rest = rest.replace(time[0], "");
  }

  let remindDays = [1];
  const before = /\s*เตือน(?:ก่อน|ล่วงหน้า)\s*(\d{1,2}(?:[,/ ]+\d{1,2})*)\s*วัน/.exec(rest);
  if (before?.[1]) {
    const list = [...new Set(before[1].split(/[,/ ]+/).map(Number))].sort((a, b) => b - a);
    if (list.length === 0 || list.some((d) => d > 30)) return { kind: "bill-new-usage" };
    remindDays = list;
    rest = rest.replace(before[0], "");
  }

  let cadence: BillCadence;
  let dayOfMonth: number;
  let monthOfYear: number | null = null;
  const monthly = /\s*ทุก(?:เดือน)?(?:วันที่|วัน)\s*(\d{1,2})/.exec(rest);
  const yearly = /\s*ทุกปี\s*(\d{1,2})\/(\d{1,2})/.exec(rest);
  const once = /\s*(?:วันที่|ภายใน)\s*(\d{1,2})\/(\d{1,2})/.exec(rest);
  if (monthly?.[1]) {
    cadence = "monthly";
    dayOfMonth = Number(monthly[1]);
    rest = rest.replace(monthly[0], "");
  } else if (yearly?.[1] && yearly[2]) {
    cadence = "yearly";
    dayOfMonth = Number(yearly[1]);
    monthOfYear = Number(yearly[2]);
    rest = rest.replace(yearly[0], "");
  } else if (once?.[1] && once[2]) {
    cadence = "once";
    dayOfMonth = Number(once[1]);
    monthOfYear = Number(once[2]);
    rest = rest.replace(once[0], "");
  } else {
    return { kind: "bill-new-usage" };
  }
  if (dayOfMonth < 1 || dayOfMonth > 31) return { kind: "bill-new-usage" };
  if (monthOfYear !== null && (monthOfYear < 1 || monthOfYear > 12))
    return { kind: "bill-new-usage" };

  rest = rest.replace(/\s+/g, " ").trim();
  let name = rest;
  let amountSatang: number | null = null;
  const am = AMOUNT_AT_END.exec(rest);
  if (am?.[1] && am[2]) {
    name = am[1].trim();
    amountSatang = parseAmountToSatang(am[2], am[3]);
    if (amountSatang <= 0) amountSatang = null;
  }
  if (!name || name.length > MAX_BILL_NAME) return { kind: "bill-new-usage" };
  return {
    kind: "bill-new",
    name,
    amountSatang,
    cadence,
    dayOfMonth,
    monthOfYear,
    remindDays,
    remindHour,
  };
}

/** The bill a typed name means: that exact name (ignoring case), else the only one it starts. */
export function resolveBill<T extends { name: string }>(
  hint: string,
  bills: T[],
): { ok: true; bill: T } | { ok: false; reason: "none" | "ambiguous" } {
  const word = hint.replace(/\s+/g, " ").trim().toLowerCase();
  if (!word) return { ok: false, reason: "none" };
  const exact = bills.filter((b) => b.name.toLowerCase() === word);
  if (exact.length === 1 && exact[0]) return { ok: true, bill: exact[0] };
  const starts = bills.filter((b) => b.name.toLowerCase().startsWith(word));
  if (starts.length === 1 && starts[0]) return { ok: true, bill: starts[0] };
  return { ok: false, reason: starts.length > 1 ? "ambiguous" : "none" };
}

export type BillDueState = "overdue" | "soon" | "later";

/** Late, due within 3 days (today included), or later; both arguments are YYYY-MM-DD. */
export function dueState(dueOn: string, today: string): BillDueState {
  if (dueOn < today) return "overdue";
  return dueOn <= addDays(today, 3) ? "soon" : "later";
}
