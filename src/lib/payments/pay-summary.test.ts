import { describe, expect, it } from "vitest";
import { earlyBirdFits, paySummary } from "./pay-summary";

const NOW = new Date("2026-11-11T12:25:00Z"); // 19:25 in Bangkok
const PRICE = { monthly: 129, yearly: 1290 };
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);

describe("paySummary", () => {
  it("PromptPay from today: the period ends one month or one year on", () => {
    const month = paySummary({
      method: "promptpay",
      period: "monthly",
      price: PRICE,
      expiresAt: null,
      now: NOW,
    });
    expect(month).toMatchObject({ payBaht: 129, regularBaht: 129, early: false });
    expect(ymd(month.until)).toBe("2026-12-11");
    const year = paySummary({
      method: "promptpay",
      period: "yearly",
      price: PRICE,
      expiresAt: null,
      now: NOW,
    });
    expect(year.payBaht).toBe(1290);
    expect(ymd(year.until)).toBe("2027-11-11");
  });

  it("PromptPay is added after the time that is left", () => {
    const left = new Date("2026-12-01T00:00:00Z");
    const r = paySummary({
      method: "promptpay",
      period: "monthly",
      price: PRICE,
      expiresAt: left,
      now: NOW,
    });
    expect(ymd(r.until)).toBe("2027-01-01");
    // a plan that already ended counts from today
    const ended = paySummary({
      method: "promptpay",
      period: "monthly",
      price: PRICE,
      expiresAt: new Date("2026-10-01T00:00:00Z"),
      now: NOW,
    });
    expect(ymd(ended.until)).toBe("2026-12-11");
  });

  it("a card subscription starts today whatever is left, and names the next charge", () => {
    const r = paySummary({
      method: "card",
      period: "monthly",
      price: PRICE,
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      now: NOW,
    });
    expect(ymd(r.until)).toBe("2026-12-11");
  });

  it("the end of a short month is its last day", () => {
    const r = paySummary({
      method: "card",
      period: "monthly",
      price: PRICE,
      expiresAt: null,
      now: new Date("2027-01-31T05:00:00Z"),
    });
    expect(ymd(r.until)).toBe("2027-02-28");
  });

  it("Early Bird lowers today's charge but not the regular price", () => {
    const r = paySummary({
      method: "card",
      period: "monthly",
      price: PRICE,
      earlyBaht: 89,
      expiresAt: null,
      now: NOW,
    });
    expect(r).toMatchObject({ payBaht: 89, regularBaht: 129, early: true });
  });

  it("Early Bird does not apply to a monthly PromptPay purchase", () => {
    expect(earlyBirdFits("promptpay", "monthly")).toBe(false);
    expect(earlyBirdFits("promptpay", "yearly")).toBe(true);
    expect(earlyBirdFits("card", "monthly")).toBe(true);
    const r = paySummary({
      method: "promptpay",
      period: "monthly",
      price: PRICE,
      earlyBaht: 89,
      expiresAt: null,
      now: NOW,
    });
    expect(r).toMatchObject({ payBaht: 129, early: false });
  });
});
