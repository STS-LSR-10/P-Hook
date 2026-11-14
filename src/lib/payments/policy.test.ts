import { describe, expect, it } from "vitest";
import {
  billingState,
  planAction,
  prepaidUpgradeFor,
  trialBlock,
  type BillingInputs,
} from "./policy";

const NOW = new Date("2026-10-17T00:00:00Z");
const FUTURE = "2026-11-17T00:00:00Z";
const PAST = "2026-09-17T00:00:00Z";

const input = (over: Partial<BillingInputs> = {}): BillingInputs => ({
  plan: "free",
  planExpiresAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  billingPeriod: null,
  hasPrepaidPayment: false,
  prepaidMonths: null,
  trialsUsed: [],
  ...over,
});
const state = (over: Partial<BillingInputs> = {}) => billingState(input(over), NOW);
const sub = (over: Partial<BillingInputs> = {}) =>
  state({
    plan: "plus",
    planExpiresAt: FUTURE,
    stripeSubscriptionId: "sub_1",
    billingPeriod: "monthly",
    ...over,
  });

describe("billingState", () => {
  it("a new user has nothing running", () => {
    expect(state()).toMatchObject({
      plan: "free",
      subscriptionRunning: false,
      subscriptionId: null,
      period: null,
      prepaidRunning: false,
    });
  });

  it("a card subscription is running only while its period has not ended", () => {
    expect(sub()).toMatchObject({
      plan: "plus",
      subscriptionRunning: true,
      subscriptionId: "sub_1",
      period: "monthly",
      prepaidRunning: false,
    });
    expect(sub({ planExpiresAt: PAST })).toMatchObject({
      plan: "free",
      subscriptionRunning: false,
      subscriptionId: null,
    });
  });

  it("a subscription whose period was never recorded counts as monthly", () => {
    expect(sub({ billingPeriod: null }).period).toBe("monthly");
  });

  it("prepaid time needs a PromptPay payment on record (redeemed points days do not count)", () => {
    expect(
      state({ plan: "plus", planExpiresAt: FUTURE, hasPrepaidPayment: true }).prepaidRunning,
    ).toBe(true);
    expect(state({ plan: "free", planExpiresAt: FUTURE }).prepaidRunning).toBe(false);
    expect(
      state({ plan: "plus", planExpiresAt: PAST, hasPrepaidPayment: true }).prepaidRunning,
    ).toBe(false);
  });
});

describe("planAction: new purchases", () => {
  it("allows a first purchase either way", () => {
    expect(planAction(state(), { plan: "plus", period: "monthly", method: "card" })).toEqual({
      kind: "checkout",
    });
    expect(
      planAction(state(), { plan: "ultimate", period: "yearly", method: "promptpay" }),
    ).toEqual({
      kind: "checkout",
    });
  });

  it("allows points-redeemed days to be upgraded to a card subscription", () => {
    expect(
      planAction(state({ planExpiresAt: FUTURE }), {
        plan: "plus",
        period: "monthly",
        method: "card",
      }),
    ).toEqual({ kind: "checkout" });
  });

  it("an expired plan is just a new purchase again", () => {
    const s = state({
      plan: "ultimate",
      planExpiresAt: PAST,
      stripeSubscriptionId: "sub_1",
      hasPrepaidPayment: true,
    });
    expect(planAction(s, { plan: "plus", period: "monthly", method: "card" })).toEqual({
      kind: "checkout",
    });
  });
});

describe("planAction: a running card subscription", () => {
  it("a higher tier is a change of the subscription (difference only), for either period", () => {
    for (const period of ["monthly", "yearly"] as const) {
      expect(planAction(sub(), { plan: "ultimate", period, method: "card" })).toEqual({
        kind: "change",
      });
    }
  });

  it("monthly → yearly on the same tier is a change", () => {
    expect(planAction(sub(), { plan: "plus", period: "yearly", method: "card" })).toEqual({
      kind: "change",
    });
  });

  it("the same plan and period is refused", () => {
    const a = planAction(sub(), { plan: "plus", period: "monthly", method: "card" });
    expect(a).toMatchObject({ kind: "blocked", manage: true });
  });

  it("yearly → monthly on the same tier is refused (cancel and resubscribe at the end)", () => {
    const a = planAction(sub({ billingPeriod: "yearly" }), {
      plan: "plus",
      period: "monthly",
      method: "card",
    });
    expect(a).toMatchObject({ kind: "blocked", manage: true });
  });

  it("an upgrade from a yearly plan to a higher tier is a change", () => {
    expect(
      planAction(sub({ billingPeriod: "yearly" }), {
        plan: "ultimate",
        period: "yearly",
        method: "card",
      }),
    ).toEqual({ kind: "change" });
  });

  it("paying again with PromptPay is refused and points to the portal", () => {
    const a = planAction(sub(), { plan: "ultimate", period: "monthly", method: "promptpay" });
    expect(a).toMatchObject({ kind: "blocked", manage: true });
  });

  it("never sells a cheaper tier than the one in force", () => {
    const s = sub({ plan: "ultimate" });
    const a = planAction(s, { plan: "plus", period: "monthly", method: "card" });
    expect(a).toMatchObject({ kind: "blocked" });
    expect((a as { message: string }).message).toMatch(/สูงกว่า/);
  });
});

