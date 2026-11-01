import type { SupabaseClient } from "@supabase/supabase-js";
import { bangkokParts } from "@/lib/thai-date";

export type UsageKind =
  | "voice"
  | "smart_parse"
  | "teaser_voice"
  | "group_slip"
  | "pdf"
  | "owl"
  | "router"
  | "file_save";

/** The "lifetime" bucket: a counter that never rolls over. */
export const LIFETIME = "2000-01-01";

/** First day of the Bangkok month `now` falls in, as YYYY-MM-DD. */
export function monthKey(now: Date): string {
  const p = bangkokParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-01`;
}

/** The Bangkok day `now` falls in, as YYYY-MM-DD: the `month` of a counter that resets daily. */
export function dayKey(now: Date): string {
  const p = bangkokParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Use one of `limit` for this month (or for life, with `month = LIFETIME`). False when they are used
 * up. Throws when the counter cannot be reached, so callers decide whether to fail open or closed.
 */
export async function takeUsage(
  db: SupabaseClient,
  userId: string,
  kind: UsageKind,
  limit: number,
  month: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("take_usage", {
    p_user: userId,
    p_kind: kind,
    p_month: month,
    p_limit: limit,
  });
  if (error) throw new Error(`take usage: ${error.message}`);
  return data === true;
}

/** Give one back because the work failed. Best effort. */
export async function refundUsage(
  db: SupabaseClient,
  userId: string,
  kind: UsageKind,
  month: string,
): Promise<void> {
  const { error } = await db.rpc("refund_usage", { p_user: userId, p_kind: kind, p_month: month });
  if (error) throw new Error(`refund usage: ${error.message}`);
}
