import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { thumbKey } from "@/lib/file";
import { dropFileRow, getGroupFile } from "@/lib/file-repo";
import { getFileStore } from "@/lib/file-store";
import { requireGroupViewer } from "@/lib/group-api";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string; id: string }> };

const NOT_FOUND = "ไม่พบไฟล์นี้";

/** DELETE /api/groups/:gid/files/:id — by who kept it, the owner of the ledger, or whose space it takes. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid, id } = await params;
    const found = await requireGroupViewer(request, gid);
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const file = await getGroupFile(db, viewer.group.id, id);
    if (!file) return apiError(NOT_FOUND, 404);
    // whose space it takes may free it too (the owner before the ledger changed hands)
    if (!viewer.isOwner && file.savedBy !== auth.lineUserId && file.userId !== auth.userId) {
      return apiError("ลบได้เฉพาะคนที่เก็บไฟล์นี้ หรือเจ้าของสมุดนะ", 403);
    }
    const store = await getFileStore();
    if (!store) return apiError("ตอนนี้ระบบเก็บไฟล์ยังไม่พร้อม", 503);
    await store.delete([file.r2Key, thumbKey(file.r2Key)]);
    await dropFileRow(db, file.userId, id);
    return json({ ok: true });
  });
}
