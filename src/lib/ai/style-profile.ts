/**
 * How a person types an entry, kept as counts only: the amount before or after the name, Thai
 * digits, "k", "พัน", "บาท". Nothing they wrote is kept. Read by the AI as a short hint and shown
 * to the person in settings, where it can be switched off and cleared.
 */
export interface StyleHabits {
  /** Messages seen (halved when it passes MAX_SEEN, so a changed habit shows in time). */
  n: number;
  amountFirst: number;
  amountLast: number;
  thaiDigits: number;
  kWord: number;
  thousandWord: number;
  baht: number;
}

export type HabitKey =
  "amount_first" | "amount_last" | "thai_digits" | "k_word" | "thousand_word" | "baht";

const MAX_SEEN = 200;
const MAX_LENGTH = 80;
const MIN_SEEN = 5;
const SHARE = 0.7;

export const emptyHabits = (): StyleHabits => ({
  n: 0,
  amountFirst: 0,
  amountLast: 0,
  thaiDigits: 0,
  kWord: 0,
  thousandWord: 0,
  baht: 0,
});

const FIELDS = [
  "amountFirst",
  "amountLast",
  "thaiDigits",
  "kWord",
  "thousandWord",
  "baht",
] as const;

/** Whatever came from storage, made safe to use: counts that are whole, not negative, not huge. */
export function cleanHabits(raw: unknown): StyleHabits {
  const out = emptyHabits();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of ["n", ...FIELDS] as const) {
    const v = r[k];
    out[k] =
      typeof v === "number" && Number.isFinite(v)
        ? Math.min(MAX_SEEN, Math.max(0, Math.floor(v)))
        : 0;
  }
  return out;
}

/** Add one message that the rules read as a single entry. Messages that teach nothing change nothing. */
export function observeHabits(h: StyleHabits, text: string): StyleHabits {
  const s = text.trim();
  if (!s || s.length > MAX_LENGTH || s.includes("\n")) return h;
  const digit = s.search(/[0-9๐-๙]/);
  const letter = s.search(/[\p{L}]/u);
  // a name to compare the amount with: letters other than the "k" of "25k"
  const named = /[\p{L}]/u.test(s.replace(/[0-9๐-๙]\s*[kK]\b/g, ""));
  if (digit === -1 || letter === -1 || !named) return h;

  const next = { ...h, n: h.n + 1 };
  if (digit < letter) next.amountFirst += 1;
  else next.amountLast += 1;
  if (/[๐-๙]/.test(s)) next.thaiDigits += 1;
  if (/[0-9๐-๙]\s*[kK]\b/.test(s)) next.kWord += 1;
  if (/[0-9๐-๙]\s*พัน/.test(s)) next.thousandWord += 1;
  if (/บาท/.test(s)) next.baht += 1;

  if (next.n > MAX_SEEN) {
    for (const k of ["n", ...FIELDS] as const) next[k] = Math.floor(next[k] / 2);
  }
  return next;
}

/** The habits that are clearly theirs: enough messages, and at least 70% of them. */
export function habitKeys(h: StyleHabits): HabitKey[] {
  if (h.n < MIN_SEEN) return [];
  const keys: HabitKey[] = [];
  if (h.amountFirst / h.n >= SHARE) keys.push("amount_first");
  else if (h.amountLast / h.n >= SHARE) keys.push("amount_last");
  if (h.thaiDigits / h.n >= SHARE) keys.push("thai_digits");
  // these are rarer: when they use one, it counts
  const total = h.amountFirst + h.amountLast;
  if (total >= MIN_SEEN) {
    if (h.kWord / total >= 0.2) keys.push("k_word");
    if (h.thousandWord / total >= 0.2) keys.push("thousand_word");
    if (h.baht / total >= SHARE) keys.push("baht");
  }
  return keys;
}

const HINT: Record<HabitKey, string> = {
  amount_first: 'They usually write the amount before the item name, like "50 กาแฟ".',
  amount_last: 'They usually write the amount after the item name, like "กาแฟ 50".',
  thai_digits: "They often type Thai digits (๐-๙).",
  k_word: '"k" after a number means a thousand ("25k" is 25,000).',
  thousand_word: '"พัน" after a number means a thousand ("12พัน" is 12,000).',
  baht: 'They usually end an amount with "บาท".',
};

/** Short English lines for the AI prompt, made from the counts alone. */
export function styleHints(h: StyleHabits): string[] {
  return habitKeys(h)
    .slice(0, 5)
    .map((k) => HINT[k]);
}
