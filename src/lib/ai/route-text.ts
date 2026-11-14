import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";
import type { ParsedEntry, ParseResult } from "@/lib/parse/text-parser";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { AI_CHAT_LIMIT, type Plan } from "@/lib/plan";
import { looksSecret } from "@/lib/secret-text";
import { bangkokParts } from "@/lib/thai-date";
import { WEEKDAY_DAY_SOURCE } from "@/lib/user-reminder";
import { loadStyleHints } from "@/lib/style-repo";
import { monthKey, refundUsageAmount, takeUsageAmount } from "@/lib/usage";
import { aiUnits, type AiCharge } from "./ai-quota";
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
  /^\s*(?:ช่วย)?เตือน(?!ใจ)|ต้องซื้อ|ต้องเตรียม|จดไว้|จดว่า|จำไว้ว่า|ฝากจำ|อย่าลืม|(?<!ค่า)ที่อยู่|เก็บ(?:ไฟล์|รูป|เอกสาร|วิดีโอ)|หา(?:ไฟล์|รูป)/;
const CLOCK_NUMBER_RE =
  /(\d{1,2})\s*(?:โมง|ทุ่ม)|(\d{1,2}):\d{2}|(\d{1,2}\.\d{2})\s*น|บ่าย\s*(\d)|ตี\s*(\d)|อีก\s*(\d+)\s*(?:นาที|ชั่วโมง|ชม)/g;

/**
 * Did the rules take the number of a time for an amount? "กินยา 6 โมงเย็น" read as 6 baht is wrong;
 * "เมื่อเช้า 8 โมง กาแฟ 60" is a real entry of 60 baht.
 */
export function clockIsTheAmount(input: string, entries: ParsedEntry[]): boolean {
  const text = normalizeThaiDigits(input);
  const numbers = new Set(
    [...text.matchAll(CLOCK_NUMBER_RE)].map((m) => Number(m.slice(1).find(Boolean))),
  );
  // a day only when it is clearly one: "วันศุกร์ที่ 27", or a plan ("วันอาทิตย์ 27 ไปกินข้าว");
  // "วันจันทร์ 30 กาแฟ" stays 30 baht
  const day = weekdayDay(text);
  if (day && (day.withThi || /^\s*(?:ไป|มี|นัด|ต้อง)/.test(day.rest))) numbers.add(day.day);
  return entries.some((e) => !e.backdated && numbers.has(e.amountSatang / 100));
}

/**
 * A question, even with an amount in it ("ค่าไฟ 2000 แพงไหม"): never an entry. "ไหม" counts only at
 * the end, so "ผ้าไหม 500" stays an entry.
 */
export const ASKS_RE =
  /(?:(?<!ผ้า)ไหม|มั้ย|ป่ะ|ปะ|ป่าว|ปล่าว|มะ|หรือยัง|หรือเปล่า|รึเปล่า|รึยัง)\s*\??\s*$|\?\s*$|เท่าไร|เท่าไหร่|กี่บาท|กี่รายการ|ยังไง(?!ก็)|อย่างไร|ทำไม(?!้)|คืออะไร|กี่ครั้ง|กี่(?:เดือน|วัน|ปี|สัปดาห์|อาทิตย์|ชั่วโมง)/;

/**
 * A lone number that counts things, not baht: "ซื้อครีม 2 หลอด" is not 2 baht. Only when it is the
 * only number and no "บาท" says otherwise ("กาแฟ 2 แก้ว 90" has its price).
 */
const UNIT_AFTER_NUMBER =
  /\d(?:[\d,]*\d)?(?:\.\d+)?\s*(?:หลอด|แผง|จาน|คน|ชิ้น|อัน|กล่อง|แพ็ก|แพ็ค|ถุง|ขวด|ตัว|แก้ว|ชุด|ห่อ|เม็ด|ฟอง|เล่ม|คู่|โหล|ถ้วย|ชาม|ซอง|กระป๋อง|กก\.?|กิโล|ลิตร|กรัม|นาที|ชั่วโมง|ชม\.?|กม\.?|ก้าว|ใบ|วัน|เดือน|ปี|ครั้ง|รอบ|คืน|คัน|ลูก|เส้น)(?![ก-๙])/;
export function numberCountsThings(input: string): boolean {
  const text = normalizeThaiDigits(input);
  if (/บาท|฿|baht/i.test(text)) return false;
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).length === 1 && UNIT_AFTER_NUMBER.test(text);
}

