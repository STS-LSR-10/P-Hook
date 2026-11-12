import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { requireFeature } from "@/lib/plan-server";
import { deleteRule, setRuleActive } from "@/lib/recurring-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({ isActive: z.boolean() });

/** PATCH /api/recurring/:id { isActive } — pausing is free, resuming needs Plus. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการประจำนี้", 404);
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const db = getAdminClient();
    if (parsed.data.isActive) {
      const locked = await requireFeature(db, auth.userId, "recurring");
      if (locked) return locked;
    }
    const ok = await setRuleActive(db, auth.userId, id, parsed.data.isActive);
    return ok ? json({ ok: true }) : apiError("ไม่พบรายการประจำนี้", 404);
  });
}

/** DELETE /api/recurring/:id — always allowed. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการประจำนี้", 404);
    const ok = await deleteRule(getAdminClient(), auth.userId, id);
    return ok ? json({ ok: true }) : apiError("ไม่พบรายการประจำนี้", 404);
  });
}
