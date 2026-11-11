import type { SupabaseClient } from "@supabase/supabase-js";
import { PERIOD_MONTHS, type Period } from "@/lib/pricing";
import type { PaidPlan } from "@/lib/pricing";
import { addonBySku } from "@/lib/addons";
import { PAID_REFERRAL_COINS, PAID_REFERRAL_DAYS, PAID_REFERRAL_MONTHLY_CAP } from "@/lib/config";
import { log } from "@/lib/log";

/** The slice of a Stripe event we read. Everything else is ignored. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type PaymentAction =
  | {
      kind: "prepaid";
      userId: string;
      plan: PaidPlan;
      months: number;
      ref: string;
      amountSatang: number;
      method: string;
      customer: string | null;
      earlyBird?: boolean;
    }
  | {
      /** PromptPay: pay the difference to raise the tier of prepaid time that is already running. */
      kind: "prepaidUpgrade";
      userId: string;
      plan: PaidPlan;
      ref: string;
      amountSatang: number;
      method: string;
    }
  | {
      kind: "subscription";
      userId: string;
      plan: PaidPlan;
      until: Date;
      period: Period;
      customer: string | null;
      subscription: string;
      earlyBird?: boolean;
    }
  | {
      kind: "invoice";
      /** From the subscription metadata when present, else looked up by Stripe customer. */
      userId: string | null;
      plan: PaidPlan | null;
      months: number;
      ref: string;
      amountSatang: number;
      customer: string | null;
    }
  | {
      /** An add-on booster was paid (the first charge and every renewal of a monthly one). */
      kind: "addon";
      userId: string;
      sku: string;
      ref: string;
      /** When it stops (a monthly one), or null for a pack that is kept. */
      expiresAt: Date | null;
      /** Stripe's customer, saved so a monthly add-on can be cancelled in the billing portal. */
      customer: string | null;
    }
  | { kind: "ignore" };

