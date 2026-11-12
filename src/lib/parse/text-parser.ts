import type { TxType } from "@/lib/types";
import { extractForeign, type ForeignAmount } from "./currency";
import { extractDate } from "./date-parser";
import { normalizeThaiDigits, parseAmountToSatang } from "./thai-number";

export interface ParsedEntry {
  raw: string;
  type: TxType;
  title: string;
  /** Integer satang, always > 0. */
  amountSatang: number;
  occurredAt: Date;
  /** Lower-case #tags found in the text (at most MAX_TAGS), already removed from the title. */
  tags: string[];
  /** The word after "@" ("@บัตร"), already removed from the title; resolved to a wallet later. */
  walletHint: string | null;
  /**
   * Set only when parsing with `currencies: true` found "1500 JPY": then `amountSatang` still holds
   * the amount in that currency (×100) and must be converted to baht before saving.
   */
  foreign: ForeignAmount | null;
  /** Filled in by the bot once `foreign` has been converted: what the rate was, and from which day. */
  fx?: { currency: string; minor: number; rate: number; sourceDay: string; stale: boolean };
  /** True when the text named a past day (เมื่อวาน, 12/10 …); "วันนี้" or no date is false. */
  backdated: boolean;
  /** 0..1. Below CONFIRM_THRESHOLD the bot should ask before saving as confirmed. */
  confidence: number;
}

export interface ParseResult {
  entries: ParsedEntry[];
  /** Segments that did not contain a usable amount. */
  unparsed: string[];
}

export const CONFIRM_THRESHOLD = 0.7;
const MAX_TITLE_LENGTH = 60;
export const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 20;
// "#word": starts with a letter (so "#1" stays a number), then letters/marks/digits/underscore.
const TAG_RE = /(^|\s)#(\p{L}[\p{L}\p{M}\p{N}_]{0,19})(?=\s|$)/gu;
const MAX_INT_DIGITS = 9; // longer digit runs are phone numbers / ids, not money
export const LARGE_AMOUNT_SATANG = 100_000_000; // 1,000,000 baht -> ask to confirm

export const INCOME_KEYWORDS = [
  "เงินเดือน",
  "โบนัส",
  "ขายของ",
  "ยอดขาย",
  "ขายสินค้า",
  "ขายออนไลน์",
  "ค่าคอม",
  "คอมมิชชั่น",
  "ปันผล",
  "ดอกเบี้ย",
  "รายได้",
  "ค่าจ้าง",
  // money received
  "รับเงิน",
  "ได้เงิน",
  "เงินเข้า",
  "เงินโอนเข้า",
  "โอนเข้า",
  "รับโอน",
  "ได้รับ",
  "รับค่า",
  "ค่าตอบแทน",
  "ขายได้",
  "กำไร",
  // windfalls and refunds
  "ถูกหวย",
  "ถูกรางวัล",
  "ถูกลอตเตอรี่",
  "ถูกลอตเตอรี",
  "รางวัลที่ 1",
  "ได้เงินคืน",
  "เงินคืน",
  "คืนเงิน",
];

/** Phrases that look like income but are money going out. Checked first. */
const EXPENSE_OVERRIDES = [
  "ดอกเบี้ยจ่าย",
  "จ่ายดอกเบี้ย",
  "ไม่ได้รับ",
  "ซื้อหวย",
  "จ่ายคืน",
  "ขอคืนเงิน",
];

/** Verbs that mean money going out, wherever they appear. */
const EXPENSE_VERBS = [
  "ซื้อ",
  "จ่าย",
  "ชำระ",
  "ผ่อน",
  "โอนให้",
  "โอนไป",
  "ให้ยืม",
  "ยืมเงิน",
  "เสียค่า",
  "เสียเงิน",
  "เติมเงิน",
  "บริจาค",
  "ทำบุญ",
];

/**
 * "ได้ …" / "รับ …" / "ขาย …" at the start of a word: money received ("ได้เงิน", "รับค่าขนม", "ขายรถ 200000";
 * "ร้านขายยา" is not matched: the word does not start there).
 * Not when followed by a word that makes it something else ("รับประทาน", "ได้ซื้อ").
 */
const GENERIC_INCOME_RE =
  /(?:^|\s)(?:ได้|รับ|ขาย)(?!ประทาน|รอง|ผิดชอบ|ส่ง|ซื้อ|จ่าย|ชำระ|ผ่อน|ไป|ไม่)/;
