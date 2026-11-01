import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api";
import { log } from "@/lib/log";

export interface RateLimitResult {
  allowed: boolean;
  hits: number;
  limit: number;
}

export interface LimitRule {
  limit: number;
  windowSeconds: number;
}

/** One place for every limit, so they are easy to review and tune. */
export const LIMITS = {
  /** Chat text messages per user (spam and LLM-cost guard). */
  chat: { limit: 30, windowSeconds: 60 },
  /** Chat images per user: each one can trigger paid OCR calls. */
  chatImage: { limit: 10, windowSeconds: 60 },
  /** Pictures sent into a group by someone who owes on a bill: each can be a paid slip reading. */
  groupSlip: { limit: 10, windowSeconds: 3600 },
  /** Voice messages per user: each one is a paid transcription call. */
  chatVoice: { limit: 5, windowSeconds: 60 },
  /** ... and a daily ceiling so one account cannot run up the AI bill. */
  voiceDay: { limit: 60, windowSeconds: 86_400 },
  /** PDF files per user: each one is a paid AI reading of a whole document. */
  chatPdf: { limit: 3, windowSeconds: 60 },
  pdfDay: { limit: 20, windowSeconds: 86_400 },
  /** Questions to พี่ฮูก: each one is a paid AI call. */
  owl: { limit: 6, windowSeconds: 60 },
  owlDay: { limit: 40, windowSeconds: 86_400 },
  /** AI-assisted reading of long sentences: one paid call each, so a daily ceiling per person. */
  smartDay: { limit: 60, windowSeconds: 86_400 },
  /** AI Insight on request: one paid call each. */
  insightDay: { limit: 5, windowSeconds: 86_400 },
  /** Button taps (postbacks) per user. */
  postback: { limit: 60, windowSeconds: 60 },
  /** LIFF sign-in attempts per IP. */
  authPerIp: { limit: 30, windowSeconds: 60 },
  /** Writes from the web app per user. */
  write: { limit: 60, windowSeconds: 60 },
  /** Export file links per user. */
  exportLink: { limit: 10, windowSeconds: 60 },
  /** Points redemption / referral attempts per user. */
  points: { limit: 10, windowSeconds: 60 },
  /** Tries at a shared-wallet invite code per user (a 6-digit code can be guessed). */
  joinWallet: { limit: 10, windowSeconds: 3600 },
  /** Account deletion attempts per user. */
  deleteAccount: { limit: 3, windowSeconds: 3600 },
  /** Erasing history / a month (each is permanent) per user. */
  eraseData: { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, LimitRule>;

/** Stable, non-reversible id for a rate-limit key (keeps raw ids out of the table). */
export function hashKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
}

/**
 * Count a hit and report whether it is within `rule`. Fails OPEN: if the limiter itself is
 * broken (e.g. migration 0007 not applied) users are let through and the problem is logged,
 * because a broken limiter must never take the whole bot down.
 */
export async function rateLimit(
  db: SupabaseClient,
  bucket: string,
  subject: string,
  rule: LimitRule,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await db.rpc("check_rate_limit", {
      p_key: `${bucket}:${hashKey(subject)}`,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      { is_allowed: boolean; hits_in_window: number } | undefined;
    if (!row) throw new Error("empty limiter response");
    return { allowed: row.is_allowed, hits: row.hits_in_window, limit: rule.limit };
  } catch (error) {
    log.error("rate_limit_unavailable", error, { bucket });
    return { allowed: true, hits: 0, limit: rule.limit };
  }
}

export const TOO_MANY_REQUESTS_TEXT = "ส่งคำขอถี่เกินไปนิดนะ รอสักครู่แล้วลองใหม่อีกครั้ง";

/** For API routes: a 429 Response when over the limit, otherwise null. */
export async function limitOr429(
  db: SupabaseClient,
  bucket: string,
  subject: string,
  rule: LimitRule,
): Promise<Response | null> {
  const result = await rateLimit(db, bucket, subject, rule);
  if (result.allowed) return null;
  const res = apiError(TOO_MANY_REQUESTS_TEXT, 429);
  res.headers.set("Retry-After", String(rule.windowSeconds));
  return res;
}

/**
 * Best-effort client IP. Behind Cloudflare `cf-connecting-ip` is set by Cloudflare itself (a visitor
 * cannot choose it), so it comes first; x-forwarded-for is only a fallback because its first hop can
 * be written by the visitor.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
