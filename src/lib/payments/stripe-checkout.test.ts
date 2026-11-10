import { describe, expect, it } from "vitest";
import {
  buildAddonCheckoutFields,
  buildCheckoutFields,
  earlyBirdCouponFields,
  resultUrls,
} from "./stripe-checkout";
import { addonBySku } from "@/lib/addons";

const USER = "11111111-1111-1111-1111-111111111111";
const BASE = "https://jodtang.example.com/";
// no launch prices are in force: the same normal prices whatever the day
const AFTER = new Date("2027-02-01T00:00:00Z");
const EARLIER = new Date("2026-11-01T00:00:00Z");

describe("buildCheckoutFields", () => {
  it("card = subscription with the right recurring interval", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "plus", period: "yearly", method: "card" },
      BASE,
      AFTER,
    );
    expect(f.mode).toBe("subscription");
    expect(Object.keys(f).some((k) => k.startsWith("payment_method_types"))).toBe(false);
    expect(f["line_items[0][price_data][currency]"]).toBe("thb");
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("69900"); // ฿699 in satang
    expect(f["line_items[0][price_data][recurring][interval]"]).toBe("year");
    expect(f["subscription_data[metadata][user_id]"]).toBe(USER);
    expect(f["subscription_data[metadata][plan]"]).toBe("plus");
    expect(f["subscription_data[metadata][period]"]).toBe("yearly");
  });

  it("monthly Elite card costs ฿299 and renews monthly", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "ultimate", period: "monthly", method: "card" },
      BASE,
      AFTER,
    );
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("29900");
    expect(f["line_items[0][price_data][recurring][interval]"]).toBe("month");
  });

  it("each plan is charged its normal price, on any day", () => {
    const price = (
      plan: "starter" | "plus" | "ultimate",
      period: "monthly" | "yearly",
      now: Date,
    ) =>
      buildCheckoutFields({ userId: USER, plan, period, method: "card" }, BASE, now)[
        "line_items[0][price_data][unit_amount]"
      ];
    for (const day of [EARLIER, AFTER]) {
      expect(price("starter", "monthly", day)).toBe("4900");
      expect(price("starter", "yearly", day)).toBe("34900");
      expect(price("plus", "monthly", day)).toBe("12900");
      expect(price("plus", "yearly", day)).toBe("69900");
      expect(price("ultimate", "monthly", day)).toBe("29900");
      expect(price("ultimate", "yearly", day)).toBe("199000");
    }
  });

  it("PromptPay = one-time payment (no recurring)", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "ultimate", period: "yearly", method: "promptpay" },
      BASE,
      AFTER,
    );
    expect(f.mode).toBe("payment");
    // payment methods come from the Dashboard settings: the API no longer accepts a list here
    expect(Object.keys(f).some((k) => k.startsWith("payment_method_types"))).toBe(false);
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("199000");
    expect(Object.keys(f).some((k) => k.includes("recurring"))).toBe(false);
    expect(f["metadata[method]"]).toBe("promptpay");
    expect(f.customer_creation).toBe("always");
  });

  it("a prepaid upgrade charges only the difference and is marked as an upgrade", () => {
    const f = buildCheckoutFields(
      {
        userId: USER,
        plan: "ultimate",
        period: "monthly",
        method: "promptpay",
        upgrade: { amountSatang: 4000, days: 15 },
      },
      BASE,
    );
    expect(f.mode).toBe("payment");
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("4000");
    expect(f["metadata[kind]"]).toBe("upgrade");
    expect(f["line_items[0][price_data][product_data][name]"]).toContain("ส่วนต่าง 15 วัน");
  });

  it("ignores an upgrade amount for a card subscription (never a custom price)", () => {
    const f = buildCheckoutFields(
      {
        userId: USER,
        plan: "ultimate",
        period: "monthly",
        method: "card",
        upgrade: { amountSatang: 100, days: 1 },
      },
      BASE,
      AFTER,
    );
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("29900");
    expect(f["metadata[kind]"]).toBeUndefined();
  });

  it("reuses an existing customer instead of creating one", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "plus", period: "monthly", method: "promptpay", customerId: "cus_1" },
      BASE,
    );
    expect(f.customer).toBe("cus_1");
    expect(f.customer_creation).toBeUndefined();
  });

  it("sends the person back to our public result page", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "plus", period: "monthly", method: "card" },
      BASE,
    );
    expect(f.success_url).toBe("https://jodtang.example.com/pay/result?status=success");
    expect(f.cancel_url).toBe(resultUrls(BASE).cancel);
    expect(f.locale).toBe("th");
  });
});