describe("planAction: prepaid (PromptPay) time", () => {
  const prepaid = () => state({ plan: "plus", planExpiresAt: FUTURE, hasPrepaidPayment: true });

  it("can be topped up or upgraded with PromptPay", () => {
    expect(planAction(prepaid(), { plan: "plus", period: "monthly", method: "promptpay" })).toEqual(
      {
        kind: "checkout",
      },
    );
    expect(
      planAction(prepaid(), { plan: "ultimate", period: "yearly", method: "promptpay" }),
    ).toEqual({
      kind: "checkout",
    });
  });

  it("cannot be mixed with a card subscription", () => {
    const a = planAction(prepaid(), { plan: "ultimate", period: "monthly", method: "card" });
    expect(a).toMatchObject({ kind: "blocked" });
    expect((a as { message: string }).message).toMatch(/พร้อมเพย์/);
  });

  it("never sells a cheaper tier", () => {
    const s = state({ plan: "ultimate", planExpiresAt: FUTURE, hasPrepaidPayment: true });
    expect(planAction(s, { plan: "plus", period: "monthly", method: "promptpay" })).toMatchObject({
      kind: "blocked",
    });
  });
});

describe("trialBlock", () => {
  it("a person with no plan can try either tier once", () => {
    expect(trialBlock(state(), "plus")).toBeNull();
    expect(trialBlock(state(), "ultimate")).toBeNull();
  });

  it("one trial per account: after any tier was tried, no tier can be tried again", () => {
    const s = state({ trialsUsed: ["plus"] });
    expect(trialBlock(s, "plus")).toMatch(/เคยทดลอง/);
    expect(trialBlock(s, "ultimate")).toMatch(/เคยทดลอง/);
    expect(trialBlock(s, "starter")).toMatch(/เคยทดลอง/);
  });

  it("is not offered while any plan is running (paid, redeemed days or a trial)", () => {
    expect(trialBlock(sub(), "ultimate")).toMatch(/ยังไม่มีแผน/);
    expect(trialBlock(state({ plan: "plus", planExpiresAt: FUTURE }), "ultimate")).not.toBeNull();
  });

  it("is not offered again once the previous plan has ended either", () => {
    expect(
      trialBlock(state({ plan: "plus", planExpiresAt: PAST, trialsUsed: ["plus"] }), "ultimate"),
    ).toMatch(/เคยทดลอง/);
  });
});

describe("prepaidUpgradeFor", () => {
  const prepaid = (months: number) =>
    state({ plan: "plus", planExpiresAt: FUTURE, hasPrepaidPayment: true, prepaidMonths: months });

  it("quotes the difference for prepaid time, at the rate of the period that was bought", () => {
    // 31 days left (2026-10-17 -> 2026-11-17), monthly: (289-129)/30*31 = 165.33 -> 166
    expect(prepaidUpgradeFor(prepaid(1), "ultimate", NOW)).toEqual({ amountBaht: 166, days: 31 });
    // yearly: (2590 - 1090)/365*31 = 127.4 -> 128
    expect(prepaidUpgradeFor(prepaid(12), "ultimate", NOW)).toEqual({ amountBaht: 128, days: 31 });
  });

  it("has no quote without running prepaid time or for a lower tier", () => {
    expect(prepaidUpgradeFor(state(), "ultimate", NOW)).toBeNull();
    expect(prepaidUpgradeFor(sub(), "ultimate", NOW)).toBeNull(); // a card subscription uses change
    expect(prepaidUpgradeFor(prepaid(1), "plus", NOW)).toBeNull();
    expect(prepaidUpgradeFor(prepaid(1), "starter", NOW)).toBeNull();
    // from Starter, Pro and Elite are both higher
    const fromStarter = state({
      plan: "starter",
      planExpiresAt: FUTURE,
      hasPrepaidPayment: true,
      prepaidMonths: 1,
    });
    expect(prepaidUpgradeFor(fromStarter, "plus", NOW)).not.toBeNull();
  });
});