const IGNORE: PaymentAction = { kind: "ignore" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
/** `customer` is an id string, or an expanded object. */
const idOf = (v: unknown): string | null => str(v) ?? str(obj(v)?.id);

function readMeta(metadata: unknown): { userId: string; plan: PaidPlan; period: Period } | null {
  const m = obj(metadata);
  const userId = str(m?.user_id);
  const plan = m?.plan;
  const period = m?.period;
  if (!userId || !UUID_RE.test(userId)) return null;
  if (plan !== "starter" && plan !== "plus" && plan !== "ultimate") return null;
  if (period !== "monthly" && period !== "yearly") return null;
  return { userId, plan, period };
}

/** The add-on a payment is for: our user and a known add-on, or null. */
function readAddonMeta(metadata: unknown): { userId: string; sku: string } | null {
  const m = obj(metadata);
  const userId = str(m?.user_id);
  const sku = str(m?.addon);
  if (!userId || !UUID_RE.test(userId) || !sku || !addonBySku(sku)) return null;
  return { userId, sku };
}

const DAY = 86_400_000;
/** A monthly add-on keeps working this long after its paid period, while Stripe collects the renewal. */
const RENEWAL_GRACE = 3 * DAY;

/** Turn a verified Stripe event into what we should do about it (no I/O). */
export function interpretEvent(event: StripeEvent): PaymentAction {
  const o = event.data?.object;
  if (!o) return IGNORE;

  switch (event.type) {
    // PromptPay (one prepaid period). Subscriptions are activated by the subscription events below.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (o.mode !== "payment" || o.payment_status !== "paid") return IGNORE;
      const addon = readAddonMeta(o.metadata);
      const sessionId = str(o.id);
      if (addon && sessionId) {
        const sku = addonBySku(addon.sku);
        // shortcut: one month is 31 days from the payment, close enough for a booster
        const created = (num(o.created) ?? Date.now() / 1000) * 1000;
        return {
          kind: "addon",
          userId: addon.userId,
          sku: addon.sku,
          ref: sessionId,
          expiresAt: sku?.monthly ? new Date(created + 31 * DAY + RENEWAL_GRACE) : null,
          customer: idOf(o.customer),
        };
      }
      const meta = readMeta(o.metadata);
      const ref = str(o.id);
      const amount = num(o.amount_total);
      if (!meta || !ref || amount === null || o.currency !== "thb") return IGNORE;
      if (obj(o.metadata)?.kind === "upgrade") {
        return {
          kind: "prepaidUpgrade",
          userId: meta.userId,
          plan: meta.plan,
          ref,
          amountSatang: amount,
          method: str(obj(o.metadata)?.method) ?? "promptpay",
        };
      }
      return {
        kind: "prepaid",
        userId: meta.userId,
        plan: meta.plan,
        months: PERIOD_MONTHS[meta.period],
        ref,
        amountSatang: amount,
        method: str(obj(o.metadata)?.method) ?? "promptpay",
        customer: idOf(o.customer),
        ...(obj(o.metadata)?.early_bird === "1" ? { earlyBird: true } : {}),
      };
    }

    // Card subscription: active until the end of the current billing period.
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      if (o.status !== "active" && o.status !== "trialing") return IGNORE;
      const meta = readMeta(o.metadata);
      const id = str(o.id);
      // newer API versions moved the period onto the subscription item
      const item = obj((obj(o.items)?.data as unknown[] | undefined)?.[0]);
      const end = num(o.current_period_end) ?? num(item?.current_period_end);
      if (!meta || !id || end === null) return IGNORE;
      return {
        kind: "subscription",
        userId: meta.userId,
        plan: meta.plan,
        until: new Date(end * 1000),
        period: meta.period,
        customer: idOf(o.customer),
        subscription: id,
        ...(obj(o.metadata)?.early_bird === "1" ? { earlyBird: true } : {}),
      };
    }

    // History row for each paid subscription invoice (first charge and every renewal).
    case "invoice.paid": {
      const ref = str(o.id);
      const amount = num(o.amount_paid);
      if (!ref || amount === null || o.currency !== "thb") return IGNORE;
      const details =
        obj(o.subscription_details) ?? obj(obj(o.parent)?.subscription_details) ?? null;
      const line = obj((obj(o.lines)?.data as unknown[] | undefined)?.[0]);
      const period = obj(line?.period);
      const start = num(period?.start);
      const end = num(period?.end);
      // a monthly add-on's invoice grants it for the period it paid, and is not a plan payment
      const addon = readAddonMeta(details?.metadata);
      if (addon) {
        return {
          kind: "addon",
          userId: addon.userId,
          sku: addon.sku,
          ref,
          expiresAt: new Date((end !== null ? end * 1000 : Date.now() + 31 * DAY) + RENEWAL_GRACE),
          customer: idOf(o.customer),
        };
      }
      const meta = readMeta(details?.metadata);
      const days = start !== null && end !== null ? (end - start) / 86_400 : 30;
      return {
        kind: "invoice",
        userId: meta?.userId ?? null,
        plan: meta?.plan ?? null,
        months: days >= 300 ? 12 : 1,
        ref,
        amountSatang: amount,
        customer: idOf(o.customer),
      };
    }

    default:
      return IGNORE;
  }
}

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/**
 * A referred friend's first real payment rewards them and the person who invited them (once, in SQL).
 * Best effort: a failure here must not fail the webhook, since the payment itself is already recorded.
 */
async function rewardPaidReferral(db: SupabaseClient, userId: string, ref: string): Promise<void> {
  // twice: a deadlock with a simultaneous first-entry bonus aborts one side, and Stripe is not asked to resend
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await rpc(db, "grant_paid_referral", {
        p_user: userId,
        p_ref: ref,
        p_referrer_coins: PAID_REFERRAL_COINS,
        p_days: PAID_REFERRAL_DAYS,
        p_monthly_cap: PAID_REFERRAL_MONTHLY_CAP,
      });
      return;
    } catch (error) {
      if (attempt === 2) log.error("paid_referral_failed", error);
    }
  }
}

