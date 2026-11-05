/**
 * The one AI quota of the chat ("ถาม AI"): every message the AI reads, and every question to พี่ฮูก,
 * takes one use for up to 20 words, and one more for each 20 after that. Counted per Bangkok month.
 */
export const AI_WORDS_PER_USE = 20;

/** What one message took from the quota: given back when no answer came of it. */
export interface AiCharge {
  units: number;
  /** The counter's month ("2026-11-01"). */
  month: string;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("th", { granularity: "word" })
    : null;

/** Words in `text`: Thai has no spaces between words, so it is cut by the word segmenter. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (segmenter) {
    let n = 0;
    for (const part of segmenter.segment(trimmed)) if (part.isWordLike) n++;
    return n;
  }
  // without a segmenter: spaces, and about one word for every five Thai letters
  return trimmed
    .split(/\s+/)
    .reduce((n, w) => n + Math.max(1, Math.ceil(w.replace(/[^฀-๿]/g, "").length / 5)), 0);
}

/** Uses of the AI quota a message takes: at least one. */
export function aiUnits(text: string): number {
  return Math.max(1, Math.ceil(countWords(text) / AI_WORDS_PER_USE));
}
