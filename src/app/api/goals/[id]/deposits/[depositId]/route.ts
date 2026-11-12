import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { undoDeposit } from "@/lib/goal-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; depositId: string }> };

/** DELETE /api/goals/:id/deposits/:depositId — undo one entry, unless that would drop the total below zero. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    const { id, depositId } = await params;
    if (
      !z.string().uuid().safeParse(id).success ||
      !z.string().uuid().safeParse(depositId).success
    ) {
      return apiError("ไม่พบรายการนี้", 404);
    }
    const result = await undoDeposit(getAdminClient(), auth.userId, id, depositId);
    if (result === "missing") return apiError("ไม่พบรายการนี้", 404);
    if (result === "blocked") {
      return apiError("ลบรายการนี้ไม่ได้ เพราะมีการถอนที่ตามมา ลบการถอนก่อนนะ", 400);
    }
    return json({ ok: true });
  });
}
