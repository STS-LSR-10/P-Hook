import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";
import type { ParsedEntry, ParseResult } from "@/lib/parse/text-parser";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { AI_CHAT_LIMIT, type Plan } from "@/lib/plan";
import { looksSecret } from "@/lib/secret-text";
import { bangkokParts } from "@/lib/thai-date";
import { monthKey, refundUsageAmount, takeUsageAmount } from "@/lib/usage";
import { aiUnits } from "./ai-quota";
import {
  MAX_ROUTER_INPUT,
  sanitizeDecision,
  type IntentDecision,
  type IntentRouter,
} from "./intent-router";
import { needsSmartParse } from "./smart-parse";

const CLOCK_RE =
  /(?<!ชั่ว)โมง|ทุ่ม|พรุ่งนี้|มะรืน|ทุกวัน|ทุกสัปดาห์|ทุกเดือน|\d{1,2}:\d{2}|\d{1,2}\.\d{2}\s*น|บ่าย\s*\d|ตี\s*\d|อีก\s*\d+\s*(?:นาที|ชั่วโมง|ชม)/;
const KEEP_RE =
  /ต้องซื้อ|ต้องเตรียม|จดไว้|ฝากจำ|อย่าลืม|(?<!ค่า)ที่อยู่|เก็บ(?:ไฟล์|รูป|เอกสาร|วิดีโอ)|หา(?:ไฟล์|รูป)/;
const CLOCK_NUMBER_RE =
  /(\d{1,2})\s*(?:โมง|ทุ่ม)|(\d{1,2}):\d{2}|(\d{1,2}\.\d{2})\s*น|บ่าย\s*(\d)|ตี\s*(\d)|อีก\s*(\d+)\s*(?:นาที|ชั่วโมง|ชม)/g;

/**
 * Did the rules take the number of a time for an amount? "กินยา 6 โมงเย็น" read as 6 baht is wrong;
 * "เมื่อเช้า 8 โมง กาแฟ 60" is a real entry of 60 baht.
 */
export function clockIsTheAmount(input: string, entries: ParsedEntry[]): boolean {
  const numbers = new Set(
    [...normalizeThaiDigits(input).matchAll(CLOCK_NUMBER_RE)].map((m) =>
      Number(m.slice(1).find(Boolean)),
    ),
  );
  return entries.some((e) => !e.backdated && numbers.has(e.amountSatang / 100));
}

/**
 * A question, even with an amount in it ("ค่าไฟ 2000 แพงไหม"): never an entry. "ไหม" counts only at
 * the end, so "ผ้าไหม 500" stays an entry.
 */
const ASKS_RE =
  /(?:(?<!ผ้า)ไหม|มั้ย|หรือยัง|หรือเปล่า|รึเปล่า|รึยัง)\s*\??\s*$|\?\s*$|เท่าไร|เท่าไหร่|กี่บาท|กี่รายการ|กี่ครั้ง/;

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
    CLOCK_RE.test(input) ||
    KEEP_RE.test(input) ||
    ASKS_RE.test(input) ||
    isPlainList(input)
  );
}

/**
 * Ask the AI which group `text` belongs to. Null means "use the ordinary rules instead": no AI
 * configured, the month's "ถาม AI" is used up (then `onQuotaOut` is told), the call failed, or the
 * reply is unusable. Takes one use for each 20 words, given back when no answer came. Never throws.
 */
export async function runRouter(
  deps: { router?: IntentRouter; now: () => Date; onQuotaOut?: () => void },
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
      fileName: null,
      period: null,
    };
  }

  const month = monthKey(deps.now());
  const units = aiUnits(input.text);
  let counted = false;
  try {
    counted = await takeUsageAmount(
      input.db,
      input.userId,
      "ai_chat",
      units,
      AI_CHAT_LIMIT[input.plan],
      month,
    );
    if (!counted) {
      deps.onQuotaOut?.();
      return null;
    }
    const decision = sanitizeDecision(
      await router.route({ text: input.text, today: dayOf(deps.now()) }),
    );
    if (decision) return decision;
    log.warn("intent_router_failed", { provider: router.name, reason: "unusable reply" });
  } catch (error) {
    log.warn("intent_router_failed", { provider: router.name, reason: safeMessage(error) });
  }
  if (counted) {
    await refundUsageAmount(input.db, input.userId, "ai_chat", units, month).catch(() => undefined);
  }
  return null;
}

/** "2026-11-04": today in Bangkok, for the AI to know what "tomorrow" means. */
function dayOf(now: Date): string {
  const p = bangkokParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
