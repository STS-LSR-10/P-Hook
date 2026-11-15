import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";

/** How long "what was this for?" stays open for a typed answer. */
export const SLIP_ASK_MINUTES = 10;

/** One open question per user: a new slip replaces the old one. Never throws (it is a bonus step). */
export async function startSlipAsk(
  db: SupabaseClient,
  userId: string,
  txId: string,
  now: Date,
): Promise<boolean> {
  try {
    const { error } = await db.from("slip_asks").upsert(
      {
        user_id: userId,
        tx_id: txId,
        expires_at: new Date(now.getTime() + SLIP_ASK_MINUTES * 60_000).toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    log.warn("slip_ask_start_failed", { reason: safeMessage(error) });
    return false;
  }
}

/** The entry the next typed answer belongs to, or null (none, expired, or the table cannot be read). */
export async function getLiveSlipAsk(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ txId: string } | null> {
  try {
    const { data, error } = await db
      .from("slip_asks")
      .select("tx_id,expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as { tx_id: string; expires_at: string };
    return new Date(row.expires_at).getTime() > now.getTime() ? { txId: row.tx_id } : null;
  } catch {
    return null;
  }
}

/** Close the question; with `txId`, only when it is about that entry (a tap from an older card leaves a newer question). Never throws. */
export async function clearSlipAsk(
  db: SupabaseClient,
  userId: string,
  txId?: string,
): Promise<void> {
  try {
    let q = db.from("slip_asks").delete().eq("user_id", userId);
    if (txId) q = q.eq("tx_id", txId);
    const { error } = await q;
    if (error) throw new Error(error.message);
  } catch (error) {
    log.warn("slip_ask_clear_failed", { reason: safeMessage(error) });
  }
}
