import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireGroupViewer } from "@/lib/group-api";
import { cleanNoteBody, MAX_NOTE_LENGTH } from "@/lib/note";
import { deleteGroupNote, getGroupNote, updateGroupNote, type GroupNote } from "@/lib/note-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string; id: string }> };

const NOT_FOUND = "ไม่พบโน้ตนี้";
const DENIED = "แก้หรือลบได้เฉพาะคนที่จดโน้ตนี้ หรือเจ้าของสมุดนะ";

/**
 * The group, the note and the person, when that person may change it: who wrote it, the owner of the
 * ledger, or whose limit it is on (the owner before the ledger changed hands). A Response otherwise.
 */
async function noteToChange(
  request: Request,
  params: Params["params"],
): Promise<
  | (Exclude<Awaited<ReturnType<typeof requireGroupViewer>>, Response> & { note: GroupNote })
  | Response
> {
  const { gid, id } = await params;
  const found = await requireGroupViewer(request, gid);
  if (found instanceof Response) return found;
  const { auth, db, viewer } = found;
  if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
  const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
  if (limited) return limited;
  const note = await getGroupNote(db, viewer.group.id, id);
  if (!note) return apiError(NOT_FOUND, 404);
  if (!viewer.isOwner && note.createdBy !== auth.lineUserId && note.userId !== auth.userId) {
    return apiError(DENIED, 403);
  }
  return { ...found, note };
}

const bodySchema = z.object({ body: z.string().max(MAX_NOTE_LENGTH * 2) });

/** PATCH /api/groups/:gid/notes/:id { body } — rewrite a group's note. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const found = await noteToChange(request, params);
    if (found instanceof Response) return found;
    const parsed = bodySchema.safeParse(await readJson(request));
    const body = parsed.success ? cleanNoteBody(parsed.data.body) : "";
    if (!body || body.length > MAX_NOTE_LENGTH) {
      return apiError(t("เขียนโน้ตให้ไม่ว่างและไม่เกิน {0} ตัวอักษรนะ", MAX_NOTE_LENGTH), 400);
    }
    return (await updateGroupNote(found.db, found.viewer.group.id, found.note.id, body))
      ? json({ ok: true })
      : apiError(NOT_FOUND, 404);
  });
}

/** DELETE /api/groups/:gid/notes/:id — remove a group's note. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const found = await noteToChange(request, params);
    if (found instanceof Response) return found;
    return (await deleteGroupNote(found.db, found.viewer.group.id, found.note.id))
      ? json({ ok: true })
      : apiError(NOT_FOUND, 404);
  });
}
