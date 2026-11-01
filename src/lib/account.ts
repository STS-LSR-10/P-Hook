import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllKeys } from "@/lib/file-repo";
import type { FileStore } from "@/lib/file-store";
import { SLIP_BUCKET } from "@/lib/slip-repo";

export { DELETE_CONFIRM_PHRASE, isDeleteConfirmed } from "@/lib/account-confirm";

const PAGE = 100;
const MAX_PAGES = 200; // 20,000 slip images: far beyond a Free/Plus user, but still bounded

/**
 * Permanently delete everything a user has (PDPA "erase my data"):
 * 1. their slip images in private Storage, and their kept files in R2,
 * 2. their user row — every other table references it with ON DELETE CASCADE
 *    (transactions, categories, budgets, slips, settings, recurring rules, memory, points...).
 * Storage goes first so a failure there leaves the database row in place and the user can retry.
 */
export async function deleteAccountData(
  db: SupabaseClient,
  userId: string,
  store: FileStore | null = null,
): Promise<{ filesRemoved: number }> {
  const bucket = db.storage.from(SLIP_BUCKET);
  let filesRemoved = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await bucket.list(userId, { limit: PAGE });
    if (listed.error) throw new Error(`list slip files: ${listed.error.message}`);
    const names = (listed.data ?? []).map((f) => f.name).filter(Boolean);
    if (names.length === 0) break;

    const removed = await bucket.remove(names.map((name) => `${userId}/${name}`));
    if (removed.error) throw new Error(`remove slip files: ${removed.error.message}`);
    filesRemoved += names.length;
    if (names.length < PAGE) break;
  }

  const keys = await listAllKeys(db, userId);
  if (keys.length > 0) {
    if (!store) throw new Error("file store unavailable");
    await store.delete(keys);
    filesRemoved += keys.length;
  }

  const { error } = await db.from("users").delete().eq("id", userId);
  if (error) throw new Error(`delete user: ${error.message}`);
  return { filesRemoved };
}
