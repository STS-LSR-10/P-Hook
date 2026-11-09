import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { loadBillingState } from "@/lib/payments/billing-state";
import { trialBlock } from "@/lib/payments/policy";
import { TRIAL_DAYS } from "@/lib/pricing";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ plan: z.enum(["starter", "plus", "ultimate"]) });

/**
 * POST /api/plan/trial { plan } — start the free trial of a tier (once per person and tier, only
 * while no other plan is running). No card is needed; the plan simply ends after TRIAL_DAYS.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const state = await loadBillingState(db, auth.userId);
    const block = trialBlock(state, parsed.data.plan);
    if (block) return apiError(block, 409);

    // Atomic in SQL: the unique (user, tier) row makes a double tap or a race start only one trial.
    const { data, error } = await db.rpc("start_plan_trial", {
      p_user: auth.userId,
      p_plan: parsed.data.plan,
      p_days: TRIAL_DAYS,
    });
    if (error) throw new Error(`start trial: ${error.message}`);
    if (!data) return apiError("เริ่มทดลองใช้ไม่ได้ในตอนนี้", 409);
    return json({ ok: true, expiresAt: data, days: TRIAL_DAYS });
  });
}
