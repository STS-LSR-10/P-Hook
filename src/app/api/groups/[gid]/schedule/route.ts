import { apiError, guard, json, readJson } from "@/lib/api";
import { parseChase } from "@/lib/chase-schedule";
import { requireGroupOwner } from "@/lib/group-api";
import { setChaseSchedule } from "@/lib/group-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

/** PUT /api/groups/:gid/schedule { everyDays, window } — how often and when unpaid bills are chased. */
export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupOwner(request, gid, { writable: true });
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    const schedule = parseChase(await readJson(request));
    if (!schedule) return apiError("ตั้งเวลาทวงไม่ถูกต้อง ลองเลือกใหม่นะ", 400);
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    await setChaseSchedule(db, viewer.group.id, schedule);
    return json(schedule);
  });
}