/** A plan or a wish, not something spent: "เดือนหน้าต้องจ่ายค่าเทอม 20000", "อยากได้ไอโฟน 40000". */
const FUTURE_RE =
  /(?:เดือน|ปี|สัปดาห์|อาทิตย์)หน้า|อยากได้|อยากซื้อ|ต้องจ่าย|วางแผน|ตั้งใจ(?:จะ)?|จะ(?:ซื้อ|จ่าย|ไป)/;
/** A sentence in English (three words or more) or a day of the month in the words ("วันที่ 5"). */
const ENGLISH_WORDS_RE = /[a-z]{2,}/gi;
const DAY_OF_MONTH_RE = /วันที่\s*\d/;
/**
 * The day in "วันอาทิตย์ 27 ไปกินข้าว" or "วันศุกร์ที่ 27": a weekday at the start, or said with
 * "ที่". "ข้าววันศุกร์ 25" (an entry with its day) and "วันพุธ 2 เม็ด" give null.
 */
function weekdayDay(input: string): { day: number; rest: string; withThi: boolean } | null {
  const m = new RegExp(WEEKDAY_DAY_SOURCE).exec(input);
  if (!m) return null;
  const withThi = Boolean(m[2]);
  if (!withThi && input.slice(0, m.index).trim() !== "") return null;
  return { day: Number(m[3]), rest: input.slice(m.index + m[0].length), withThi };
}

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
    numberCountsThings(input) ||
    FUTURE_RE.test(input) ||
    (input.match(ENGLISH_WORDS_RE)?.length ?? 0) >= 3 ||
    (DAY_OF_MONTH_RE.test(input) && result.entries.every((e) => !e.backdated)) ||
    weekdayDay(normalizeThaiDigits(input)) !== null ||
    isPlainList(input)
  );
}

/** AI failures in a row, within a window, that pause it; the rules carry on in the meantime. */
export const BREAKER_FAILURES = 3;
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_PAUSE_MS = 120_000;
let failureTimes: number[] = [];
let pausedUntil = 0;

/** For tests: forget every failure and end any pause. */
export function resetRouterBreaker(): void {
  failureTimes = [];
  pausedUntil = 0;
}

/**
 * Did the provider fail us, rather than this one message? A timeout, a network error, or a status
 * that is not about the message (5xx, 429, 401/403, 404…) pauses the AI for everyone; a refused
 * message (400/422), an unusable reply or a parse error is that person's own and must not.
 */
function isProviderFailure(error: unknown): boolean {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true;
  }
  if (error instanceof TypeError) return true;
  const status = /request failed: (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1];
  return status !== undefined && status !== "400" && status !== "422";
}

function noteFailure(at: number): void {
  failureTimes = [...failureTimes.filter((t) => at - t < BREAKER_WINDOW_MS), at];
  if (failureTimes.length >= BREAKER_FAILURES) {
    pausedUntil = at + BREAKER_PAUSE_MS;
    failureTimes = [];
  }
}

/**
 * Ask the AI which group `text` belongs to. Null means "use the ordinary rules instead": no AI
 * configured, the month's "ถาม AI" is used up (then `onQuotaOut` is told), the call failed, or the
 * reply is unusable. Takes one use for each 20 words, given back when no answer came. Never throws.
 */
export async function runRouter(
  deps: {
    router?: IntentRouter;
    now: () => Date;
    onQuotaOut?: () => void;
    /** Told what the message took, when a decision came of it. */
    onCharged?: (charge: AiCharge) => void;
  },
  input: { db: SupabaseClient; userId: string; plan: Plan; text: string; history?: string },
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

  // A slow or failing AI is skipped for a while: nothing is charged and the rules answer at once.
  if (deps.now().getTime() < pausedUntil) return null;

  const month = monthKey(deps.now());
  const units = aiUnits(input.text);
  let counted = false;
  let asked = false;
  try {
    // read in step with the count, not after it: it is on the way of every message
    const hintsRead = loadStyleHints(input.db, input.userId);
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
    asked = true;
    const hints = await hintsRead;
    const decision = sanitizeDecision(
      await router.route({
        text: input.text,
        today: dayOf(deps.now()),
        hints,
        ...(input.history ? { history: input.history } : {}),
      }),
    );
    if (decision) {
      failureTimes = [];
      deps.onCharged?.({ units, month });
      return decision;
    }
    log.warn("intent_router_failed", { provider: router.name, reason: "unusable reply" });
  } catch (error) {
    if (asked && isProviderFailure(error)) noteFailure(deps.now().getTime());
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
