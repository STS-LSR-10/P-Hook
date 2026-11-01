import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanFileName,
  defaultFileName,
  extensionOfType,
  fileCapacity,
  fileDayLimit,
  isBlockedFile,
  MAX_FILE_BYTES,
  withExtensionOf,
  type FileDto,
} from "@/lib/file";
import { dropFileRow, markFileReady, reserveFile, type RecentMedia } from "@/lib/file-repo";
import type { FileStore } from "@/lib/file-store";
import { ImageError } from "@/lib/line/content";
import { log, safeMessage } from "@/lib/log";
import { effectivePlan } from "@/lib/plan";
import type { UserRow } from "@/lib/repo";
import { dayKey, refundUsage, takeUsage } from "@/lib/usage";

export type SaveFailure =
  "blocked" | "too_large" | "day_limit" | "full" | "gone" | "failed" | "unavailable";
export type SaveResult = { ok: true; file: FileDto } | { ok: false; reason: SaveFailure };

export interface SaveDeps {
  db: SupabaseClient;
  now: () => Date;
  store: FileStore | null;
  fetchFile: (messageId: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
}

/** The name to keep it under. Whatever it is called, it takes the extension of the real file. */
function chooseName(
  media: Omit<RecentMedia, "id">,
  given: string | null,
  mimeType: string,
  now: Date,
): string {
  const name =
    cleanFileName(given ?? "") ||
    cleanFileName(media.fileName ?? "") ||
    defaultFileName(media.kind, now);
  return withExtensionOf(name, media.fileName || `file${extensionOfType(mimeType)}`);
}

/**
 * Keep one file. The bytes come first because LINE gives no size for a picture, so the space is
 * reserved for the real size; every failure after that leaves no row and gives the day's use back.
 */
export async function saveFile(
  deps: SaveDeps,
  user: UserRow,
  media: Omit<RecentMedia, "id">,
  given: string | null,
): Promise<SaveResult> {
  const { db, store } = deps;
  if (!store) return { ok: false, reason: "unavailable" };
  if (media.fileName && isBlockedFile(media.fileName)) return { ok: false, reason: "blocked" };
  if (media.fileSize !== null && media.fileSize > MAX_FILE_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const now = deps.now();
  const plan = effectivePlan(user.plan, user.plan_expires_at, now);
  const day = dayKey(now);
  try {
    if (!(await takeUsage(db, user.id, "file_save", fileDayLimit(plan), day))) {
      return { ok: false, reason: "day_limit" };
    }
  } catch (error) {
    log.error("file_quota_failed", error);
    return { ok: false, reason: "failed" };
  }

  const giveBack = () => refundUsage(db, user.id, "file_save", day).catch(() => undefined);
  const id = crypto.randomUUID();
  const r2Key = `u/${user.id}/${id}`;
  let reserved = false;
  try {
    const { bytes, mimeType } = await deps.fetchFile(media.messageId);
    const name = chooseName(media, given, mimeType, now);
    reserved = await reserveFile(db, {
      id,
      userId: user.id,
      name,
      mimeType,
      sizeBytes: bytes.byteLength,
      r2Key,
      capacity: fileCapacity(plan),
    });
    if (!reserved) {
      await giveBack();
      return { ok: false, reason: "full" };
    }
    await store.put(r2Key, bytes, mimeType);
    await markFileReady(db, user.id, id);
    return {
      ok: true,
      file: {
        id,
        name,
        mimeType,
        sizeBytes: bytes.byteLength,
        createdAt: now.toISOString(),
      },
    };
  } catch (error) {
    if (reserved) {
      // the bytes may have landed; a row that stays pending lets the cleanup try again
      const removed = await store.delete([r2Key]).then(
        () => true,
        () => false,
      );
      if (removed) await dropFileRow(db, user.id, id).catch(() => undefined);
    }
    await giveBack();
    if (error instanceof ImageError && error.reason === "gone") {
      return { ok: false, reason: "gone" };
    }
    if (error instanceof ImageError && error.reason === "too_large") {
      return { ok: false, reason: "too_large" };
    }
    log.warn("file_save_failed", { reason: safeMessage(error) });
    return { ok: false, reason: "failed" };
  }
}
