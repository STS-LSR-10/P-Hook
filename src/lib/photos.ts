import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBonus } from "@/lib/addons-repo";
import { fileCapacity } from "@/lib/file";
import { fileUsage } from "@/lib/file-repo";
import { extensionFor, ImageError } from "@/lib/line/content";
import {
  ERROR_TEXT,
  IMAGE_ERROR_TEXT,
  IMAGE_TOO_LARGE_TEXT,
  NOT_FOUND_TEXT,
  PHOTO_ATTACHED_TEXT,
  PHOTO_EXPIRED_TEXT,
  PHOTO_LIMIT_TEXT,
  PHOTO_LOCKED_TEXT,
  text,
} from "@/lib/line/messages";
import { log } from "@/lib/log";
import type { SlipImage } from "@/lib/ocr/provider";
import { can, effectivePlan } from "@/lib/plan";
import { clearPhotoWait, getPhotoTx, setPhoto } from "@/lib/photo-repo";
import type { UserRow } from "@/lib/repo";
import { getUserPlanRow, SLIP_BUCKET } from "@/lib/slip-repo";
import type { LineMessage } from "@/lib/types";

export interface PhotoDeps {
  db: SupabaseClient;
  now: () => Date;
  fetchImage: (messageId: string) => Promise<SlipImage>;
}

/** One file per entry, so replacing it overwrites and deleting one entry's photo never touches another's. */
export function photoPathFor(userId: string, txId: string, mimeType: string): string {
  return `${userId}/photo-${txId}.${extensionFor(mimeType)}`;
}

/** The person's storage space cannot take this photo. */
export class PhotoStorageFull extends Error {}

/** Plan, shared by the button tap and the image that follows it. Null = allowed. */
export async function photoBlockedReply(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<LineMessage[] | null> {
  const row = await getUserPlanRow(db, userId);
  if (!can(effectivePlan(row.plan, row.plan_expires_at, now), "entryPhoto")) {
    return [text(PHOTO_LOCKED_TEXT)];
  }
  return null;
}

/**
 * Store the image as the entry's one photo (replacing a previous one) and record it, with its size,
 * on the entry. The photo takes space like any file: throws PhotoStorageFull when it would not fit
 * (a photo it replaces gives its own space back). Checked just before storing, not atomically.
 */
export async function attachPhotoBytes(
  db: SupabaseClient,
  userId: string,
  tx: { id: string; photo_path: string | null; photo_bytes?: number | null },
  image: SlipImage,
  now: Date,
): Promise<void> {
  const row = await getUserPlanRow(db, userId);
  const capacity = fileCapacity(
    effectivePlan(row.plan, row.plan_expires_at, now),
    (await loadBonus(db, userId)).storageBytes,
  );
  const used = (await fileUsage(db, userId)) - (tx.photo_bytes ?? 0);
  if (used + image.bytes.byteLength > capacity) throw new PhotoStorageFull();
  const path = photoPathFor(userId, tx.id, image.mimeType);
  const upload = await db.storage
    .from(SLIP_BUCKET)
    .upload(path, image.bytes, { contentType: image.mimeType, upsert: true });
  if (upload.error) throw new Error(`upload photo: ${upload.error.message}`);

  try {
    await setPhoto(db, userId, tx.id, path, now, image.bytes.byteLength);
  } catch (error) {
    await db.storage
      .from(SLIP_BUCKET)
      .remove([path])
      .catch(() => undefined);
    throw error;
  }
  // a different file type than before leaves the old file behind: remove it
  if (tx.photo_path && tx.photo_path !== path) {
    await db.storage
      .from(SLIP_BUCKET)
      .remove([tx.photo_path])
      .catch(() => undefined);
  }
}

/**
 * The image that follows a tap on "แนบรูป": store it for that entry. No OCR, no AI call, and it
 * does not count toward the slip quota. The wait row is cleared whatever happens, so one tap
 * covers one image.
 */
export async function handlePhotoImage(
  deps: PhotoDeps,
  user: UserRow,
  messageId: string,
  wait: { tx_id: string; expired: boolean },
): Promise<LineMessage[]> {
  const { db } = deps;
  const now = deps.now();
  try {
    if (wait.expired) return [text(PHOTO_EXPIRED_TEXT)];

    // plan may have ended since the tap
    const blocked = await photoBlockedReply(db, user.id, now);
    if (blocked) return blocked;

    const tx = await getPhotoTx(db, user.id, wait.tx_id);
    if (!tx) return [text(NOT_FOUND_TEXT)];

    let image: SlipImage;
    try {
      image = await deps.fetchImage(messageId);
    } catch (error) {
      if (error instanceof ImageError) {
        return [text(error.reason === "too_large" ? IMAGE_TOO_LARGE_TEXT : IMAGE_ERROR_TEXT)];
      }
      throw error;
    }

    await attachPhotoBytes(db, user.id, tx, image, now);
    return [text(PHOTO_ATTACHED_TEXT(tx.title))];
  } catch (error) {
    if (error instanceof PhotoStorageFull) return [text(PHOTO_LIMIT_TEXT)];
    log.error("photo_attach_failed", error);
    return [text(ERROR_TEXT)];
  } finally {
    await clearPhotoWait(db, user.id);
  }
}
