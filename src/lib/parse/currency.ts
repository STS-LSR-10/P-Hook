import { currentCurrency } from "@/lib/money";
import { parseAmountToSatang } from "./thai-number";

/** Currencies the rate source (Frankfurter, ECB reference rates) knows. */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "KRW",
  "SGD",
  "MYR",
  "HKD",
  "AUD",
  "CAD",
  "CHF",
  "INR",
  "IDR",
  "NZD",
  "PHP",
  "SEK",
  "NOK",
  "DKK",
] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Recognised but not available from the rate source: the bot says so instead of guessing. */
export const UNSUPPORTED_CURRENCIES = ["VND", "TWD"] as const;

export const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  USD: "ดอลลาร์สหรัฐ",
  EUR: "ยูโร",
  GBP: "ปอนด์",
  JPY: "เยน",
  CNY: "หยวน",
  KRW: "วอน",
  SGD: "ดอลลาร์สิงคโปร์",
  MYR: "ริงกิต",
  HKD: "ดอลลาร์ฮ่องกง",
  AUD: "ดอลลาร์ออสเตรเลีย",
  CAD: "ดอลลาร์แคนาดา",
  CHF: "ฟรังก์สวิส",
  INR: "รูปีอินเดีย",
  IDR: "รูเปียห์",
  NZD: "ดอลลาร์นิวซีแลนด์",
  PHP: "เปโซ",
  SEK: "โครนาสวีเดน",
  NOK: "โครนนอร์เวย์",
  DKK: "โครนเดนมาร์ก",
};

// Thai names, longest first so "ดอลลาร์สิงคโปร์" wins over "ดอลลาร์".
const THAI_NAMES: [string, string][] = [
  ["ดอลลาร์สิงคโปร์", "SGD"],
  ["ดอลลาร์ฮ่องกง", "HKD"],
  ["ดอลลาร์ออสเตรเลีย", "AUD"],
  ["ดอลล่าร์", "USD"],
  ["ดอลลาร์", "USD"],
  ["เหรียญสหรัฐ", "USD"],
  ["ยูโร", "EUR"],
  ["เยน", "JPY"],
  ["หยวน", "CNY"],
  ["วอน", "KRW"],
  ["ริงกิต", "MYR"],
];
const SYMBOLS: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₩": "KRW",
};

const CODES = [...SUPPORTED_CURRENCIES, ...UNSUPPORTED_CURRENCIES, "RMB"];
const WORD = `(?:${[...THAI_NAMES.map(([n]) => n), ...CODES].join("|")})`;
const NUMBER = String.raw`(\d(?:[\d,]*\d)?(?:\.\d+)?)`;
const NOT_LETTER_BEFORE = String.raw`(?<![A-Za-z])`;
const NOT_LETTER_AFTER = String.raw`(?![A-Za-z])`;

// 1500 JPY · 1500 เยน · JPY 1500 · $20 · ¥1,500 (optionally with a + / - in front)
const AFTER_RE = new RegExp(String.raw`([+\-−–])?\s*${NUMBER}\s*(${WORD})${NOT_LETTER_AFTER}`, "i");
const BEFORE_RE = new RegExp(
  String.raw`([+\-−–])?\s*${NOT_LETTER_BEFORE}(${WORD})\s*${NUMBER}`,
  "i",
);
const SYMBOL_RE = /([+\-−–])?\s*([$€£¥₩])\s*(\d(?:[\d,]*\d)?(?:\.\d+)?)/;
// the baht, which is foreign only in a book kept in another currency: 60 บาท · 60 baht · ฿60
const BAHT_AFTER_RE = new RegExp(
  String.raw`([+\-−–])?\s*${NUMBER}\s*(?:บาท|บ\.|baht|thb)${NOT_LETTER_AFTER}`,
  "i",
);
const BAHT_BEFORE_RE = /([+\-−–])?\s*฿\s*(\d(?:[\d,]*\d)?(?:\.\d+)?)/;

export interface ForeignAmount {
  /** ISO code, upper case. */
  currency: string;
  /** Amount in the currency's own units ×100 (so 1,500.50 JPY is 150050). */
  minor: number;
  supported: boolean;
}

function codeOf(word: string): string {
  const upper = word.toUpperCase();
  if (upper === "RMB") return "CNY";
  const thai = THAI_NAMES.find(([name]) => name === word);
  return thai ? thai[1] : upper;
}

/**
 * Find "1500 JPY" / "JPY 1500" / "1500 เยน" / "$20" in a line. Returns the amount, the sign typed in
 * front (if any) and the line with that phrase cut out; null when the line has no foreign amount.
 */
export function extractForeign(
  line: string,
): { foreign: ForeignAmount; sign: "+" | "-" | null; text: string } | null {
  const hit = (
    index: number,
    length: number,
    signChar: string | undefined,
    code: string,
    numberText: string,
  ) => {
    const minor = parseAmountToSatang(numberText);
    if (minor <= 0) return null;
    // a sign glued to a word ("7-11") is a hyphen, not a sign
    const before = line[index - 1];
    const signed = signChar && (before === undefined || /\s/.test(before));
    return {
      foreign: {
        currency: code,
        minor,
        supported: (SUPPORTED_CURRENCIES as readonly string[]).includes(code),
      },
      sign: signed ? (signChar === "+" ? ("+" as const) : ("-" as const)) : null,
      text: `${line.slice(0, index)} ${line.slice(index + length)}`.replace(/\s+/g, " ").trim(),
    };
  };

  if (currentCurrency() !== "THB") {
    const baht = BAHT_AFTER_RE.exec(line) ?? BAHT_BEFORE_RE.exec(line);
    if (baht?.[2]) {
      const found = hit(baht.index, baht[0].length, baht[1], "THB", baht[2]);
      if (found) return { ...found, foreign: { ...found.foreign, supported: true } };
    }
  }

  const after = AFTER_RE.exec(line);
  if (after?.[2] && after[3]) {
    const found = hit(after.index, after[0].length, after[1], codeOf(after[3]), after[2]);
    if (found) return found;
  }
  const before = BEFORE_RE.exec(line);
  if (before?.[2] && before[3]) {
    const found = hit(before.index, before[0].length, before[1], codeOf(before[2]), before[3]);
    if (found) return found;
  }
  const symbol = SYMBOL_RE.exec(line);
  if (symbol?.[2] && symbol[3]) {
    const code = SYMBOLS[symbol[2]];
    if (code) return hit(symbol.index, symbol[0].length, symbol[1], code, symbol[3]);
  }
  return null;
}
