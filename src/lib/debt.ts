import { parseAmountToSatang } from "@/lib/parse/thai-number";
import { extractWalletHint } from "@/lib/parse/text-parser";
import { bangkokParts, fromBangkok, isValidYmd } from "@/lib/thai-date";
import { currencySymbol } from "@/lib/money";

export type DebtDirection = "lent" | "borrowed";

export const MAX_PERSON = 40;
export const MAX_OPEN_DEBTS_PER_PERSON = 200;
export const MAX_DEBT_NOTE = 100;

/** A debt as the web app receives it. */
export interface DebtDto {
  id: string;
  direction: DebtDirection;
  person: string;
  amountSatang: number;
  paidSatang: number;
  remainingSatang: number;
  accountId: string | null;
  accountName: string;
  occurredAt: string;
  dueAt: string | null;
  note: string | null;
}

export const DIRECTION_LABEL: Record<DebtDirection, string> = {
  lent: "ให้ยืม",
  borrowed: "ยืมมา",
};

/** "  สมชาย  ใจดี " -> "สมชาย ใจดี" */
export const cleanPerson = (name: string) => name.replace(/\s+/g, " ").trim();
/** Same person ignoring case and spacing. */
export const personKey = (name: string) => cleanPerson(name).toLowerCase();

export type DueSpec =
  { kind: "dmy"; day: number; month: number; year: number | null } | { kind: "days"; days: number };

export type DebtCommand =
  | {
      kind: "debt-new";
      direction: DebtDirection;
      person: string;
      amountSatang: number;
      due: DueSpec | null;
      walletHint: string | null;
    }
  | {
      kind: "debt-pay";
      /** "lent": they pay me back. "borrowed": I pay them back. */
      direction: DebtDirection;
      person: string;
      amountSatang: number;
      walletHint: string | null;
    };

const AMOUNT = String.raw`(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน|ล้าน)?\s*(?:บาท)?`;
const PERSON_THEN_AMOUNT = new RegExp(String.raw`^(.+?)\s*${AMOUNT}$`, "i");
const DUE_DMY = /\s*(?:คืน|ครบกำหนด|ครบ|กำหนด|ภายใน)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;
const DUE_TOMORROW = /\s*(?:คืน|ครบกำหนด|ภายใน)?\s*พรุ่งนี้/;
const DUE_DAYS = /\s*(?:ภายใน|อีก)\s*(\d{1,3})\s*วัน/;

export function takeDue(text: string): { text: string; due: DueSpec | null } {
  let m = DUE_DMY.exec(text);
  if (m?.[1] && m[2]) {
    return {
      text: text.replace(DUE_DMY, ""),
      due: {
        kind: "dmy",
        day: Number(m[1]),
        month: Number(m[2]),
        year: m[3] ? Number(m[3]) : null,
      },
    };
  }
  m = DUE_DAYS.exec(text);
  if (m?.[1]) {
    return { text: text.replace(DUE_DAYS, ""), due: { kind: "days", days: Number(m[1]) } };
  }
  if (DUE_TOMORROW.test(text)) {
    return { text: text.replace(DUE_TOMORROW, ""), due: { kind: "days", days: 1 } };
  }
  return { text, due: null };
}

/** The moment a due phrase means (noon in Bangkok); a day/month with no year is the next one coming. */
export function resolveDue(spec: DueSpec, now: Date): Date | null {
  const today = bangkokParts(now);
  if (spec.kind === "days") {
    if (spec.days < 0 || spec.days > 3650) return null;
    return fromBangkok(today.year, today.month, today.day + spec.days, 12);
  }
  let year: number;
  if (spec.year === null) {
    year = today.year;
    if (spec.month < today.month || (spec.month === today.month && spec.day < today.day)) year += 1;
  } else {
    year = spec.year >= 2400 ? spec.year - 543 : spec.year < 100 ? spec.year + 2000 : spec.year;
  }
  return isValidYmd(year, spec.month, spec.day)
    ? fromBangkok(year, spec.month, spec.day, 12)
    : null;
}

export function personAmount(rest: string): { person: string; amountSatang: number } | null {
  const m = PERSON_THEN_AMOUNT.exec(rest.trim());
  if (!m?.[1] || !m[2]) return null;
  const person = cleanPerson(m[1].replace(/^เงิน\s+/, ""));
  const amountSatang = parseAmountToSatang(m[2], m[3]);
  if (!person || person.length > MAX_PERSON || amountSatang <= 0) return null;
  return { person, amountSatang };
}

/**
 * Debt phrases in chat (the text is already trimmed, spaces collapsed, Thai digits turned into numbers):
 *   ให้ยืม สมชาย 500 [คืน 25/10] · สมชายยืม 500   -> lent
 *   ยืม แม่ 2000 [คืน 25/10]                      -> borrowed
 *   สมชายคืน 200                                  -> they pay me back
 *   คืนแม่ 1000 · คืน แม่ 1000                    -> I pay them back
 * Any of them may end with "@กระเป๋า". Returns null for anything else.
 */
