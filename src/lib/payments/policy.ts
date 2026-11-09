import { effectivePlan, planAtLeast, type Plan } from "@/lib/plan";
import { prepaidUpgradeQuote, type PaidPlan, type Period, type UpgradeQuote } from "@/lib/pricing";
import type { PaymentMethod } from "./provider";
import { t } from "@/lib/i18n";

/** What a person is currently paying with, worked out from their user row and payment history. */
export interface BillingState {
  /** The plan in force right now (expiry applied). */
  plan: Plan;
  customerId: string | null;
  /** A card subscription that renews by itself is running. */
  subscriptionRunning: boolean;
  /** Stripe subscription id while one is running. */
  subscriptionId: string | null;
  /** Billing period of the running subscription (monthly when it was never recorded). */
  period: Period | null;
  /** Prepaid (PromptPay) time is still left and no card subscription is running. */
  prepaidRunning: boolean;
  /** Months of the prepaid purchase that is running (12 = yearly), when `prepaidRunning`. */
  prepaidMonths: number | null;
  /** End of the plan in force (null on Free). */
  expiresAt: Date | null;
  /** Tiers the person has already tried for free. */
  trialsUsed: Plan[];
}

export interface BillingInputs {
  plan: Plan;
  planExpiresAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingPeriod?: Period | null;
  /** The user has at least one paid PromptPay (prepaid) payment. */
  hasPrepaidPayment: boolean;
  /** Months of the latest prepaid purchase (defaults to 1 when unknown). */
  prepaidMonths?: number | null;
  trialsUsed?: Plan[];
}

export function billingState(i: BillingInputs, now: Date = new Date()): BillingState {
  const active =
    Boolean(i.planExpiresAt) && new Date(i.planExpiresAt as string).getTime() > now.getTime();
  const subscriptionRunning = Boolean(i.stripeSubscriptionId) && active;
  const prepaidRunning = active && !subscriptionRunning && i.hasPrepaidPayment;
  return {
    plan: effectivePlan(i.plan, i.planExpiresAt, now),
    customerId: i.stripeCustomerId,
    subscriptionRunning,
    subscriptionId: subscriptionRunning ? i.stripeSubscriptionId : null,
    period: subscriptionRunning ? (i.billingPeriod ?? "monthly") : null,
    prepaidRunning,
    prepaidMonths: prepaidRunning ? (i.prepaidMonths ?? 1) : null,
    expiresAt: active ? new Date(i.planExpiresAt as string) : null,
    trialsUsed: i.trialsUsed ?? [],
  };
}

export interface PlanRequest {
  plan: PaidPlan;
  period: Period;
  method: PaymentMethod;
}

export type PlanAction =
  | { kind: "checkout" }
  /** Change the running card subscription; Stripe charges only the difference. */
  | { kind: "change" }
  | { kind: "blocked"; message: string; manage?: boolean };

const blocked = (message: string, manage = false): PlanAction => ({
  kind: "blocked",
  message,
  ...(manage ? { manage: true } : {}),
});

/**
 * What a purchase request means for this person. One billing method at a time, never a cheaper
 * tier than the one in force:
 *  - with a running card subscription, a higher tier (or monthly → yearly on the same tier) is a
 *    *change* of that subscription (Stripe charges only the difference for the time left); anything
 *    else is refused, and paying twice with PromptPay is refused so time is never paid for twice;
 *  - prepaid (PromptPay) time can be topped up or upgraded with PromptPay but not mixed with a
 *    card subscription (its renewal would overwrite the tier bought with the prepaid payment);
 *  - buying a lower tier than the current one would take away features already paid for.
 */
export function planAction(state: BillingState, request: PlanRequest): PlanAction {
  if (!planAtLeast(request.plan, state.plan)) {
    return blocked(t("คุณใช้แผนที่สูงกว่านี้อยู่แล้ว"));
  }

  if (state.subscriptionRunning) {
    if (request.method !== "card") {
      return blocked(
        t(
          "คุณมีแผนแบบต่ออายุอัตโนมัติด้วยบัตรอยู่ การจ่ายเพิ่มด้วยพร้อมเพย์จะทำให้จ่ายซ้ำ เลือกอัปเกรดด้วยบัตรแทน หรือจัดการที่ปุ่ม “จัดการการชำระเงิน”",
        ),
        true,
      );
    }
    const higherTier = request.plan !== state.plan && planAtLeast(request.plan, state.plan);
    const toYearly =
      request.plan === state.plan && state.period === "monthly" && request.period === "yearly";
    if (higherTier || toYearly) return { kind: "change" };
    if (request.plan === state.plan && request.period === state.period) {
      return blocked(t("คุณใช้แผนนี้อยู่แล้ว (ต่ออายุอัตโนมัติ)"), true);
    }
    return blocked(
      t(
        "เปลี่ยนจากรายปีเป็นรายเดือนไม่ได้ระหว่างรอบ ยกเลิกต่ออายุที่ปุ่ม “จัดการการชำระเงิน” แล้วสมัครใหม่เมื่อครบรอบ",
      ),
      true,
    );
  }

  if (state.prepaidRunning && request.method === "card") {
    return blocked(
      t(
        "คุณมีแผนแบบพร้อมเพย์ที่ยังไม่หมดอายุ ต่ออายุด้วยพร้อมเพย์ได้เลย หรือรอให้หมดอายุก่อนจึงสมัครแบบบัตร",
      ),
    );
  }
  return { kind: "checkout" };
}

/** Why a free trial of `plan` cannot start now, or null when it can. */
export function trialBlock(state: BillingState, _plan: PaidPlan): string | null {
  if (state.plan !== "free") {
    return "ทดลองใช้ฟรีได้เฉพาะตอนที่ยังไม่มีแผนที่ใช้งานอยู่";
  }
  // one trial per account, whichever tier it was
  if (state.trialsUsed.length > 0) {
    return "คุณเคยทดลองใช้ฟรีแล้ว (ทดลองได้ครั้งเดียวต่อบัญชี)";
  }
  return null;
}

/** The quote for upgrading running prepaid time to `to`, or null when that is not possible. */
export function prepaidUpgradeFor(
  state: BillingState,
  to: PaidPlan,
  now: Date = new Date(),
): UpgradeQuote | null {
  if (!state.prepaidRunning || !state.expiresAt || state.prepaidMonths === null) return null;
  if (state.plan === "free") return null;
  return prepaidUpgradeQuote({
    from: state.plan,
    to,
    months: state.prepaidMonths,
    expiresAt: state.expiresAt,
    now,
  });
}