const AMOUNT_RE =
  /([+\-−–])?\s*(฿)?\s*(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(k(?![a-z])|พัน|หมื่น|แสน|ล้าน)?\s*(บาท|฿|บ\.|baht|thb)?/gi;

// Split on newline, ';' and ',' — but keep thousands separators like 20,000.
export const SPLIT_RE = /\r?\n|;|，|,(?!\d{3}(?!\d))/;

interface AmountCandidate {
  index: number;
  length: number;
  sign: "+" | "-" | null;
  explicit: boolean;
  satang: number;
}

function findAmount(line: string): AmountCandidate | null {
  const candidates: AmountCandidate[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const numberText = m[3];
    if (!numberText) continue;
    const intDigits = numberText.replace(/,/g, "").split(".")[0] ?? "";
    if (intDigits.length > MAX_INT_DIGITS) continue;

    let sign: "+" | "-" | null = null;
    if (m[1]) {
      const before = line[m.index - 1];
      // A sign glued to a word ("7-11") is a hyphen, not a sign.
      if (before === undefined || /\s/.test(before)) sign = m[1] === "+" ? "+" : "-";
    }
    const satang = parseAmountToSatang(numberText, m[4]);
    if (satang <= 0) continue;

    candidates.push({
      index: m.index,
      length: m[0].length,
      sign,
      explicit: Boolean(sign || m[2] || m[4] || m[5]),
      satang,
    });
  }
  if (candidates.length === 0) return null;
  const explicit = candidates.filter((c) => c.explicit);
  return explicit.at(-1) ?? candidates.at(-1) ?? null;
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, "")
    .trim();
}

/**
 * Income / expense by the earliest cue in the title: "รับจ้างซื้อของ" is income (รับ first),
 * "ซื้อหวยที่ได้เงิน" is expense (ซื้อ first). Returns the confidence of the guess, or null when
 * nothing in the title says (the caller then defaults to expense).
 */
function titleCue(rawTitle: string): { type: TxType; confidence: number } | null {
  // going to a shop that sells is buying: "ร้านขายของ" is not the word "ขายของ"
  const title = rawTitle.replace(/ร้าน\s*ขาย/g, "ร้าน");
  if (EXPENSE_OVERRIDES.some((k) => title.includes(k))) return { type: "expense", confidence: 0.9 };

  const firstIndex = (words: string[]) => {
    const hits = words.map((w) => title.indexOf(w)).filter((i) => i >= 0);
    return hits.length > 0 ? Math.min(...hits) : -1;
  };
  const keyword = firstIndex(INCOME_KEYWORDS);
  const generic = GENERIC_INCOME_RE.exec(title);
  const genericIdx = generic ? generic.index + (generic[0].startsWith(" ") ? 1 : 0) : -1;
  const expense = firstIndex(EXPENSE_VERBS);

  const incomeIdx = [keyword, genericIdx].filter((i) => i >= 0);
  if (incomeIdx.length === 0) return null;
  const income = Math.min(...incomeIdx);
  if (expense >= 0 && expense < income) return { type: "expense", confidence: 0.9 };
  // a listed phrase is surer than the generic ได้/รับ verbs
  return { type: "income", confidence: keyword >= 0 && keyword <= income ? 0.95 : 0.85 };
}
// Links are never transactions (their digits would otherwise be read as amounts).
const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|me|co|io|th)\b\/?/i;

/** Pull "#tag" words out of a line. Extra tags beyond MAX_TAGS are dropped but still removed. */
export function extractTags(line: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const text = line.replace(TAG_RE, (_m, lead: string, tag: string) => {
    const lower = tag.toLowerCase();
    if (tags.length < MAX_TAGS && !tags.includes(lower) && lower.length <= MAX_TAG_LENGTH) {
      tags.push(lower);
    }
    return lead;
  });
  return { text: text.replace(/\s+/g, " ").trim(), tags };
}