export function parseDebtText(text: string): DebtCommand | null {
  const { text: unwalleted, hint: walletHint } = extractWalletHint(text);

  const create = (direction: DebtDirection, rest: string): DebtCommand | null => {
    const { text: withoutDue, due } = takeDue(rest);
    const pa = personAmount(withoutDue);
    return pa ? { kind: "debt-new", direction, ...pa, due, walletHint } : null;
  };
  const pay = (direction: DebtDirection, rest: string): DebtCommand | null => {
    const pa = personAmount(rest);
    return pa ? { kind: "debt-pay", direction, ...pa, walletHint } : null;
  };

  let m = /^ให้ยืม(?:เงิน)?\s*(.+)$/.exec(unwalleted);
  if (m?.[1]) return create("lent", m[1]);
  m = /^(?:ขอ)?ยืม(?:เงิน)?\s*(.+)$/.exec(unwalleted);
  if (m?.[1]) return create("borrowed", m[1]);
  m = /^คืน(?:เงิน)?\s*(.+)$/.exec(unwalleted);
  if (m?.[1]) return pay("borrowed", m[1]);

  // "<person>ยืม 500" / "<person>คืน 200": the person comes first
  m = new RegExp(String.raw`^(.+?)ยืม\s*(${AMOUNT}.*)$`, "i").exec(unwalleted);
  if (m?.[1] && m[2] && !/\s/.test(m[1])) return create("lent", `${m[1]} ${m[2]}`);
  m = new RegExp(String.raw`^(.+?)คืน(?:เงิน)?\s*(${AMOUNT})$`, "i").exec(unwalleted);
  if (m?.[1] && m[2] && !/\s/.test(m[1])) return pay("lent", `${m[1]} ${m[2]}`);
  return null;
}

export interface OpenDebt {
  id: string;
  remainingSatang: number;
}

/**
 * Spread a repayment over the person's open debts, the oldest first. `debts` must already be in that
 * order. A repayment larger than everything still owed is refused.
 */
export function planPayment(
  debts: OpenDebt[],
  amountSatang: number,
):
  | { ok: true; parts: { debtId: string; amountSatang: number }[] }
  | { ok: false; owedSatang: number } {
  const owed = debts.reduce((sum, d) => sum + d.remainingSatang, 0);
  if (amountSatang <= 0 || amountSatang > owed) return { ok: false, owedSatang: owed };
  const parts: { debtId: string; amountSatang: number }[] = [];
  let left = amountSatang;
  for (const d of debts) {
    if (left <= 0) break;
    const part = Math.min(left, d.remainingSatang);
    if (part > 0) parts.push({ debtId: d.id, amountSatang: part });
    left -= part;
  }
  return { ok: true, parts };
}

export interface PersonTotal {
  person: string;
  direction: DebtDirection;
  remainingSatang: number;
  /** Earliest due date among the open debts, if any. */
  dueAt: string | null;
}

/** Open debts added up per person and direction (largest first). */
export function totalsByPerson(debts: DebtDto[]): PersonTotal[] {
  const map = new Map<string, PersonTotal>();
  for (const d of debts) {
    if (d.remainingSatang <= 0) continue;
    const key = `${d.direction}:${personKey(d.person)}`;
    const cur = map.get(key);
    if (cur) {
      cur.remainingSatang += d.remainingSatang;
      if (d.dueAt && (!cur.dueAt || d.dueAt < cur.dueAt)) cur.dueAt = d.dueAt;
    } else {
      map.set(key, {
        person: cleanPerson(d.person),
        direction: d.direction,
        remainingSatang: d.remainingSatang,
        dueAt: d.dueAt,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.remainingSatang - a.remainingSatang);
}

export type DueState = "overdue" | "soon" | "later" | "none";

/** Overdue, due within `soonDays` (today included), later, or no date. */
export function dueState(dueAt: string | null, now: Date, soonDays = 3): DueState {
  if (!dueAt) return "none";
  const due = bangkokParts(new Date(dueAt));
  const today = bangkokParts(now);
  const dueDay = fromBangkok(due.year, due.month, due.day).getTime();
  const todayDay = fromBangkok(today.year, today.month, today.day).getTime();
  const diff = Math.round((dueDay - todayDay) / 86_400_000);
  return diff < 0 ? "overdue" : diff <= soonDays ? "soon" : "later";
}

/**
 * A short note about debts that are overdue or due in the next 3 days (for the daily reminder), or
 * null when there is nothing to say.
 */
export function dueDebtsText(debts: DebtDto[], now: Date): string | null {
  const lines: string[] = [];
  for (const d of debts) {
    if (d.remainingSatang <= 0) continue;
    const state = dueState(d.dueAt, now);
    if (state !== "overdue" && state !== "soon") continue;
    const baht = (d.remainingSatang / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const who =
      d.direction === "lent"
        ? `${cleanPerson(d.person)} ติดเรา`
        : `เราติด ${cleanPerson(d.person)}`;
    lines.push(
      `• ${who} ${currencySymbol()}${baht} (${state === "overdue" ? "เลยกำหนดแล้ว" : "ใกล้ครบกำหนด"})`,
    );
  }
  return lines.length === 0 ? null : ["เตือนหนี้ที่ใกล้ครบกำหนด", ...lines.slice(0, 5)].join("\n");
}
