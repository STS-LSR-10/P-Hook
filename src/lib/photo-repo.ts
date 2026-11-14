import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";
import { bangkokParts, fromBangkok } from "@/lib/thai-date";

/** How long "send me the photo" stays open after the person taps the button. */
export const PHOTO_WAIT_MINUTES = 10;

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

export interface PhotoTx {
  id: string;
  title: string;
  status: string;
  photo_path: string | null;
  photo_bytes: number | null;
}

/** The person's own live entry, or null (other users' ids and deleted entries match nothing). */
export async function getPhotoTx(
  db: SupabaseClient,
  userId: string,
  txId: string,
): Promise<PhotoTx | null> {
  const { data, error } = await db
    .from("transactions")
    .select("id,title,status,photo_path,photo_bytes")
    .eq("user_id", userId)
    .eq("id", txId)
    .maybeSingle();
  if (error) fail("load entry for photo", error);
  const tx = data as PhotoTx | null;
  return tx && tx.status !== "deleted" ? tx : null;
}

/** Photos attached to entries in the current Bangkok calendar month. */
export async function countPhotosThisMonth(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<number> {
  const p = bangkokParts(now);
  const { count, error } = await db
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("photo_at", fromBangkok(p.year, p.month, 1).toISOString())
    .lt("photo_at", fromBangkok(p.year, p.month + 1, 1).toISOString());
  if (error) fail("count photos", error);
  return count ?? 0;
}

/** One waiting entry per user: a second tap replaces the first. */
export async function startPhotoWait(
  db: SupabaseClient,
  userId: string,
  txId: string,
  now: Date,
  minutes = PHOTO_WAIT_MINUTES,
): Promise<void> {
  const { error } = await db.from("photo_waits").upsert(
    {
      user_id: userId,
      tx_id: txId,
      expires_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) fail("start photo wait", error);
}

/**
 * The entry the next image belongs to, or null. Never throws: if the table is missing (migration
 * not run) or the read fails, images simply keep going to slip reading as before.
 */
export async function getLivePhotoWait(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ tx_id: string; expired: boolean } | null> {
  try {
    const { data, error } = await db
      .from("photo_waits")
      .select("tx_id,expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as { tx_id: string; expires_at: string };
    return { tx_id: row.tx_id, expired: new Date(row.expires_at).getTime() <= now.getTime() };
  } catch (error) {
    log.warn("photo_wait_unavailable", { reason: safeMessage(error) });
    return null;
  }
}

export async function clearPhotoWait(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.from("photo_waits").delete().eq("user_id", userId);
  if (error) log.warn("photo_wait_clear_failed", { reason: safeMessage(error) });
}

export async function setPhoto(
  db: SupabaseClient,
  userId: string,
  txId: string,
  path: string,
  now: Date,
  bytes: number,
): Promise<void> {
  const { error } = await db
    .from("transactions")
    .update({ photo_path: path, photo_at: now.toISOString(), photo_bytes: bytes })
    .eq("user_id", userId)
    .eq("id", txId);
  if (error) fail("attach photo", error);
}

export async function clearPhoto(db: SupabaseClient, userId: string, txId: string): Promise<void> {
  const { error } = await db
    .from("transactions")
    .update({ photo_path: null, photo_at: null, photo_bytes: null })
    .eq("user_id", userId)
    .eq("id", txId);
  if (error) fail("remove photo", error);
}
