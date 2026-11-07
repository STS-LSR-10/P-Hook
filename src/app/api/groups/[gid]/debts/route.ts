import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireGroupOwner } from "@/lib/group-api";
import { clearDebts } from "@/lib/group-manage";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), billId: z.string().uuid(), userId: z.string().min(1) }),
  z.object({ kind: z.literal("bill"), billId: z.string().uuid() }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("all") }),
]);

/**
 * POST /api/groups/:gid/debts — the owner clears debts: one person on one bill ("member"), a whole
 * bill ("bill", cancelled), everything one person owes ("user") or everything owed to the group ("all").
 * -> { cleared } how many shares (or bills) it changed.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupOwner(request, gid, { writable: true });
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    const body = Body.safeParse(await request.json().catch(() => null));
    if (!body.success) return apiError("ข้อมูลไม่ถูกต้อง ลองใหม่อีกครั้งนะ", 400);
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    return json({ cleared: await clearDebts(db, viewer.group.id, body.data) });
  });
}
