import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import type { TxType } from "@/lib/types";

export interface CategoryLite {
  id: string;
  /** null = system default category */
  user_id: string | null;
  type: TxType;
  name: string;
  keywords: string[];
  sort_order: number;
  is_hidden: boolean;
}

export interface MemoryLite {
  match_text: string;
  category_id: string;
}

export type CategorizeSource = "memory" | "keyword" | "fallback" | "none";

export interface CategorizeResult {
  categoryId: string | null;
  via: CategorizeSource;
}

const FALLBACK_NAME = "อื่นๆ";
const MIN_KEYWORD_LENGTH = 2;

/**
 * Whether the title has the keyword. A keyword in English letters must start a word ("room" is not in
 * "mushroom", "fund" not in "refund"); it may still run on ("grab" in "grabfood"). Thai has no spaces
 * between words, so a Thai keyword is found anywhere, as before.
 */
export function containsKeyword(title: string, key: string): boolean {
  if (!/^[a-z]/.test(key)) return title.includes(key);
  let at = title.indexOf(key);
  while (at !== -1) {
    if (at === 0 || !/[a-z]/.test(title[at - 1] ?? "")) return true;
    at = title.indexOf(key, at + 1);
  }
  return false;
}

export function normalizeText(text: string): string {
  return normalizeThaiDigits(text).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Rule-based categorization (steps 1, 2 and 4 of the chain; the LLM step comes later):
 * 1. the user's learned merchant memory, 2. category keywords (longest match wins,
 * the user's own categories beat system ones), 4. the "อื่นๆ" category of that type.
 */
export function categorizeByRules(input: {
  title: string;
  type: TxType;
  categories: CategoryLite[];
  memory: MemoryLite[];
}): CategorizeResult {
  const title = normalizeText(input.title);
  const usable = input.categories.filter((c) => c.type === input.type && !c.is_hidden);

  if (title) {
    // 1. merchant memory (must point at a category of the right type)
    const usableIds = new Set(usable.map((c) => c.id));
    let bestMemory: MemoryLite | null = null;
    for (const m of input.memory) {
      const key = normalizeText(m.match_text);
      if (!key || !usableIds.has(m.category_id) || !title.includes(key)) continue;
      if (!bestMemory || key.length > normalizeText(bestMemory.match_text).length) bestMemory = m;
    }
    if (bestMemory) return { categoryId: bestMemory.category_id, via: "memory" };

    // 2. keywords
    let best: { id: string; length: number; own: boolean } | null = null;
    for (const c of usable) {
      for (const raw of [...c.keywords, c.name]) {
        const key = normalizeText(raw);
        if (key.length < MIN_KEYWORD_LENGTH || !containsKeyword(title, key)) continue;
        const own = c.user_id !== null;
        if (!best || key.length > best.length || (key.length === best.length && own && !best.own)) {
          best = { id: c.id, length: key.length, own };
        }
      }
    }
    if (best) return { categoryId: best.id, via: "keyword" };
  }

  // 4. fallback
  const fallbacks = usable.filter((c) => c.name === FALLBACK_NAME);
  const fallback = fallbacks.find((c) => c.user_id !== null) ?? fallbacks[0];
  if (fallback) return { categoryId: fallback.id, via: "fallback" };
  return { categoryId: null, via: "none" };
}

/**
 * The category a title starts with by name ("อาหาร", "เดินทาง วิน"), which the person picked from
 * the quick-reply list or typed themselves. The name must end at a space or the end of the text,
 * so "อาหารเสริม" is not read as "อาหาร". The longest name wins; when income and expense share a
 * name ("อื่นๆ") the parsed type decides. Hidden categories are not matched.
 */
export function matchLeadingCategory(
  title: string,
  parsedType: TxType,
  categories: CategoryLite[],
): CategoryLite | null {
  const text = normalizeText(title);
  if (!text) return null;
  let best: CategoryLite | null = null;
  let bestLength = 0;
  for (const c of categories) {
    if (c.is_hidden) continue;
    const name = normalizeText(c.name);
    if (!name || !text.startsWith(name)) continue;
    if (text.length > name.length && text[name.length] !== " ") continue;
    const better =
      name.length > bestLength ||
      (name.length === bestLength &&
        best !== null &&
        c.type === parsedType &&
        best.type !== parsedType) ||
      (name.length === bestLength &&
        best !== null &&
        c.type === best.type &&
        c.user_id !== null &&
        best.user_id === null);
    if (better) {
      best = c;
      bestLength = name.length;
    }
  }
  return best;
}
