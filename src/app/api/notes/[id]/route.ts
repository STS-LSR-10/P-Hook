import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { cleanNoteBody, MAX_NOTE_LENGTH } from "@/lib/note";
import { deleteNote, updateNote } from "@/lib/note-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ body: z.string().max(MAX_NOTE_LENGTH * 2) });

/** PATCH /api/notes/:id { body } — rewrite a note. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบโน้ตนี้", 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    const body = parsed.success ? cleanNoteBody(parsed.data.body) : "";
    if (!body || body.length > MAX_NOTE_LENGTH) {
      return apiError(t("เขียนโน้ตให้ไม่ว่างและไม่เกิน {0} ตัวอักษรนะ", MAX_NOTE_LENGTH), 400);
    }
    return (await updateNote(db, auth.userId, id, body))
      ? json({ ok: true })
      : apiError("ไม่พบโน้ตนี้", 404);
  });
}

/** DELETE /api/notes/:id — remove a note. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบโน้ตนี้", 404);
    const db = getAdminClient();
    return (await deleteNote(db, auth.userId, id))
      ? json({ ok: true })
      : apiError("ไม่พบโน้ตนี้", 404);
  });
}
