import type { AddonSku } from "@/lib/addons";
import type { PaidPlan, Period } from "@/lib/pricing";

/**
 * Payment seam for paid plans. Stripe is the real provider (see stripe.ts); the stub answers
 * "unavailable" until its keys are set, so callers never need to know which one they talk to.
 *
 *   createCheckout  -> returns the hosted page to send the user to
 *   createPortal    -> Stripe Billing portal (cancel / update card) for card subscribers
 *   handleWebhook   -> verifies the provider's callback, then activates the plan
 *   listPayments    -> history for the settings page
 */
export type PaymentMethod = "card" | "promptpay";

export interface CheckoutRequest {
  userId: string;
  plan: PaidPlan;
  period: Period;
  /** card = auto-renewing subscription; promptpay = one prepaid period (no auto-renew). */
  method: PaymentMethod;
  /** Stripe customer of this user, when they already paid before. */
  customerId?: string | null;
  /**
   * PromptPay only: pay just the difference to raise the tier of prepaid time already running
   * (amount in satang, computed on the server; the end date does not change).
   */
  upgrade?: { amountSatang: number; days: number };
  /** The server reserved an Early Bird seat for this checkout: the first period costs less. */
  earlyBird?: boolean;
}

export interface AddonCheckoutRequest {
  userId: string;
  addon: AddonSku;
  /** card = a monthly add-on renews by itself; promptpay = one month (or the pack) paid once. */
  method: PaymentMethod;
  customerId?: string | null;
}

export type CheckoutResult =
  | { status: "unavailable"; message: string }
  | { status: "redirect"; url: string; reference: string };

export interface ChangeRequest {
  userId: string;
  subscriptionId: string;
  plan: PaidPlan;
  period: Period;
}

export type ChangeResult =
  | { status: "unavailable"; message: string }
  /** The subscription now has the new plan; the difference was charged to the saved card. */
  | { status: "changed" };

export type PortalResult =
  { status: "unavailable"; message: string } | { status: "redirect"; url: string };

export interface PaymentRecord {
  id: string;
  /** Integer satang. */
  amountSatang: number;
  status: "pending" | "paid" | "failed" | "refunded";
  createdAt: string;
  paidAt: string | null;
}

export interface WebhookResult {
  handled: boolean;
  /** Set when the callback activated a plan for a user. */
  userId?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly available: boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** An add-on booster (extra storage, reminders, slips or group slots). */
  createAddonCheckout(request: AddonCheckoutRequest): Promise<CheckoutResult>;
  createPortal(customerId: string): Promise<PortalResult>;
  /** Move a running card subscription to a higher tier / yearly billing (prorated by Stripe). */
  changeSubscription(request: ChangeRequest): Promise<ChangeResult>;
  listPayments(userId: string): Promise<PaymentRecord[]>;
  handleWebhook(rawBody: string, headers: Headers): Promise<WebhookResult>;
}
