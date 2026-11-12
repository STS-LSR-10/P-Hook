import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/memory/:id — forget one mapping (always allowed, scoped to the session's user). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการนี้", 404);

    const { data, error } = await getAdminClient()
      .from("merchant_memory")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.userId)
      .select("id");
    if (error) throw new Error(`delete memory: ${error.message}`);
    return (data ?? []).length > 0 ? json({ ok: true }) : apiError("ไม่พบรายการนี้", 404);
  });
}
