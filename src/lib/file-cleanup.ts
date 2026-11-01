import type { SupabaseClient } from "@supabase/supabase-js";
import { dropFileRow, listStalePending, purgeExpiredMedia } from "@/lib/file-repo";
import type { FileStore } from "@/lib/file-store";
import { log, safeMessage } from "@/lib/log";

const STALE_MS = 60 * 60_000;

/**
 * Hourly: take away uploads that never finished, so they stop counting against anybody's space, and
 * files nobody kept. A row stays until its object is gone, so no object is left behind.
 */
export async function cleanupFiles(
  db: SupabaseClient,
  store: FileStore | null,
  now: Date,
): Promise<{ removed: number }> {
  await purgeExpiredMedia(db, now);
  if (!store) return { removed: 0 };

  let removed = 0;
  const stale = await listStalePending(db, new Date(now.getTime() - STALE_MS));
  for (const file of stale) {
    try {
      await store.delete([file.r2Key]);
      await dropFileRow(db, file.userId, file.id);
      removed += 1;
    } catch (error) {
      log.warn("file_cleanup_failed", { reason: safeMessage(error) });
    }
  }
  return { removed };
}
