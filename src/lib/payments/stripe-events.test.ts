import { describe, expect, it } from "vitest";
import { applyAction, interpretEvent, type StripeEvent } from "./stripe-events";

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

describe("add-on payments", () => {
  const addonMeta = { user_id: USER, addon: "groups_2", method: "card" };

  it("a paid session for a pack is kept with no end date", () => {
    const a = interpretEvent(
      ev("checkout.session.completed", {
        id: "cs_pack",
        mode: "payment",
        payment_status: "paid",
        created: 1_800_000_000,
        metadata: { user_id: USER, addon: "slips_100", method: "promptpay" },
      }),
    );
    expect(a).toMatchObject({
      kind: "addon",
      userId: USER,
      sku: "slips_100",
      ref: "cs_pack",
      expiresAt: null,
    });
  });

  it("a paid session for a monthly add-on runs about a month", () => {
    const a = interpretEvent(
      ev("checkout.session.completed", {
        id: "cs_m",
        mode: "payment",
        payment_status: "paid",
        created: 1_800_000_000,
        metadata: { user_id: USER, addon: "groups_2", method: "promptpay" },
      }),
    );
    expect(a).toMatchObject({ kind: "addon", sku: "groups_2", ref: "cs_m" });
    expect((a as { expiresAt: Date }).expiresAt.getTime()).toBe(
      1_800_000_000_000 + 34 * 86_400_000,
    );
  });

  it("every paid invoice of a monthly add-on grants it until the end of that period, and is no plan payment", () => {
    const a = interpretEvent(
      ev("invoice.paid", {
        id: "in_1",
        amount_paid: 2900,
        currency: "thb",
        customer: "cus_1",
        subscription_details: { metadata: addonMeta },
        lines: { data: [{ period: { start: 1_800_000_000, end: 1_802_592_000 } }] },
      }),
    );
    expect(a).toMatchObject({ kind: "addon", sku: "groups_2", ref: "in_1" });
    expect((a as { expiresAt: Date }).expiresAt.getTime()).toBe(1_802_592_000_000 + 3 * 86_400_000);
  });

  it("an unknown add-on or user is ignored", () => {
    const bad = (m: Record<string, string>) =>
      interpretEvent(
        ev("checkout.session.completed", {
          id: "cs_x",
          mode: "payment",
          payment_status: "paid",
          amount_total: 100,
          currency: "thb",
          metadata: m,
        }),
      );
    expect(bad({ user_id: USER, addon: "free_money" })).toEqual({ kind: "ignore" });
    expect(bad({ user_id: "nope", addon: "slips_100" })).toEqual({ kind: "ignore" });
  });
});

describe("applying an add-on payment", () => {
  const fakeDb = () => {
    const calls: { row: Record<string, unknown>; opts: unknown }[] = [];
    const db = {
      from: (table: string) => ({
        upsert: async (row: Record<string, unknown>, opts: unknown) => {
          expect(table).toBe("addons");
          calls.push({ row, opts });
          return { error: null };
        },
      }),
    };
    return { db: db as never, calls };
  };

  it("a slip pack starts with all its reads, and a retried payment is not added twice", async () => {
    const { db, calls } = fakeDb();
    const action = {
      kind: "addon",
      userId: USER,
      sku: "slips_300",
      ref: "cs_1",
      expiresAt: null,
      customer: null,
    } as const;
    expect(await applyAction(db, action)).toEqual({ handled: true, userId: USER });
    expect(calls[0]?.row).toMatchObject({
      user_id: USER,
      kind: "slips",
      units: 300,
      remaining: 300,
      expires_at: null,
      source_ref: "cs_1",
    });
    // the second delivery goes to the same key and is ignored by the database
    expect(calls[0]?.opts).toEqual({ onConflict: "source_ref", ignoreDuplicates: true });
  });

  it("a monthly add-on carries its end date and no reads counter", async () => {
    const { db, calls } = fakeDb();
    const end = new Date("2026-12-10T00:00:00Z");
    await applyAction(db, {
      kind: "addon",
      userId: USER,
      sku: "storage_10",
      ref: "in_1",
      expiresAt: end,
      customer: null,
    });
    expect(calls[0]?.row).toMatchObject({
      kind: "storage",
      units: 10,
      remaining: null,
      expires_at: end.toISOString(),
    });
  });
});

