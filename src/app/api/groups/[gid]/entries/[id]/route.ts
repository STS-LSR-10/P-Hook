import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireGroupOwner } from "@/lib/group-api";
import { deleteEntry, updateEntry } from "@/lib/group-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string; id: string }> };

const NOT_FOUND = "ไม่พบรายการนี้";
const Body = z
  .object({
    title: z.string().trim().min(1).max(60).optional(),
    amountSatang: z.number().int().positive().max(100_000_000_00).optional(),
  })
  .refine((b) => b.title !== undefined || b.amountSatang !== undefined);

/** PATCH /api/groups/:gid/entries/:id — the owner fixes an entry's title or amount. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid, id } = await params;
    const found = await requireGroupOwner(request, gid, { writable: true });
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const body = Body.safeParse(await readJson(request));
    if (!body.success) return apiError("ข้อมูลไม่ถูกต้อง ลองตรวจชื่อและจำนวนเงินอีกครั้งนะ", 400);
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    if (!(await updateEntry(db, viewer.group.id, id, body.data))) return apiError(NOT_FOUND, 404);
    return json({ ok: true });
  });
}

/** DELETE /api/groups/:gid/entries/:id — the owner removes an entry. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid, id } = await params;
    const found = await requireGroupOwner(request, gid, { writable: true });
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    if (!(await deleteEntry(db, viewer.group.id, id))) return apiError(NOT_FOUND, 404);
    return json({ ok: true });
  });
}
