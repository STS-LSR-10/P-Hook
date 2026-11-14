import { z } from "zod";
import { earlyBirdOpen } from "@/lib/pricing";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { getPaymentProvider } from "@/lib/payments";
import { loadBillingState } from "@/lib/payments/billing-state";
import { claimEarlyBird, releaseEarlyBird } from "@/lib/early-bird-repo";
import { planAction, prepaidUpgradeFor } from "@/lib/payments/policy";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: z.enum(["starter", "plus", "ultimate"]).default("plus"),
  period: z.enum(["monthly", "yearly"]).default("monthly"),
  /** card = auto-renewing subscription, promptpay = one prepaid period */
  method: z.enum(["card", "promptpay"]).default("card"),
  /** PromptPay only: pay just the difference to raise the tier of prepaid time that is running. */
  upgrade: z.boolean().default(false),
});

/** POST /api/plan/checkout — starts an upgrade. Answers { available:false } until Stripe is set up. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse((await readJson(request)) ?? {});
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const state = await loadBillingState(db, auth.userId);
    const { upgrade: wantsUpgrade, ...choice } = parsed.data;
    const action = planAction(state, choice);
    if (action.kind === "blocked") {
      return json(
        { available: false, message: action.message, manage: action.manage === true },
        409,
      );
    }
    if (action.kind === "change") {
      // A running card subscription is changed (difference only), never paid for a second time.
      return json(
        { available: false, message: "ใช้ปุ่มอัปเกรดแผนเพื่อเปลี่ยนแผนที่สมัครไว้", change: true },
        409,
      );
    }
    // Raising the tier of prepaid time: the server works out the price, never the client.
    let upgrade: { amountSatang: number; days: number } | undefined;
    let period = choice.period;
    if (wantsUpgrade) {
      const quote = choice.method === "promptpay" ? prepaidUpgradeFor(state, choice.plan) : null;
      if (!quote) {
        return json(
          { available: false, message: "อัปเกรดส่วนต่างได้เฉพาะแผนพร้อมเพย์ที่ยังไม่หมดอายุ" },
          409,
        );
      }
      upgrade = { amountSatang: quote.amountBaht * 100, days: quote.days };
      period = (state.prepaidMonths ?? 1) >= 12 ? "yearly" : "monthly";
    }
    // Early Bird: a seat is reserved for this checkout when there is one (a card subscription gets the
    // first month or year cheaper; PromptPay is one prepaid period, so only the yearly one qualifies)
    let earlyBird = false;
    if (
      !upgrade &&
      earlyBirdOpen(new Date()) &&
      (period === "yearly" || choice.method === "card")
    ) {
      await releaseEarlyBird(db).catch(() => undefined);
      earlyBird = await claimEarlyBird(db, auth.userId, choice.plan, period);
    }
    const result = await getPaymentProvider().createCheckout({
      userId: auth.userId,
      ...choice,
      period,
      customerId: state.customerId,
      ...(upgrade ? { upgrade } : {}),
      ...(earlyBird ? { earlyBird } : {}),
    });
    if (result.status === "unavailable") return json({ available: false, message: result.message });
    return json({
      available: true,
      url: result.url,
      reference: result.reference,
      earlyBird,
    });
  });
}
