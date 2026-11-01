import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizeByRules } from "@/lib/categorize/rules";
import { log, safeMessage } from "@/lib/log";
import { MAX_AUDIO_MS, ImageError } from "@/lib/line/content";
import { can, effectivePlan, VOICE_LIMIT } from "@/lib/plan";
import { LIFETIME, monthKey, refundUsage, takeUsage } from "@/lib/usage";
import { upsellReply } from "./upsell-reply";
import { parseMessage, type ParseResult } from "@/lib/parse/text-parser";
import { LIMITS, type LimitRule, type RateLimitResult } from "@/lib/rate-limit";
import { insertTransaction, loadCategories, loadMemoryFor, type UserRow } from "@/lib/repo";
import { needsRouter } from "@/lib/ai/route-text";
import { needsSmartParse, runSmartParse } from "@/lib/ai/smart-parse";
import type { TextStructurer } from "@/lib/ai/text-structurer";
import type { Transcriber } from "@/lib/voice/transcribe";
import { recordSmartEntries } from "./smart-entries";
import type { LineMessage } from "@/lib/types";
import {
  text,
  VOICE_DAY_LIMIT_TEXT,
  VOICE_EMPTY_TEXT,
  VOICE_FAILED_TEXT,
  VOICE_LOCKED_TEXT,
  VOICE_TASTE_TEXT,
  voiceQuotaText,
  VOICE_TOO_LONG_TEXT,
  voiceHeardText,
  voiceNoAmountText,
} from "./messages";
import { buildVoiceCard } from "./voice-flex";

export interface VoiceDeps {
  db: SupabaseClient;
  now: () => Date;
  fetchAudio: (messageId: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
  transcriber: Transcriber;
  /** Reads long or unclear sentences (voice is Elite, so it is allowed here). */
  structurer?: TextStructurer;
  /** Sorts what was heard like a typed message. Null (or absent): treat it as money. */
  route?: (heard: string, parsed: ParseResult) => Promise<LineMessage[] | null>;
  limit?: (bucket: string, subject: string, rule: LimitRule) => Promise<RateLimitResult>;
}

const MAX_ENTRIES = 3;

/**
 * Voice message -> transcript -> pending entries + "did I hear you right?" cards.
 * Order matters for cost: plan -> length -> daily cap -> download -> transcribe. Nothing is saved
 * as confirmed: every voice entry waits for the person's tap. The audio itself is never stored.
 */
export async function handleVoiceMessage(
  deps: VoiceDeps,
  user: UserRow,
  message: { id: string; duration?: number },
  lineUserId: string,
): Promise<LineMessage[]> {
  const now = deps.now();

  const plan = effectivePlan(user.plan, user.plan_expires_at, now);
  const paid = can(plan, "voiceLog");

  // 1. length: LINE tells us before we download anything
  if (typeof message.duration === "number" && message.duration > MAX_AUDIO_MS) {
    return [text(VOICE_TOO_LONG_TEXT)];
  }

  // 2. daily ceiling per person
  if (deps.limit) {
    const day = await deps.limit("voice_day", lineUserId, LIMITS.voiceDay);
    if (!day.allowed) return [text(VOICE_DAY_LIMIT_TEXT)];
  }

  // 3. quota: Pro and Elite have a monthly number; Free has one free taste for life
  // (and after that the upgrade pitch). Work that fails gives its use back (see `spent`).
  const kind = paid ? "voice" : "teaser_voice";
  const month = paid ? monthKey(now) : LIFETIME;
  const limit = paid ? VOICE_LIMIT[plan] : 1;
  let allowed = false;
  try {
    allowed = await takeUsage(deps.db, user.id, kind, limit, month);
  } catch (error) {
    log.error("voice_quota_failed", error);
    return [text(VOICE_FAILED_TEXT)];
  }
  if (!allowed) {
    return paid
      ? [text(voiceQuotaText(plan, limit))]
      : upsellReply(deps.db, user.id, now, "voice", VOICE_LOCKED_TEXT);
  }

  let spent = false;
  try {
    const messages = await transcribeAndRecord();
    return !paid && spent ? [...messages, text(VOICE_TASTE_TEXT)] : messages;
  } finally {
    if (!spent) {
      await refundUsage(deps.db, user.id, kind, month).catch((e) =>
        log.error("voice_refund_failed", e),
      );
    }
  }

  async function transcribeAndRecord(): Promise<LineMessage[]> {
    // 4. download
    let audio: { bytes: Uint8Array; mimeType: string };
    try {
      audio = await deps.fetchAudio(message.id);
    } catch (error) {
      if (error instanceof ImageError && error.reason === "too_large") {
        return [text(VOICE_TOO_LONG_TEXT)];
      }
      log.warn("voice_download_failed", { reason: safeMessage(error) });
      return [text(VOICE_FAILED_TEXT)];
    }

    // 5. transcribe
    let heard: string;
    try {
      heard = await deps.transcriber.transcribe(audio);
    } catch (error) {
      log.warn("voice_transcribe_failed", {
        provider: deps.transcriber.name,
        reason: safeMessage(error),
      });
      return [text(VOICE_FAILED_TEXT)];
    }
    if (!heard) return [text(VOICE_EMPTY_TEXT)];
    spent = true; // the audio was heard: this one counts

    // 6. understand it like typed text, but never save without a tap
    const parsed = parseMessage(heard, now);
    const { entries } = parsed;

    // "เล่นเกมตอน 19:13" is a reminder, not 19 baht
    if (deps.route && needsRouter(heard, parsed)) {
      const routed = await deps.route(heard, parsed);
      if (routed) return [text(voiceHeardText(heard)), ...routed];
    }

    const [categories, memory] = await Promise.all([
      loadCategories(deps.db, user.id),
      loadMemoryFor(deps.db, user, now),
    ]);

    // a long or unclear sentence: let the AI read it first, the rules stay as the fallback
    if (deps.structurer && can(plan, "smartParse") && needsSmartParse(heard, parsed)) {
      const smart = await runSmartParse(
        { structurer: deps.structurer, limit: deps.limit, now: deps.now },
        {
          text: heard,
          subject: lineUserId,
          cap: { db: deps.db, userId: user.id },
          categories: categories
            .filter((c) => !c.is_hidden)
            .map((c) => ({ name: c.name, type: c.type })),
        },
      );
      if (smart) {
        const cards = await recordSmartEntries({
          db: deps.db,
          user,
          entries: smart,
          categories,
          memory,
          rawText: heard,
          source: "voice",
        });
        return [text(voiceHeardText(heard)), ...cards];
      }
    }

    if (entries.length === 0) return [text(voiceNoAmountText(heard))];
    const cards: LineMessage[] = [];
    for (const entry of entries.slice(0, MAX_ENTRIES)) {
      const { categoryId } = categorizeByRules({
        title: entry.title,
        type: entry.type,
        categories,
        memory,
      });
      const tx = await insertTransaction(deps.db, {
        userId: user.id,
        type: entry.type,
        title: entry.title,
        amountSatang: entry.amountSatang,
        categoryId,
        occurredAt: entry.occurredAt,
        status: "pending_confirm",
        rawText: heard,
        source: "voice",
      });
      cards.push(
        buildVoiceCard({
          txId: tx.id,
          type: entry.type,
          title: entry.title,
          amountSatang: entry.amountSatang,
          categoryName: categories.find((c) => c.id === categoryId)?.name ?? null,
          occurredAt: entry.occurredAt,
        }),
      );
    }
    return [text(voiceHeardText(heard)), ...cards];
  }
}
