import { currentLocale } from "@/lib/i18n";
import { VARIANTS } from "./variants-data";

/**
 * The same answer in different words. A reply that is one of the fixed lines of the bot comes out as
 * the original or one of a few other ways of saying the same thing, chosen at random, so asking the
 * same question twice does not get the very same sentence twice. Only the words change: numbers,
 * names and quoted examples travel through unchanged, and the writing in `variants-data.ts` is checked
 * for that by its test. Run at the end of a reply, after the manner (`applyManner`) has had its say.
 */
let random: () => number = process.env.VITEST ? () => 0 : Math.random;

/** For tests: the source of the dice (a function giving 0 up to just under 1). */
export function setVarietyRandom(fn: (() => number) | null): void {
  random = fn ?? (process.env.VITEST ? () => 0 : Math.random);
}

/** One of `items`, evenly. In tests the dice give the first, so the original wording. */
export function pickOne<T>(items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))] as T;
}

const PLACEHOLDER = /\{(\d+)\}/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Pattern {
  re: RegExp;
  /** Which `{n}` each captured group is. */
  order: number[];
  options: string[];
}

const EXACT = new Map<string, string[]>();
const PATTERNS: Pattern[] = [];

for (const [template, others] of Object.entries(VARIANTS)) {
  const options = [template, ...others];
  const marks = [...template.matchAll(PLACEHOLDER)];
  if (marks.length === 0) {
    EXACT.set(template, options);
    continue;
  }
  const parts = template.split(PLACEHOLDER); // literal, index, literal, index, ...
  let source = "";
  const order: number[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) source += escape(part);
    else {
      order.push(Number(part));
      source += "([\\s\\S]+?)";
    }
  });
  PATTERNS.push({ re: new RegExp(`^${source}$`), order, options });
}

/** The wording to use for `message`, or the message itself when it is not one of the varied lines. */
export function varyText(message: string): string {
  const exact = EXACT.get(message);
  if (exact) return pickOne(exact);
  for (const p of PATTERNS) {
    const m = p.re.exec(message);
    if (!m) continue;
    const chosen = pickOne(p.options);
    return chosen.replace(PLACEHOLDER, (whole, n) => {
      const at = p.order.indexOf(Number(n));
      return at >= 0 ? (m[at + 1] ?? whole) : whole;
    });
  }
  return message;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The words of a reply, said another way when the line is one of the bot's own. The `text` and
 * `altText` of a message and the words in a card are read, never the text a button sends (the bot reads
 * that as a command). An English chat has its own words and is left as it is.
 */
export function applyVariety<T extends { type: string }>(messages: T[]): T[] {
  if (currentLocale() === "en") return messages;
  const walk = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    const isAction = node.type === "message";
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        (key === "text" || key === "altText") && typeof value === "string" && !isAction
          ? varyText(value)
          : walk(value);
    }
    return out;
  };
  return messages.map((m) => walk(m as unknown as Json) as unknown as T);
}