describe("Early Bird checkout", () => {
  it("a card subscription keeps the normal price and takes the difference off with one coupon", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "plus", period: "yearly", method: "card", earlyBird: true },
      BASE,
      AFTER,
      "coupon_1",
    );
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("69900"); // renews at the normal price
    expect(f["discounts[0][coupon]"]).toBe("coupon_1");
    expect(f["subscription_data[metadata][early_bird]"]).toBe("1");
    expect(earlyBirdCouponFields("plus", "yearly", AFTER)).toMatchObject({
      amount_off: String((699 - 499) * 100),
      duration: "once",
      max_redemptions: "1",
    });
    expect(earlyBirdCouponFields("starter", "monthly", AFTER).amount_off).toBe(
      String((49 - 29) * 100),
    );
  });

  it("the page lapses with the seat reservation, and the coupon cannot outlive it", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "plus", period: "yearly", method: "card", earlyBird: true },
      BASE,
      AFTER,
      "coupon_1",
    );
    const t0 = Math.floor(AFTER.getTime() / 1000);
    expect(Number(f.expires_at)).toBe(t0 + 31 * 60);
    expect(Number(earlyBirdCouponFields("plus", "yearly", AFTER).redeem_by)).toBe(t0 + 3600);
    expect(
      buildCheckoutFields(
        { userId: USER, plan: "plus", period: "yearly", method: "card" },
        BASE,
        AFTER,
      ).expires_at,
    ).toBeUndefined();
  });

  it("PromptPay (yearly) is charged the Early Bird price itself", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "ultimate", period: "yearly", method: "promptpay", earlyBird: true },
      BASE,
      AFTER,
    );
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("149000");
    expect(f["metadata[early_bird]"]).toBe("1");
  });

  it("without a seat, or on an upgrade quote, nothing changes", () => {
    const f = buildCheckoutFields(
      { userId: USER, plan: "starter", period: "yearly", method: "card" },
      BASE,
      AFTER,
    );
    expect(f["discounts[0][coupon]"]).toBeUndefined();
    expect(f["subscription_data[metadata][early_bird]"]).toBeUndefined();
  });
});

describe("add-on checkout", () => {
  const sku = (id: string) => addonBySku(id)!;

  it("a monthly add-on by card is its own monthly subscription", () => {
    const f = buildAddonCheckoutFields(
      { userId: USER, addon: sku("storage_10"), method: "card" },
      BASE,
    );
    expect(f.mode).toBe("subscription");
    expect(f["line_items[0][price_data][unit_amount]"]).toBe("1500");
    expect(f["line_items[0][price_data][recurring][interval]"]).toBe("month");
    expect(f["subscription_data[metadata][addon]"]).toBe("storage_10");
    expect(f["subscription_data[metadata][user_id]"]).toBe(USER);
    expect(f["subscription_data[metadata][plan]"]).toBeUndefined();
  });

  it("a monthly add-on by PromptPay and every pack are a single payment", () => {
    for (const [id, method, baht] of [
      ["groups_2", "promptpay", 29],
      ["slips_300", "card", 49],
      ["alerts_l", "promptpay", 35],
    ] as const) {
      const f = buildAddonCheckoutFields({ userId: USER, addon: sku(id), method }, BASE);
      expect(f.mode).toBe("payment");
      expect(f["line_items[0][price_data][unit_amount]"]).toBe(String(baht * 100));
      expect(f["metadata[addon]"]).toBe(id);
      expect(f["line_items[0][price_data][recurring][interval]"]).toBeUndefined();
    }
  });
});
