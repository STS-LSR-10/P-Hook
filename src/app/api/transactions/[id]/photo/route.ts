import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { can, effectivePlan, PHOTOS_PER_MONTH } from "@/lib/plan";
import { attachPhotoBytes } from "@/lib/photos";
import { clearPhoto, countPhotosThisMonth, getPhotoTx } from "@/lib/photo-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getUserPlanRow, SLIP_BUCKET } from "@/lib/slip-repo";
import { getAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_TTL_SECONDS = 60;
/** The page shrinks photos before sending; this stays under the host's request body limit. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

async function ownPhoto(request: Request, params: Promise<{ id: string }>) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการนี้", 404);
  const db = getAdminClient();
  // scoped to the session's user: other users' ids match nothing
  const tx = await getPhotoTx(db, auth.userId, id);
  if (!tx?.photo_path) return apiError("ไม่พบรูปของรายการนี้", 404);
  return { db, userId: auth.userId, tx: { id: tx.id, path: tx.photo_path } };
}

/** GET /api/transactions/:id/photo — a short-lived signed URL for the photo attached to an entry. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const own = await ownPhoto(request, params);
    if (own instanceof Response) return own;
    const signed = await own.db.storage
      .from(SLIP_BUCKET)
      .createSignedUrl(own.tx.path, URL_TTL_SECONDS);
    if (signed.error || !signed.data) throw new Error("sign photo url failed");
    return json({ url: signed.data.signedUrl, expiresIn: URL_TTL_SECONDS });
  });
}

/** DELETE /api/transactions/:id/photo — remove the photo (the file is deleted for good). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const own = await ownPhoto(request, params);
    if (own instanceof Response) return own;
    const removed = await own.db.storage.from(SLIP_BUCKET).remove([own.tx.path]);
    if (removed.error) throw new Error(`remove photo: ${removed.error.message}`);
    await clearPhoto(own.db, own.userId, own.tx.id);
    return json({ ok: true });
  });
}

/** POST /api/transactions/:id/photo — attach (or replace) the photo of an entry; Pro and above. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการนี้", 404);

    const now = new Date();
    const row = await getUserPlanRow(db, auth.userId);
    if (!can(effectivePlan(row.plan, row.plan_expires_at, now), "entryPhoto")) {
      return apiError("การแนบรูปเป็นฟีเจอร์ของแผน Pro ขึ้นไป", 403);
    }

    const tx = await getPhotoTx(db, auth.userId, id);
    if (!tx) return apiError("ไม่พบรายการนี้", 404);
    // replacing the photo of an entry that already has one does not use another of the month's photos
    if (!tx.photo_path && (await countPhotosThisMonth(db, auth.userId, now)) >= PHOTOS_PER_MONTH) {
      return apiError(t("แนบรูปครบ {0} รูปของเดือนนี้แล้ว", PHOTOS_PER_MONTH), 429);
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return apiError("ไม่พบไฟล์รูป", 400);
    if (!ALLOWED.has(file.type)) return apiError("รองรับเฉพาะรูป JPG, PNG หรือ WebP", 400);
    if (file.size > MAX_UPLOAD_BYTES) return apiError("รูปใหญ่เกินไป (ไม่เกิน 4 MB)", 413);

    await attachPhotoBytes(
      db,
      auth.userId,
      tx,
      { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type },
      now,
    );
    return json({ ok: true });
  });
}
