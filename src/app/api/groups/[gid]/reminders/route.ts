import { guard, json } from "@/lib/api";
import { requireGroupViewer } from "@/lib/group-api";
import { listGroupReminders } from "@/lib/user-reminder-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

/** GET /api/groups/:gid/reminders — the group's reminders waiting; `mine` marks those this person may cancel. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupViewer(request, gid);
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    const items = await listGroupReminders(db, viewer.group.id);
    return json({
      items: items.map(({ createdBy, ...r }) => ({
        ...r,
        mine: viewer.isOwner || createdBy === auth.lineUserId,
      })),
      isOwner: viewer.isOwner,
    });
  });
}