const WALLET_RE = /(^|\s)@([^\s@#]{1,30})(?=\s|$)/gu;

/** Pull "@wallet" words out of a line: the first is the hint, the rest are removed and ignored. */
export function extractWalletHint(line: string): { text: string; hint: string | null } {
  let hint: string | null = null;
  const text = line.replace(WALLET_RE, (_m, lead: string, word: string) => {
    hint ??= word;
    return lead;
  });
  return { text: text.replace(/\s+/g, " ").trim(), hint };
}

function parseLine(segment: string, now: Date, currencies: boolean): ParsedEntry | null {
  const normalized = normalizeThaiDigits(segment).trim();
  if (!normalized) return null;
  if (URL_RE.test(normalized)) return null;

  const { text: unwalleted, hint: walletHint } = extractWalletHint(normalized);
  const { text: untagged, tags } = extractTags(unwalleted);
  const dated = extractDate(untagged, now);
  const date = dated.date;
  // "1500 JPY": the amount of the line is in a foreign currency (only when the caller can convert it)
  const foreignHit = currencies ? extractForeign(dated.text) : null;
  const text = foreignHit ? foreignHit.text : dated.text;
  const amount: AmountCandidate | null = foreignHit
    ? {
        index: 0,
        length: 0,
        sign: foreignHit.sign,
        explicit: true,
        satang: foreignHit.foreign.minor,
      }
    : findAmount(text);
  if (!amount) return null;

  const title = cleanTitle(
    text.slice(0, amount.index) + " " + text.slice(amount.index + amount.length),
  );
  if (title.length > MAX_TITLE_LENGTH) return null;

  const cue = title ? titleCue(title) : null;
  let type: TxType;
  let confidence: number;
  if (amount.sign === "+") {
    type = "income";
    confidence = title ? 1 : 0.85;
  } else if (amount.sign === "-") {
    type = "expense";
    confidence = title ? 1 : 0.85;
  } else if (cue) {
    type = cue.type;
    confidence = cue.confidence;
  } else {
    type = "expense";
    confidence = title ? 0.9 : 0.5;
  }
  if (!foreignHit && amount.satang >= LARGE_AMOUNT_SATANG) confidence = Math.min(confidence, 0.6);

  const defaultTitle =
    !title && confidence >= CONFIRM_THRESHOLD
      ? type === "income"
        ? "รายรับ"
        : "รายจ่าย"
      : "รายการ";

  return {
    raw: segment.trim(),
    type,
    title: title || defaultTitle,
    tags,
    walletHint,
    foreign: foreignHit?.foreign ?? null,
    amountSatang: amount.satang,
    occurredAt: date ?? now,
    backdated: date !== null && date !== now,
    confidence,
  };
}

/**
 * Words that count or measure what came before: "2 จาน 100", "ไข่ 30 ฟอง 120" and "ทีวี 55 นิ้ว 15900"
 * are one entry each. A name starting with one of these is never an entry of its own.
 */
const UNIT_WORDS = new Set([
  "จาน",
  "แก้ว",
  "ชิ้น",
  "ตัว",
  "อัน",
  "ลูก",
  "ขวด",
  "ถุง",
  "กล่อง",
  "ห่อ",
  "คน",
  "ที่",
  "ใบ",
  "เม็ด",
  "ครั้ง",
  "วัน",
  "คืน",
  "ชม",
  "ชั่วโมง",
  "นาที",
  "กิโล",
  "กก",
  "โล",
  "ลิตร",
  "เมตร",
  "โมง",
  "ปี",
  "เดือน",
  "คัน",
  "เล่ม",
  "ชุด",
  "คู่",
  "แพ็ค",
  "แพค",
  "ซอง",
  "กระป๋อง",
  "ถ้วย",
  "ชาม",
  "ไม้",
  "หัว",
  "ดอก",
  "ต้น",
  "แผ่น",
  "ม้วน",
  "หลอด",
  "บาท",
  "บ.",
  "ฟอง",
  "แผง",
  "แถว",
  "ลัง",
  "ด้าม",
  "หลา",
  "ต่อ",
  "เครื่อง",
  "เส้น",
  "อย่าง",
  "นิ้ว",
  "เที่ยว",
  "รีม",
  "ฟุต",
  "โหล",
  "ก้อน",
  "แยก",
  "สาย",
  "ห้อง",
  "หลัง",
  "เท่า",
  "รอบ",
  "ท่าน",
  "องค์",
  "รูป",
  "ช่อ",
  "พวง",
  "มัด",
  "กำ",
  "ตลับ",
  "กระปุก",
  "แท่ง",
  "ปอนด์",
  "ออนซ์",
  "ซม",
  "มม",
  "กรัม",
  "ไร่",
  "งาน",
  "วา",
  "ตร",
]);
/** After an amount, these say what happened to it, not a new entry: "เสื้อ 500 ลด 100". */
const FLOW_WORDS = new Set([
  "เหลือ",
  "ทอน",
  "เงินทอน",
  "ลด",
  "ส่วนลด",
  "รวม",
  "รวมเป็น",
  "คูณ",
  "แถม",
  "คืน",
  "ได้คืน",
  "มัดจำ",
  "จ่ายไป",
  "ให้ไป",
  "ยื่น",
  "ยื่นไป",
  "เหลืออีก",
  "ค้าง",
  "ค้างอีก",
  "เกิน",
  "ขาด",
  "บวก",
  "ลบ",
  "เพิ่ม",
  "หัก",
  "ภาษี",
  "vat",
]);
/** A number after these is part of a name or an address: "ห้อง 1205", "ซอย 7", "วันที่ 3". */
const PLACE_WORDS = new Set([
  "ซอย",
  "ซ",
  "ชั้น",
  "ห้อง",
  "ถนน",
  "ถ",
  "ทะเบียน",
  "วันที่",
  "ที่",
  "ครั้งที่",
  "งวด",
  "งวดที่",
  "ข้อ",
  "เบอร์",
  "เลข",
  "เลขที่",
  "หมายเลข",
  "ตึก",
  "อาคาร",
  "โซน",
  "บ้านเลขที่",
  "รุ่น",
  "ไซส์",
  "ไซซ์",
  "หมู่",
  "หมู่ที่",
  "ม",
  "ป",
  "ชั้นปี",
  "สาขา",
  "ประตู",
  "ช่อง",
  "โต๊ะ",
  "เตียง",
  "แถวที่",
  "สาย",
  "เกรด",
  "ปีที่",
  "ภาค",
  "เทอม",
  "รหัส",
  "คิว",
  "ล็อต",
  "ล็อค",
  "ชุดที่",
  "ตอน",
  "ep",
  "no",
]);
const RUN_NUMBER = /\d(?:[\d,]*\d)?\s*(?:k(?![a-z])|พัน|หมื่น|แสน|ล้าน)?\s*(?:บาท|บ\.|฿)?/gi;
const JOINER_RE = /^(?:และ|กับ|แล้วก็|แล้ว|ต่อด้วย|ก็)\s+/;
const THAI = /[\u0E01-\u0E4E]/;
const LATIN = /[a-z]/i;
const NAME_CHARS = /[\u0E01-\u0E4E]|[a-z]/gi;

/** Is `name` the name of an entry of its own (and not a count, an address, or what became of an amount)? */
function ownName(name: string): boolean {
  if (/\d/.test(name) || /\.$/.test(name)) return false; // "ม.4", "น. 120"
  if ((name.match(NAME_CHARS) ?? []).length < 2) return false; // "x2", "5G"
  const words = name.toLowerCase().split(/\s+/);
  const first = words[0] ?? "";
  // the unit alone, or with a word that only qualifies it ("ฟองละ", "กิโลครึ่ง", "จานใหญ่")
  const unit = first.replace(/(?:ละ|ครึ่ง|ใหญ่|เล็ก|กลาง)$/, "");
  if (UNIT_WORDS.has(unit)) return false;
  if (FLOW_WORDS.has(first)) return false;
  return !words.some((w) => PLACE_WORDS.has(w.replace(/\.$/, "")));
}

/**
 * "ข้าวเช้า16 น้ำ14 กาแฟ30": names each followed by their own amount, typed one after another with no
 * comma, are several entries. Careful, because a wrong split loses money silently: each piece must be
 * a plain name (see `ownName`) then a whole amount, nothing may follow the last one, and all the names
 * are in one script ("ซื้อ iPhone 15 Pro 39900" is one thing). Null keeps the segment as one entry.
 * A day said first ("เมื่อวาน …") is for all of them; one said later is for the piece it is in.
 */
function splitRun(segment: string, now: Date): ParsedEntry[] | null {
  const text = normalizeThaiDigits(segment).replace(/\s+/g, " ").trim();
  // an address, a link, a time, a decimal or a foreign amount: too easy to cut in the wrong place
  if (/[@#/:.]|https?:/i.test(text.replace(/บ\./g, ""))) return null;
  if (parseLine(segment, now, true)?.foreign) return null;

  const dated = extractDate(text, now);
  const rest = dated.text.trim();
  const leading = rest !== text && text.endsWith(rest);
  const body = leading ? rest : text;

  const numbers = [...body.matchAll(RUN_NUMBER)];
  if (numbers.length < 2) return null;
  const pieces: string[] = [];
  let from = 0;
  for (const m of numbers) {
    const end = m.index + m[0].length;
    const piece = body.slice(from, end).trim().replace(JOINER_RE, "");
    const name = piece.slice(0, piece.length - m[0].trim().length).trim();
    if (!ownName(name)) return null;
    pieces.push(piece);
    from = end;
  }
  if (body.slice(from).trim()) return null;
  const names = pieces.map((p) => p.replace(RUN_NUMBER, ""));
  if (names.some((n) => LATIN.test(n)) && names.some((n) => THAI.test(n))) return null;

  const entries: ParsedEntry[] = [];
  for (const piece of pieces) {
    const entry = parseLine(piece, now, false);
    // a piece the rules cannot read: keep the whole segment together rather than lose part of it
    if (!entry) return null;
    entries.push(
      leading && dated.date
        ? { ...entry, occurredAt: dated.date, backdated: dated.date !== now }
        : entry,
    );
  }
  return entries;
}

/** Parse a chat message into zero or more transaction entries. */
export function parseMessage(
  input: string,
  now: Date = new Date(),
  options: { currencies?: boolean } = {},
): ParseResult {
  const entries: ParsedEntry[] = [];
  const unparsed: string[] = [];
  for (const segment of input.split(SPLIT_RE)) {
    if (!segment.trim()) continue;
    const run = splitRun(segment, now);
    if (run) {
      entries.push(...run);
      continue;
    }
    const entry = parseLine(segment, now, options.currencies === true);
    if (entry) entries.push(entry);
    else unparsed.push(segment.trim());
  }
  return { entries, unparsed };
}