/** Carry out an action. Every step is idempotent, so Stripe retrying a webhook is harmless. */
export async function applyAction(
  db: SupabaseClient,
  action: PaymentAction,
): Promise<{ handled: boolean; userId?: string }> {
  switch (action.kind) {
    case "prepaid": {
      await rpc(db, "apply_prepaid_purchase", {
        p_user: action.userId,
        p_plan: action.plan,
        p_months: action.months,
        p_ref: action.ref,
        p_amount: action.amountSatang,
        p_method: action.method,
      });
      await rewardPaidReferral(db, action.userId, action.ref);
      if (action.customer) {
        // remember the customer for the billing portal and returning payers (best effort)
        await db
          .from("users")
          .update({ stripe_customer_id: action.customer })
          .eq("id", action.userId)
          .is("stripe_customer_id", null);
      }
      if (action.earlyBird) {
        await rpc(db, "confirm_early_bird", {
          p_user: action.userId,
          p_plan: action.plan,
          p_period: action.months >= 12 ? "yearly" : "monthly",
        });
      }
      return { handled: true, userId: action.userId };
    }

    case "prepaidUpgrade": {
      const applied = await rpc(db, "apply_prepaid_upgrade", {
        p_user: action.userId,
        p_plan: action.plan,
        p_ref: action.ref,
        p_amount: action.amountSatang,
        p_method: action.method,
      });
      // false: already applied before, or the prepaid time ended while the person was paying
      if (applied === true) await rewardPaidReferral(db, action.userId, action.ref);
      return applied === true ? { handled: true, userId: action.userId } : { handled: false };
    }

    case "subscription": {
      await rpc(db, "set_plan_until", {
        p_user: action.userId,
        p_plan: action.plan,
        p_until: action.until.toISOString(),
        p_customer: action.customer,
        p_subscription: action.subscription,
        p_period: action.period,
      });
      if (action.earlyBird) {
        await rpc(db, "confirm_early_bird", {
          p_user: action.userId,
          p_plan: action.plan,
          p_period: action.period,
        });
      }
      return { handled: true, userId: action.userId };
    }

    case "invoice": {
      let userId = action.userId;
      let plan = action.plan;
      if ((!userId || !plan) && action.customer) {
        const { data, error } = await db
          .from("users")
          .select("id,plan")
          .eq("stripe_customer_id", action.customer)
          .maybeSingle();
        if (error) throw new Error(`find payer: ${error.message}`);
        if (data) {
          userId = userId ?? (data.id as string);
          if (
            !plan &&
            (data.plan === "starter" || data.plan === "plus" || data.plan === "ultimate")
          )
            plan = data.plan;
        }
      }
      if (!userId || !plan) return { handled: false }; // history only; the plan is set elsewhere
      await rpc(db, "record_payment", {
        p_user: userId,
        p_plan: plan,
        p_months: action.months,
        p_ref: action.ref,
        p_amount: action.amountSatang,
        p_method: "card",
      });
      await rewardPaidReferral(db, userId, action.ref);
      return { handled: true, userId };
    }

    case "addon": {
      const sku = addonBySku(action.sku);
      if (!sku) return { handled: false };
      // the same payment arriving twice (a retried webhook) adds the add-on once
      const { error } = await db.from("addons").upsert(
        {
          user_id: action.userId,
          kind: sku.kind,
          sku: sku.sku,
          units: sku.units,
          remaining: sku.kind === "slips" ? sku.units : null,
          expires_at: action.expiresAt ? action.expiresAt.toISOString() : null,
          source_ref: action.ref,
        },
        { onConflict: "source_ref", ignoreDuplicates: true },
      );
      if (error) throw new Error(`add addon: ${error.message}`);
      if (action.customer) {
        await db
          .from("users")
          .update({ stripe_customer_id: action.customer })
          .eq("id", action.userId)
          .is("stripe_customer_id", null);
      }
      return { handled: true, userId: action.userId };
    }

    case "ignore":
      return { handled: false };
  }
}
