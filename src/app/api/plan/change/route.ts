import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { getPaymentProvider } from "@/lib/payments";
import { loadBillingState } from "@/lib/payments/billing-state";
import { planAction } from "@/lib/payments/policy";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: z.enum(["starter", "plus", "ultimate"]),
  period: z.enum(["monthly", "yearly"]),
});

/**
 * POST /api/plan/change — move a running card subscription to a higher tier or to yearly billing.
 * Stripe settles only the difference for the time left, on the card already saved.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const state = await loadBillingState(db, auth.userId);
    const action = planAction(state, { ...parsed.data, method: "card" });
    if (action.kind !== "change" || !state.subscriptionId) {
      const message = action.kind === "blocked" ? action.message : "เปลี่ยนแผนนี้ไม่ได้ในตอนนี้";
      return json(
        { available: false, message, manage: action.kind === "blocked" && action.manage === true },
        409,
      );
    }

    const result = await getPaymentProvider().changeSubscription({
      userId: auth.userId,
      subscriptionId: state.subscriptionId,
      ...parsed.data,
    });
    if (result.status === "unavailable") return json({ available: false, message: result.message });
    return json({ available: true, changed: true });
  });
}
