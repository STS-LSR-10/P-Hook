import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireGroupViewer } from "@/lib/group-api";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { cancelGroupReminder, listGroupReminders } from "@/lib/user-reminder-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string; id: string }> };

const NOT_FOUND = "ไม่พบเตือนนี้";

/** DELETE /api/groups/:gid/reminders/:id — by who set it, or by the owner of the ledger. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid, id } = await params;
    const found = await requireGroupViewer(request, gid);
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const target = (await listGroupReminders(db, viewer.group.id)).find((r) => r.id === id);
    if (!target) return apiError(NOT_FOUND, 404);
    if (!viewer.isOwner && target.createdBy !== auth.lineUserId) {
      return apiError("ยกเลิกได้เฉพาะคนที่ตั้งเตือนนี้ หรือเจ้าของสมุดนะ", 403);
    }
    return (await cancelGroupReminder(db, viewer.group.id, id))
      ? json({ ok: true })
      : apiError(NOT_FOUND, 404);
  });
}
