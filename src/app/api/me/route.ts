import type { SupabaseClient } from "@supabase/supabase-js";
import { guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import {
  can,
  effectivePlan,
  recurringLimit,
  SLIP_LIMIT,
  trialLimit,
  slipsRemaining,
  walletCapacity,
  type Feature,
} from "@/lib/plan";
import { getPaymentProvider } from "@/lib/payments";
import { loadBillingState } from "@/lib/payments/billing-state";
import { trialBlock } from "@/lib/payments/policy";
import { EARLY_BIRD, earlyBirdOpen, pricingAt, TRIAL_DAYS } from "@/lib/pricing";
import { earlyBirdOffers, hasPaidEarlyBird } from "@/lib/early-bird-repo";
import { memberCodeOf } from "@/lib/member";
import { currentStreak, recentDailyKeys } from "@/lib/points";
import { countSlipsThisMonth, trialStartOf } from "@/lib/slip-repo";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURES: Feature[] = [
  "savingsChart",
  "recurring",
  "multiAccount",
  "merchantMemory",
  "dailyReminder",
  "advancedExport",
  "autoSummary",
  "voiceLog",
  "backdate",
  "multiEntry",
  "tags",
  "entryPhoto",
  "smartParse",
  "customRange",
  "searchTotals",
  "yearSummary",
  "categoryCompare",
  "export",
  "pdfExport",
  "dashboard",
  "forecast",
  "insight",
  "customCategory",
  "transfer",
  "creditCard",
  "debts",
  "foreignCurrency",
  "categoryBudget",
  "budgetAlert",
  "dailyBudget",
  "savingsGoal",
  "billReminder",
  "groupLedger",
  "sharedWallet",
  "personalize",
];

/** Friends this person invited who have recorded their first entry (the bonus was paid for them). */
async function countReferrals(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("point_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("reason", "referral");
  if (error) throw new Error(`count referrals: ${error.message}`);
  return count ?? 0;
}

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const { data, error } = await db
      .from("users")
      .select(
        "display_name,picture_url,plan,plan_expires_at,points,referral_code,referred_by,member_code,created_at",
      )
      .eq("id", auth.userId)
      .single();
    if (error) throw new Error(`load me: ${error.message}`);

    const now = new Date();
    const plan = effectivePlan(data.plan, data.plan_expires_at, now);
    const billing = await loadBillingState(db, auth.userId, now);
    const [slipsTrial, dailyKeys, payments, referrals] = await Promise.all([
      trialStartOf(db, auth.userId, plan, data.plan_expires_at, now).then(async (start) => ({
        start,
        used: await countSlipsThisMonth(db, auth.userId, now, start),
      })),
      recentDailyKeys(db, auth.userId),
      getPaymentProvider().listPayments(auth.userId),
      countReferrals(db, auth.userId),
    ]);

    const slipsUsed = slipsTrial.used;
    const trial = slipsTrial.start !== null;

    return json({
      displayName: data.display_name,
      pictureUrl: data.picture_url,
      // the plan in force now (an expired paid plan reads as "free")
      plan,
      planExpiresAt: data.plan_expires_at,
      features: Object.fromEntries(FEATURES.map((f) => [f, can(plan, f)])),
      slips: {
        used: slipsUsed,
        limit: trial ? trialLimit(SLIP_LIMIT[plan]) : SLIP_LIMIT[plan],
        remaining: slipsRemaining(plan, slipsUsed, trial),
      },
      points: data.points,
      streak: currentStreak(dailyKeys, now),
      referralCode: data.referral_code,
      memberCode: memberCodeOf(plan, data.member_code),
      joinedAt: data.created_at,
      referred: Boolean(data.referred_by),
      referrals,
      limits: { recurringRules: recurringLimit(plan), wallets: walletCapacity(plan) },
      pricing: pricingAt(now),
      // Early Bird seats left, per plan and period (none once this person has used theirs)
      earlyBird:
        !earlyBirdOpen(now) || (await hasPaidEarlyBird(db, auth.userId))
          ? []
          : (await earlyBirdOffers(db)).map((o) => ({
              plan: o.plan,
              period: o.period,
              remaining: o.remaining,
              price: EARLY_BIRD[o.plan][o.period],
            })),
      // free trials still available (once per account, and only while no plan is running)
      trial: {
        days: TRIAL_DAYS,
        available: {
          starter: trialBlock(billing, "starter") === null,
          plus: trialBlock(billing, "plus") === null,
          ultimate: trialBlock(billing, "ultimate") === null,
        },
      },
      payments: {
        available: getPaymentProvider().available,
        history: payments,
        // paid by card before: the billing portal can be opened
        canManage: Boolean(billing.customerId),
        autoRenew: billing.subscriptionRunning,
        // billing period of the running card subscription (monthly | yearly)
        period: billing.period,
        // months of the running prepaid purchase (for the "pay the difference" upgrade quote)
        prepaidMonths: billing.prepaidMonths,
        // prepaid (PromptPay) time left: can be topped up, not mixed with a card subscription
        prepaidRunning: billing.prepaidRunning,
      },
    });
  });
}