describe("an add-on bought by someone with no saved Stripe customer", () => {
  it("keeps the customer so the billing portal can cancel it", async () => {
    const updates: unknown[] = [];
    const db = {
      from: (table: string) =>
        table === "addons"
          ? { upsert: async () => ({ error: null }) }
          : {
              update: (v: unknown) => {
                updates.push(v);
                return { eq: () => ({ is: async () => ({ error: null }) }) };
              },
            },
    } as never;
    await applyAction(db, {
      kind: "addon",
      userId: USER,
      sku: "groups_2",
      ref: "in_9",
      expiresAt: new Date("2026-12-10T00:00:00Z"),
      customer: "cus_9",
    });
    expect(updates).toEqual([{ stripe_customer_id: "cus_9" }]);
  });
});

describe("Paid Referral on a payment", () => {
  const fakeDb = (failReward = false) => {
    const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        if (fn === "grant_paid_referral" && failReward) {
          return { data: null, error: { message: "boom" } };
        }
        return { data: true, error: null };
      },
      from: () => ({ update: () => ({ eq: () => ({ is: async () => ({ error: null }) }) }) }),
    };
    return { db: db as never, rpcs };
  };
  const reward = (rpcs: { fn: string; args: Record<string, unknown> }[]) =>
    rpcs.filter((r) => r.fn === "grant_paid_referral").map((r) => r.args);

  it("a prepaid purchase asks for the reward with its own payment reference", async () => {
    const { db, rpcs } = fakeDb();
    await applyAction(db, {
      kind: "prepaid",
      userId: USER,
      plan: "plus",
      months: 1,
      ref: "cs_1",
      amountSatang: 5900,
      method: "promptpay",
      customer: null,
    });
    expect(reward(rpcs)).toEqual([
      { p_user: USER, p_ref: "cs_1", p_referrer_coins: 30, p_days: 30, p_monthly_cap: 5 },
    ]);
    // it comes after the payment is recorded
    expect(rpcs.map((r) => r.fn)).toEqual(["apply_prepaid_purchase", "grant_paid_referral"]);
  });

  it("a paid card invoice asks for it too", async () => {
    const { db, rpcs } = fakeDb();
    await applyAction(db, {
      kind: "invoice",
      userId: USER,
      plan: "plus",
      months: 1,
      ref: "in_1",
      amountSatang: 5900,
      customer: "cus_1",
    });
    expect(reward(rpcs)).toHaveLength(1);
    expect(reward(rpcs)[0]).toMatchObject({ p_user: USER, p_ref: "in_1" });
  });

  it("a prepaid upgrade that was applied asks for it, one that was not does not", async () => {
    const applied = fakeDb();
    await applyAction(applied.db, {
      kind: "prepaidUpgrade",
      userId: USER,
      plan: "ultimate",
      ref: "cs_up",
      amountSatang: 4000,
      method: "promptpay",
    });
    expect(reward(applied.rpcs)).toHaveLength(1);

    const rpcs: string[] = [];
    const notApplied = {
      rpc: async (fn: string) => {
        rpcs.push(fn);
        return { data: false, error: null };
      },
    };
    await applyAction(notApplied as never, {
      kind: "prepaidUpgrade",
      userId: USER,
      plan: "ultimate",
      ref: "cs_up2",
      amountSatang: 4000,
      method: "promptpay",
    });
    expect(rpcs).toEqual(["apply_prepaid_upgrade"]);
  });

  it("a failing reward never fails the webhook", async () => {
    const { db } = fakeDb(true);
    await expect(
      applyAction(db, {
        kind: "prepaid",
        userId: USER,
        plan: "plus",
        months: 1,
        ref: "cs_2",
        amountSatang: 5900,
        method: "card",
        customer: null,
      }),
    ).resolves.toEqual({ handled: true, userId: USER });
  });
});
