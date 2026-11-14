import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { addonForSale } from "@/lib/addons";
import { requireUser } from "@/lib/auth/require-user";
import { getPaymentProvider } from "@/lib/payments";
import { loadBillingState } from "@/lib/payments/billing-state";
import { getPlanInfo } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sku: z.string().min(1).max(40),
  method: z.enum(["card", "promptpay"]).default("card"),
});

/** POST /api/addons/checkout — buys an add-on booster (only people on a paid plan). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse((await readJson(request)) ?? {});
    const addon = parsed.success ? addonForSale(parsed.data.sku) : undefined;
    if (!parsed.success || !addon) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const { plan } = await getPlanInfo(db, auth.userId);
    if (plan === "free") {
      return json(
        {
          available: false,
          message: "แพ็กเกจเสริมสำหรับแผน Starter ขึ้นไป อัปเกรดแผนก่อนนะ",
          upgrade: true,
        },
        409,
      );
    }
    const state = await loadBillingState(db, auth.userId);
    const result = await getPaymentProvider().createAddonCheckout({
      userId: auth.userId,
      addon,
      method: parsed.data.method,
      customerId: state.customerId,
    });
    if (result.status === "unavailable") return json({ available: false, message: result.message });
    return json({ available: true, url: result.url, reference: result.reference });
  });
}
