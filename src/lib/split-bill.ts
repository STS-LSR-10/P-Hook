import { toSatang } from "@/lib/money";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { MAX_SPLIT_NAMES, splitAmount } from "@/lib/trip";

export const MAX_BILL_TITLE = 40;
export const MAX_BILL_MEMBERS = 30;
export const MAX_OPEN_BILLS = 10;
/** A bill is at most ฿1,000,000 (the database says the same). */
export const MAX_BILL_SATANG = 100_000_000;
/** Buttons "ได้รับจาก …" on the collecting card: more people than this use the typed command. */
export const MAX_PAID_BUTTONS = 8;

export type BillStatus = "setup" | "joining" | "collecting" | "settled" | "cancelled";

export interface BillRow {
  id: string;
  groupId: string;
  payerLineUserId: string;
  title: string;
  amountSatang: number;
  status: BillStatus;
  createdAt: string;
}

export type PaidVia = "payer" | "slip" | "slip_unverified";

export interface BillMemberRow {
  lineUserId: string;
  shareSatang: number | null;
  paid: boolean;
  qrToken: string;
  /** "โอนแล้ว": said they paid, the payer has not confirmed yet. */
  claimed?: boolean;
  /** How a waiting "โอนแล้ว" came about when a slip was checked: the payer still has to confirm it. */
  claimVia?: "slip" | "slip_unverified" | null;
  paidVia?: PaidVia | null;
}

export type BillCommand =
  | {
      kind: "bill-new";
      title: string;
      amountSatang: number;
      names: string[];
      /** "ทั้งหมด" / "ทุกคน": everyone the bot knows in the group, no choosing step. */
      all: boolean;
    }
  | { kind: "bill-announce"; shortId: string }
  | { kind: "bill-usage" }
  | { kind: "bill-chase" }
  /** `spoken`: asked the way people talk ("ใครค้างเงินบ้าง"), which may be meant for the group. */
  | { kind: "bill-open"; spoken?: boolean }
  | { kind: "bill-close" }
  | { kind: "bill-cancel" }
  /** Cancel every bill the one who types it is still setting up (nobody owes on those yet). */
  | { kind: "bill-cancel-all" }
  | { kind: "bill-paid"; names: string[] }
  | { kind: "bill-unpaid"; names: string[] }
  | { kind: "bill-claim" };

const AMOUNT_RE = /\d[\d,]*(?:\.\d{1,2})?/;
const HAS_DIGIT = /[0-9๐-๙]/;
/** Items are cut at a newline or at a comma not stuck to a digit (so 1,200 stays one number). */
const SEGMENT_SPLIT = /\s*(?:\n|,(?!\d))\s*/;
const isEveryone = (word: string) => word === "ทั้งหมด" || word === "ทุกคน";

/**
 * The entry in a message that says "หารบิล" somewhere: "หารบิล ข้าว 100", "หารบิลข้าว 100",
 * "ข้าว 100, น้ำ 200 หารบิล" and "ข้าว หารบิล 100" all mean the same. "หารบิล " in front is an explicit
 * command and always counts (with no amount the bot explains how); every other place needs an amount
 * in the message, so ordinary chat that merely contains the word stays unanswered. "" = the bare word.
 */
function billBody(text: string): string | null {
  if (text === "หารบิล") return "";
  const spaced = /^หารบิล ([\s\S]+)$/.exec(text);
  if (spaced?.[1]) return spaced[1];
  const withAmount = (body: string) => (body.trim() && HAS_DIGIT.test(body) ? body.trim() : null);
  if (text.startsWith("หารบิล")) return withAmount(text.slice("หารบิล".length));
  const trailing = /^([\s\S]*?)[\s,]*หารบิล$/.exec(text);
  if (trailing) return withAmount(trailing[1] ?? "");
  const middle = /^([\s\S]*?\S)[ \n]หารบิล[ \n](\S[\s\S]*)$/.exec(text);
  if (middle) return withAmount(`${middle[1]} ${middle[2]}`);
  return null;
}

interface BillPart {
  title: string;
  amountSatang: number;
  /** What follows the amount (people's names, or "ทั้งหมด"). */
  tail: string;
  amountFirst: boolean;
}

/** One item: "ข้าว 100", "ข้าว 100 แอน บ๊อบ" or "100 ข้าว". Null when there is no usable amount. */
function parseBillPart(segment: string): BillPart | null {
  const found = AMOUNT_RE.exec(segment);
  if (!found) return null;
  let amountSatang: number;
  try {
    amountSatang = toSatang(found[0]);
  } catch {
    return null;
  }
  if (amountSatang <= 0 || amountSatang > MAX_BILL_SATANG) return null;
  const before = segment.slice(0, found.index).trim();
  const after = segment.slice(found.index + found[0].length).trim();
  return before === ""
    ? { title: after, amountSatang, tail: "", amountFirst: true }
    : { title: before, amountSatang, tail: after, amountFirst: false };
}

