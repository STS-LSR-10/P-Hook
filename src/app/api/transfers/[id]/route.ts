import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { deleteTransfer } from "@/lib/transfer-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/transfers/:id — cancel a transfer (both wallets go back to what they were). */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบการโอนนี้", 404);
    const removed = await deleteTransfer(getAdminClient(), auth.userId, id);
    return removed ? json({ ok: true }) : apiError("ไม่พบการโอนนี้", 404);
  });
}
