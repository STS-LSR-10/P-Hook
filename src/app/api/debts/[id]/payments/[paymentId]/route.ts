import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { deletePayments } from "@/lib/debt-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; paymentId: string }> };

/** DELETE /api/debts/:id/payments/:paymentId — cancel one payment (the debt owes that much again). */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    const { paymentId } = await params;
    if (!z.string().uuid().safeParse(paymentId).success) return apiError("ไม่พบรายการชำระ", 404);
    const removed = await deletePayments(getAdminClient(), auth.userId, [paymentId]);
    return removed > 0 ? json({ ok: true }) : apiError("ไม่พบรายการชำระ", 404);
  });
}