/** "หมูกระทะ ทั้งหมด" -> the name without the last word, and whether it said everyone. */
function peelEveryone(title: string): { rest: string; all: boolean } {
  const m = /^(.*?)\s*(?:ทั้งหมด|ทุกคน)$/.exec(title);
  return m ? { rest: m[1]?.trim() ?? "", all: true } : { rest: title, all: false };
}

/** The body of a "หารบิล" message: one item, or several (their amounts add up to one bill). */
function parseBillBody(body: string): BillCommand {
  const parts: BillPart[] = [];
  const segments = body
    .split(SEGMENT_SPLIT)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const part = parseBillPart(segment);
    if (part) {
      parts.push(part);
      continue;
    }
    // words with no amount after an item are more names ("... 1250 แอน, บ๊อบ ชมพู")
    const previous = parts[parts.length - 1];
    if (!previous || HAS_DIGIT.test(segment)) return { kind: "bill-usage" };
    previous.tail = `${previous.tail} ${segment}`.trim();
  }
  const last = parts[parts.length - 1];
  if (!last) return { kind: "bill-usage" };

  const titles = parts.map((p) => p.title);
  let all = false;
  let names: string[] = [];
  if (last.amountFirst) {
    const peeled = peelEveryone(last.title);
    all = peeled.all;
    titles[titles.length - 1] = peeled.rest;
  } else {
    const typed = last.tail.split(/[\s,]+/).filter(Boolean);
    all = typed.some(isEveryone);
    names = typed.filter((w) => !isEveryone(w));
  }
  const amountSatang = parts.reduce((sum, p) => sum + p.amountSatang, 0);
  if (amountSatang > MAX_BILL_SATANG || names.length > MAX_SPLIT_NAMES)
    return { kind: "bill-usage" };

  let title = titles.filter(Boolean).join(", ") || "บิล";
  if (title.length > MAX_BILL_TITLE) {
    // one long name is a mistake; a long list of items is just shortened
    if (parts.length === 1) return { kind: "bill-usage" };
    title = `${title.slice(0, MAX_BILL_TITLE - 1)}…`;
  }
  return { kind: "bill-new", title, amountSatang, names, all };
}

/**
 * "หารบิล หมูกระทะ 1200" · "หารบิล หมูกระทะ 1200 แอน บ๊อบ" · "หารบิล 1200 หมูกระทะ" · "หารบิล ข้าว 100,
 * น้ำ 200" (one bill of ฿300) · "ข้าว 100 หารบิล"; names or "ทั้งหมด" at the end choose the people at
 * once. Also "ตามเงิน", "บิลค้าง", "ปิดรายชื่อ", "ยกเลิกบิล", "ยกเลิกบิลทั้งหมด" and "ได้รับแล้ว แอน".
 */
export function parseBillCommand(input: string): BillCommand | null {
  // "หารบิล", "หาร บิล" and "แบ่งบิล" are the same words, wherever they stand
  const text = normalizeThaiDigits(input)
    .trim()
    // spaces are squeezed but lines stay lines (one item per line is a way to write several)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .replace(/^(?:หาร|แบ่ง) ?บิล/, "หารบิล")
    .replace(/(^|[ \n])(?:หาร|แบ่ง) ?บิล(?=[ \n]|$)/g, "$1หารบิล");
  const announce = /^✅ เลือกคนหารบิล .+ #([0-9a-f]{8})$/.exec(text);
  if (announce?.[1]) return { kind: "bill-announce", shortId: announce[1] };
  if (text === "ตามเงิน") return { kind: "bill-chase" };
  // "ใครค้างบ้าง", "ใครค้างเงินบ้าง", "ใครยังไม่จ่ายบ้าง": asked the way people say it
  if (text === "บิลค้าง") return { kind: "bill-open" };
  if (/^ใคร(?:ยัง)?(?:ค้าง|ไม่จ่าย)(?:เงิน|จ่าย)?(?:อยู่)?บ้าง$/.test(text))
    return { kind: "bill-open", spoken: true };
  if (text === "ปิดรายชื่อ") return { kind: "bill-close" };
  if (text === "ยกเลิกบิล") return { kind: "bill-cancel" };
  if (text === "ยกเลิกบิลทั้งหมด") return { kind: "bill-cancel-all" };
  if (text === "โอนแล้ว") return { kind: "bill-claim" };
  const unpaidWords = /^ยังไม่ได้รับ\s+(.+)$/.exec(text);
  if (unpaidWords?.[1]) {
    const names = unpaidWords[1].split(/[\s,]+/).filter(Boolean);
    return names.length > 0 && names.length <= MAX_SPLIT_NAMES
      ? { kind: "bill-unpaid", names }
      : null;
  }
  const paid = /^ได้รับ(?:แล้ว)?\s+(.+)$/.exec(text);
  if (paid?.[1]) {
    const names = paid[1].split(/[\s,]+/).filter(Boolean);
    return names.length > 0 && names.length <= MAX_SPLIT_NAMES
      ? { kind: "bill-paid", names }
      : null;
  }

  const body = billBody(text);
  if (body === null) return null;
  return body === "" ? { kind: "bill-usage" } : parseBillBody(body);
}

