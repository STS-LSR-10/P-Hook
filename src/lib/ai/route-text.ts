import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";
import type { ParseResult } from "@/lib/parse/text-parser";
import { ROUTER_DAILY_LIMIT, type Plan } from "@/lib/plan";
import { looksSecret } from "@/lib/secret-text";
import { dayKey, refundUsage, takeUsage } from "@/lib/usage";
import {
  MAX_ROUTER_INPUT,
  sanitizeDecision,
  type IntentDecision,
  type IntentRouter,
} from "./intent-router";
import { needsSmartParse } from "./smart-parse";

const CLOCK_RE = /โมง|ทุ่ม|พรุ่งนี้|มะรืน|ทุกวัน|ทุกสัปดาห์|ทุกเดือน/;
const KEEP_RE = /ต้องซื้อ|ต้องเตรียม|จดไว้|ฝากจำ|อย่าลืม|ที่อยู่|เก็บไว้|ไฟล์|เอกสาร/;

/** Words of a time or a repeat: the numbers next to them are not amounts of money. */
export const hasClockWords = (input: string): boolean => CLOCK_RE.test(input);

/** Three lines or more, most with no number: a list of things, not a list of entries. */
function isPlainList(input: string): boolean {
  const lines = input.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  return lines.filter((l) => !/\d/.test(l)).length * 2 > lines.length;
}

/**
 * Should the AI sort this message? Only when the rules cannot be trusted with it. Clear entries
 * such as "กาแฟ 50" stay with the rules, so they cost nothing and stay instant.
 */
export function needsRouter(input: string, result: ParseResult): boolean {
  return (
    needsSmartParse(input, result) ||
    looksSecret(input) ||
    hasClockWords(input) ||
    KEEP_RE.test(input) ||
    isPlainList(input)
  );
}

/**
 * Ask the AI which group `text` belongs to. Null means "use the ordinary rules instead": no AI
 * configured, the day's use is gone, the call failed, or the reply is unusable. Never throws.
 */
export async function runRouter(
  deps: { router?: IntentRouter; now: () => Date },
  input: { db: SupabaseClient; userId: string; plan: Plan; text: string },
): Promise<IntentDecision | null> {
  const { router } = deps;
  if (!router || looksSecret(input.text)) return null;
  if (input.text.length > MAX_ROUTER_INPUT) {
    return {
      intent: "unclear",
      confidence: 0,
      reminderText: null,
      reminderQuery: null,
      whenText: null,
      searchTerm: null,
    };
  }

  const day = dayKey(deps.now());
  let counted = false;
  try {
    counted = await takeUsage(
      input.db,
      input.userId,
      "router",
      ROUTER_DAILY_LIMIT[input.plan],
      day,
    );
    if (!counted) return null;
    const decision = sanitizeDecision(await router.route({ text: input.text, today: day }));
    if (decision) return decision;
    log.warn("intent_router_failed", { provider: router.name, reason: "unusable reply" });
  } catch (error) {
    log.warn("intent_router_failed", { provider: router.name, reason: safeMessage(error) });
  }
  if (counted) {
    await refundUsage(input.db, input.userId, "router", day).catch(() => undefined);
  }
  return null;
}
