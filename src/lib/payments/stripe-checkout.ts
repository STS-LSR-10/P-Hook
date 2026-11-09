import { PERIOD_MONTHS, priceFor, type PaidPlan } from "@/lib/pricing";
import { PLAN_LABEL } from "@/lib/plan";
import type { CheckoutRequest } from "./provider";

/** Where Stripe sends the person after paying / cancelling (a public page, no LINE login needed). */
export function resultUrls(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    success: `${base}/pay/result?status=success`,
    cancel: `${base}/pay/result?status=cancel`,
    portalReturn: `${base}/pay/result?status=portal`,
  };
}

/**
 * Form fields for POST /v1/checkout/sessions (Stripe's API is form-encoded with bracket keys).
 *
 *  - card      -> mode=subscription (Stripe Billing): renews by itself every month / year
 *  - promptpay -> mode=payment: one prepaid period; PromptPay cannot be charged repeatedly
 *
 * Which payment methods appear is decided in the Stripe Dashboard (Settings -> Payment methods):
 * recent API versions no longer accept `payment_method_types` on Checkout Sessions. Stripe shows
 * only the enabled methods that fit the mode (PromptPay is offered for one-time payments, never
 * for subscriptions).
 *
 * The price is built inline (`price_data`) from src/lib/pricing.ts, so there is nothing to create
 * in the Stripe dashboard. Our own user id travels in metadata and comes back in the webhook.
 */
export function buildCheckoutFields(
  req: CheckoutRequest,
  baseUrl: string,
  now: Date = new Date(),
): Record<string, string> {
  const urls = resultUrls(baseUrl);
  const subscription = req.method === "card";
  const upgrade = !subscription && req.upgrade ? req.upgrade : null;
  const meta: Record<string, string> = {
    user_id: req.userId,
    plan: req.plan,
    period: req.period,
    method: req.method,
    ...(upgrade ? { kind: "upgrade" } : {}),
  };

  const f: Record<string, string> = {
    mode: subscription ? "subscription" : "payment",
    success_url: urls.success,
    cancel_url: urls.cancel,
    locale: "th",
    client_reference_id: req.userId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "thb",
    "line_items[0][price_data][unit_amount]": String(
      upgrade ? upgrade.amountSatang : priceFor(req.plan, now)[req.period] * 100,
    ),
    "line_items[0][price_data][product_data][name]": upgrade
      ? `พี่ฮูก อัปเกรดเป็น ${PLAN_LABEL[req.plan]} (ส่วนต่าง ${upgrade.days} วัน)`
      : productName(req.plan, req.period),
  };
  for (const [k, v] of Object.entries(meta)) f[`metadata[${k}]`] = v;

  if (subscription) {
    f["line_items[0][price_data][recurring][interval]"] =
      req.period === "yearly" ? "year" : "month";
    for (const [k, v] of Object.entries(meta)) f[`subscription_data[metadata][${k}]`] = v;
  } else {
    if (!req.customerId) f.customer_creation = "always";
  }
  if (req.customerId) f.customer = req.customerId;
  return f;
}

export function productName(plan: PaidPlan, period: "monthly" | "yearly"): string {
  return `พี่ฮูก ${PLAN_LABEL[plan]} (${period === "yearly" ? "รายปี" : "รายเดือน"})`;
}

/**
 * Form fields for POST /v1/subscriptions/{id}: swap the subscription item for the new plan.
 * `always_invoice` makes Stripe settle the difference at once: it credits the unused time of the
 * old price and charges the new one (a yearly switch starts a new yearly period today). If the
 * card fails, `error_if_incomplete` leaves the subscription exactly as it was.
 */
export function buildChangeFields(input: {
  userId: string;
  itemId: string;
  productId: string;
  plan: PaidPlan;
  period: "monthly" | "yearly";
  now?: Date;
}): Record<string, string> {
  const meta = { user_id: input.userId, plan: input.plan, period: input.period, method: "card" };
  const f: Record<string, string> = {
    "items[0][id]": input.itemId,
    "items[0][price_data][currency]": "thb",
    "items[0][price_data][product]": input.productId,
    "items[0][price_data][unit_amount]": String(
      priceFor(input.plan, input.now ?? new Date())[input.period] * 100,
    ),
    "items[0][price_data][recurring][interval]": input.period === "yearly" ? "year" : "month",
    proration_behavior: "always_invoice",
    payment_behavior: "error_if_incomplete",
    cancel_at_period_end: "false",
  };
  for (const [k, v] of Object.entries(meta)) f[`metadata[${k}]`] = v;
  return f;
}

export function periodMonths(period: "monthly" | "yearly"): number {
  return PERIOD_MONTHS[period];
}
