import { guard, json } from "@/lib/api";
import { ADDONS } from "@/lib/addons";
import { loadBonus } from "@/lib/addons-repo";
import { requireUser } from "@/lib/auth/require-user";
import { getPaymentProvider } from "@/lib/payments";
import { getPlanInfo } from "@/lib/plan-server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/addons — the add-on boosters, what the person has now, and whether they can buy. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const now = new Date();
    const [{ plan }, bonus, active] = await Promise.all([
      getPlanInfo(db, auth.userId),
      loadBonus(db, auth.userId, now),
      db
        .from("addons")
        .select("sku,expires_at")
        .eq("user_id", auth.userId)
        .not("expires_at", "is", null)
        .gt("expires_at", now.toISOString())
        .order("expires_at", { ascending: true })
        .limit(50),
    ]);
    return json({
      plan,
      // add-ons are for people on a paid plan
      canBuy: plan !== "free",
      paymentsAvailable: getPaymentProvider().available,
      catalog: ADDONS,
      bonus,
      // the monthly ones that are running, with when each runs out
      active: ((active.data ?? []) as { sku: string; expires_at: string }[]).map((r) => ({
        sku: r.sku,
        expiresAt: r.expires_at,
      })),
    });
  });
}