export interface BillShare {
  lineUserId: string;
  shareSatang: number;
  /** The payer's own share counts as paid. */
  paid: boolean;
}

/**
 * Everyone's share of a bill, equal, in whole satang that add up to the bill exactly. The payer is
 * always one of the people sharing it (the leftover satang go to them first).
 */
export function billShares(amountSatang: number, people: string[], payer: string): BillShare[] {
  const everyone = people.includes(payer) ? people : [payer, ...people];
  return [...splitAmount(amountSatang, everyone, payer)].map(([lineUserId, shareSatang]) => ({
    lineUserId,
    shareSatang,
    paid: lineUserId === payer,
  }));
}

/** Who still owes: not paid yet, the payer excluded. */
export function unpaid(members: BillMemberRow[], payer: string): BillMemberRow[] {
  return members.filter((m) => !m.paid && m.lineUserId !== payer);
}

export function totalOwed(members: BillMemberRow[], payer: string): number {
  return unpaid(members, payer).reduce((s, m) => s + (m.shareSatang ?? 0), 0);
}

// ───────────── paying by slip ─────────────

/** What a person still owes on a bill, as the slip check sees it. */
export interface OpenShare {
  bill: BillRow;
  shareSatang: number;
}

/** Where the payer of a bill wants to be paid (only the digits matter here). */
export interface PayeeDigits {
  promptpayId: string | null;
  bankAccount: string | null;
}

/** The last four digits of every place the payer can be paid; the slip's receiver must be one of them. */
export function receiverLast4s(payee: PayeeDigits | null): string[] {
  if (!payee) return [];
  return [payee.promptpayId, payee.bankAccount]
    .map((v) => (v ?? "").replace(/\D/g, ""))
    .filter((d) => d.length >= 4)
    .map((d) => d.slice(-4));
}

export type SlipVerdict =
  | {
      kind: "paid";
      share: OpenShare;
      /** The receiver on the slip matched the payer's account; "unverified" = it could not be read or compared. */
      receiver: "verified" | "unverified";
      /** Satang sent over the share. */
      overSatang: number;
    }
  | { kind: "receiver_mismatch"; share: OpenShare }
  | { kind: "too_little"; amountSatang: number; smallestShareSatang: number }
  | { kind: "before_bill"; share: OpenShare };

/** A slip made before the bill was opened cannot pay it (a few minutes of clock difference are fine). */
const EARLY_SLACK_MS = 10 * 60_000;

/**
 * Does this slip pay one of the person's open shares? It must be for at least the share (more is fine and
 * is mentioned), made after the bill was opened (when the slip says when), and sent to the payer's
 * account when the slip shows enough of it to tell. When the receiver cannot be told the share is still
 * marked paid, flagged "unverified", and the payer can take it back.
 */
export function evaluateSlip(input: {
  open: OpenShare[];
  amountSatang: number;
  paidAt: Date | null;
  receiverLast4: string | null;
  payeeOf: (payerLineUserId: string) => PayeeDigits | null;
}): SlipVerdict | null {
  if (input.open.length === 0) return null;
  const enough = input.open.filter((s) => s.shareSatang <= input.amountSatang);
  if (enough.length === 0) {
    return {
      kind: "too_little",
      amountSatang: input.amountSatang,
      smallestShareSatang: Math.min(...input.open.map((s) => s.shareSatang)),
    };
  }
  // the share the slip is closest to; the older bill first when two are equal
  const chosen = [...enough].sort(
    (a, b) => b.shareSatang - a.shareSatang || a.bill.createdAt.localeCompare(b.bill.createdAt),
  )[0] as OpenShare;

  if (
    input.paidAt &&
    input.paidAt.getTime() < new Date(chosen.bill.createdAt).getTime() - EARLY_SLACK_MS
  ) {
    return { kind: "before_bill", share: chosen };
  }
  const accounts = receiverLast4s(input.payeeOf(chosen.bill.payerLineUserId));
  let receiver: "verified" | "unverified" = "unverified";
  if (input.receiverLast4 && accounts.length > 0) {
    if (!accounts.includes(input.receiverLast4))
      return { kind: "receiver_mismatch", share: chosen };
    receiver = "verified";
  }
  return {
    kind: "paid",
    share: chosen,
    receiver,
    overSatang: input.amountSatang - chosen.shareSatang,
  };
}
