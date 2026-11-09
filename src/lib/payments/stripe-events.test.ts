import { describe, expect, it } from "vitest";
import { interpretEvent, type StripeEvent } from "./stripe-events";

const USER = "11111111-1111-1111-1111-111111111111";
const meta = { user_id: USER, plan: "plus", period: "yearly", method: "promptpay" };
const ev = (type: string, object: Record<string, unknown>): StripeEvent => ({
  id: "evt_1",
  type,
  data: { object },
});

describe("interpretEvent", () => {
  it("a paid PromptPay session becomes a prepaid purchase for the metadata user", () => {
    const a = interpretEvent(
      ev("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        amount_total: 29900,
        currency: "thb",
        customer: "cus_1",
        metadata: meta,
      }),
    );
    expect(a).toEqual({
      kind: "prepaid",
      userId: USER,
      plan: "plus",
      months: 12,
      ref: "cs_1",
      amountSatang: 29900,
      method: "promptpay",
      customer: "cus_1",
    });
  });

  it("a paid session with an Early Bird seat says so", () => {
    const a = interpretEvent(
      ev("checkout.session.completed", {
        id: "cs_eb",
        mode: "payment",
        payment_status: "paid",
        amount_total: 49900,
        currency: "thb",
        customer: null,
        metadata: {
          user_id: USER,
          plan: "plus",
          period: "yearly",
          method: "promptpay",
          early_bird: "1",
        },
      }),
    );
    expect(a).toMatchObject({ kind: "prepaid", earlyBird: true });
  });

  it("a paid session marked as an upgrade becomes a prepaid upgrade, not a new period", () => {
    const a = interpretEvent(
      ev("checkout.session.completed", {
        id: "cs_up",
        mode: "payment",
        payment_status: "paid",
        amount_total: 4000,
        currency: "thb",
        metadata: { ...meta, plan: "ultimate", kind: "upgrade" },
      }),
    );
    expect(a).toEqual({
      kind: "prepaidUpgrade",
      userId: USER,
      plan: "ultimate",
      ref: "cs_up",
      amountSatang: 4000,
      method: "promptpay",
    });
  });

  it("the delayed-payment success event is handled the same way", () => {
    const a = interpretEvent(
      ev("checkout.session.async_payment_succeeded", {
        id: "cs_2",
        mode: "payment",
        payment_status: "paid",
        amount_total: 5900,
        currency: "thb",
        metadata: { ...meta, period: "monthly" },
      }),
    );
    expect(a).toMatchObject({ kind: "prepaid", months: 1, customer: null });
  });

  it("ignores unpaid sessions, subscription-mode sessions and wrong currency", () => {
    const base = { id: "cs_3", amount_total: 100, currency: "thb", metadata: meta };
    expect(
      interpretEvent(
        ev("checkout.session.completed", { ...base, mode: "payment", payment_status: "unpaid" }),
      ),
    ).toEqual({ kind: "ignore" });
    expect(
      interpretEvent(
        ev("checkout.session.completed", { ...base, mode: "subscription", payment_status: "paid" }),
      ),
    ).toEqual({ kind: "ignore" });
    expect(
      interpretEvent(
        ev("checkout.session.completed", {
          ...base,
          mode: "payment",
          payment_status: "paid",
          currency: "usd",
        }),
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores events without valid metadata (never trusts a stranger's session)", () => {
    const paid = {
      id: "cs_4",
      mode: "payment",
      payment_status: "paid",
      amount_total: 100,
      currency: "thb",
    };
    expect(interpretEvent(ev("checkout.session.completed", paid))).toEqual({ kind: "ignore" });
    expect(
      interpretEvent(
        ev("checkout.session.completed", { ...paid, metadata: { ...meta, user_id: "not-a-uuid" } }),
      ),
    ).toEqual({ kind: "ignore" });
    expect(
      interpretEvent(
        ev("checkout.session.completed", { ...paid, metadata: { ...meta, plan: "free" } }),
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("an active subscription keeps the plan until the period end", () => {
    const a = interpretEvent(
      ev("customer.subscription.updated", {
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        current_period_end: 1_800_000_000,
        metadata: { ...meta, plan: "ultimate" },
      }),
    );
    expect(a).toEqual({
      kind: "subscription",
      userId: USER,
      plan: "ultimate",
      until: new Date(1_800_000_000_000),
      period: "yearly",
      customer: "cus_1",
      subscription: "sub_1",
    });
  });

  it("reads the period end from the subscription item on newer API versions", () => {
    const a = interpretEvent(
      ev("customer.subscription.created", {
        id: "sub_2",
        status: "trialing",
        customer: { id: "cus_2" },
        items: { data: [{ current_period_end: 1_800_000_500 }] },
        metadata: meta,
      }),
    );
    expect(a).toMatchObject({ kind: "subscription", customer: "cus_2" });
    if (a.kind === "subscription") expect(a.until.getTime()).toBe(1_800_000_500_000);
  });

  it("does not grant anything for incomplete, past-due or cancelled subscriptions", () => {
    for (const status of ["incomplete", "past_due", "canceled", "unpaid"]) {
      expect(
        interpretEvent(
          ev("customer.subscription.updated", {
            id: "sub_3",
            status,
            current_period_end: 1_800_000_000,
            metadata: meta,
          }),
        ),
      ).toEqual({ kind: "ignore" });
    }
  });

  it("a paid invoice becomes a history row (yearly detected from the period length)", () => {
    const a = interpretEvent(
      ev("invoice.paid", {
        id: "in_1",
        amount_paid: 29900,
        currency: "thb",
        customer: "cus_1",
        subscription_details: { metadata: meta },
        lines: { data: [{ period: { start: 1_800_000_000, end: 1_800_000_000 + 365 * 86_400 } }] },
      }),
    );
    expect(a).toEqual({
      kind: "invoice",
      userId: USER,
      plan: "plus",
      months: 12,
      ref: "in_1",
      amountSatang: 29900,
      customer: "cus_1",
    });
  });

  it("reads invoice metadata from the newer parent.subscription_details shape", () => {
    const a = interpretEvent(
      ev("invoice.paid", {
        id: "in_2",
        amount_paid: 5900,
        currency: "thb",
        parent: { subscription_details: { metadata: { ...meta, period: "monthly" } } },
        lines: { data: [{ period: { start: 1_800_000_000, end: 1_800_000_000 + 30 * 86_400 } }] },
      }),
    );
    expect(a).toMatchObject({ kind: "invoice", userId: USER, months: 1 });
  });

  it("ignores everything else", () => {
    expect(interpretEvent(ev("charge.refunded", { id: "ch_1" }))).toEqual({ kind: "ignore" });
    expect(interpretEvent({ id: "e", type: "x", data: {} as never })).toEqual({ kind: "ignore" });
  });
});
