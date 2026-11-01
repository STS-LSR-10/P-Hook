import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { cleanFileName, MAX_NAME_LENGTH, withExtensionOf } from "@/lib/file";
import { dropFileRow, getReadyFile, renameFile } from "@/lib/file-repo";
import { getFileStore } from "@/lib/file-store";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = "ไม่พบไฟล์นี้";
const bodySchema = z.object({ name: z.string().max(MAX_NAME_LENGTH * 2) });

/** PATCH /api/files/:id { name } — rename a file. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    const name = parsed.success ? cleanFileName(parsed.data.name) : "";
    if (!name) return apiError("ตั้งชื่อไฟล์ให้ไม่ว่างนะ", 400);

    const file = await getReadyFile(db, auth.userId, id);
    if (!file) return apiError(NOT_FOUND, 404);
    return (await renameFile(db, auth.userId, id, withExtensionOf(name, file.name)))
      ? json({ ok: true })
      : apiError(NOT_FOUND, 404);
  });
}

/** DELETE /api/files/:id — the object goes first, so a failure never leaves one nobody can reach. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const file = await getReadyFile(db, auth.userId, id);
    if (!file) return apiError(NOT_FOUND, 404);
    const store = await getFileStore();
    if (!store) return apiError("ตอนนี้ระบบเก็บไฟล์ยังไม่พร้อม", 503);
    await store.delete([file.r2Key]);
    await dropFileRow(db, auth.userId, id);
    return json({ ok: true });
  });
}
