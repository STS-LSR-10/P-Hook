import { describe, expect, it } from "vitest";
import { MIN_PLAN, PLAN_ORDER, can, type Feature } from "./plan";
import {
  FEATURE_GROUPS,
  LAUNCH_PRICES,
  launchActive,
  priceFor,
  pricingAt,
  MIN_CHARGE_BAHT,
  PRICES,
  prepaidUpgradeQuote,
  TRIAL_DAYS,
  yearlyPerDay,
  yearlySavingPercent,
} from "./pricing";

describe("pricing", () => {
  it("has the agreed prices", () => {
    expect(PRICES.starter).toEqual({ monthly: 49, yearly: 349 });
    expect(PRICES.plus).toEqual({ monthly: 129, yearly: 699 });
    expect(PRICES.ultimate).toEqual({ monthly: 299, yearly: 1990 });
  });

  it("yearly is cheaper than twelve months and per-day is derived", () => {
    for (const p of Object.values(PRICES)) expect(p.yearly).toBeLessThan(p.monthly * 12);
    expect(yearlyPerDay(PRICES.starter)).toBe("1.0");
    expect(yearlyPerDay(PRICES.plus)).toBe("1.9");
    expect(yearlyPerDay(PRICES.ultimate)).toBe("5.5");
    expect(yearlySavingPercent(PRICES.starter)).toBe(41);
    expect(yearlySavingPercent(PRICES.plus)).toBe(55);
    expect(yearlySavingPercent(PRICES.ultimate)).toBe(45);
  });

  it("every row has four cells (Free, Starter, Pro, Elite) and a lower plan never has more", () => {
    for (const row of FEATURE_GROUPS.flatMap((g) => g.rows)) {
      expect(row.cells, row.label).toHaveLength(4);
      for (let i = 1; i < 4; i++) {
        if (row.cells[i - 1] !== false) expect(row.cells[i], row.label).not.toBe(false);
      }
    }
  });
});

describe("what each plan can do", () => {
  const rows = FEATURE_GROUPS.flatMap((g) => g.rows);

  it("every real feature gate is listed, with the same plan as the gate", () => {
    for (const [feature, min] of Object.entries(MIN_PLAN) as [
      Feature,
      (typeof PLAN_ORDER)[number],
    ][]) {
      const row = rows.find((r) => r.feature === feature);
      expect(row, `no row for ${feature}`).toBeDefined();
      // a dash exactly where the gate says no, something (a tick or a limit) where it says yes;
      // Free alone may show a short text where the gate says no (a taste, like "1 ใบ" or "ลองฟรี")
      PLAN_ORDER.forEach((plan, i) => {
        const cell = row!.cells[i];
        const label = `${feature} on ${plan} (gate from ${min})`;
        if (plan === "free" && !can(plan, feature)) expect(cell === true, label).toBe(false);
        else expect(cell !== false, label).toBe(can(plan, feature));
      });
    }
  });

  it("rows are short and every limit text sits on a plan that has the feature", () => {
    for (const row of rows) {
      expect(row.label.length, row.label).toBeLessThanOrEqual(45);
      for (let i = 0; i < 3; i++) {
        if (typeof row.cells[i] === "string") expect(row.cells[i + 1], row.label).not.toBe(false);
      }
    }
  });

  it("Free is only ever offered a taste of the paid things, never the thing itself", () => {
    for (const row of rows.filter((r) => r.feature)) {
      if (!can("free", row.feature!)) expect(row.cells[0] === true, row.label).toBe(false);
    }
  });
});

describe("launch prices", () => {
  it("none are in force for now: everyone pays the normal prices", () => {
    expect(launchActive(new Date("2026-11-09T00:00:00Z"))).toBe(false);
    expect(LAUNCH_PRICES).toEqual(PRICES);
    expect(priceFor("plus", new Date("2026-11-09T00:00:00Z"))).toEqual(PRICES.plus);
    expect(priceFor("starter", new Date("2027-03-01T00:00:00Z"))).toEqual(PRICES.starter);
  });

  it("pricingAt tells the page there is no launch to show", () => {
    const now = pricingAt(new Date("2026-11-09T00:00:00Z"));
    expect(now.launch).toBe(false);
    expect(now.prices).toEqual(PRICES);
    expect(now.list).toEqual(PRICES);
  });
});

describe("trial", () => {
  it("is 7 days", () => {
    expect(TRIAL_DAYS).toBe(7);
  });
});

describe("prepaidUpgradeQuote", () => {
  const now = new Date("2026-10-17T00:00:00Z");
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

  it("monthly prepaid: the daily price difference times the days left, rounded up", () => {
    // (299 - 129) / 30 * 15 = 85
    expect(
      prepaidUpgradeQuote({ from: "plus", to: "ultimate", months: 1, expiresAt: inDays(15), now }),
    ).toEqual({ amountBaht: 85, days: 15 });
    // 10 days: 170/30*10 = 56.67 -> 57
    expect(
      prepaidUpgradeQuote({ from: "plus", to: "ultimate", months: 1, expiresAt: inDays(10), now })
        ?.amountBaht,
    ).toBe(57);
  });

  it("yearly prepaid uses the yearly rates", () => {
    // (1990 - 699) / 365 * 200 = 707.4 -> 708
    expect(
      prepaidUpgradeQuote({
        from: "plus",
        to: "ultimate",
        months: 12,
        expiresAt: inDays(200),
        now,
      }),
    ).toEqual({ amountBaht: 708, days: 200 });
  });

  it("works from Starter too", () => {
    // (129 - 49) / 30 * 15 = 40
    expect(
      prepaidUpgradeQuote({ from: "starter", to: "plus", months: 1, expiresAt: inDays(15), now }),
    ).toEqual({ amountBaht: 40, days: 15 });
  });

  it("never charges less than Stripe's minimum or more than a full new period", () => {
    const tiny = prepaidUpgradeQuote({
      from: "plus",
      to: "ultimate",
      months: 1,
      expiresAt: inDays(1),
      now,
    });
    expect(tiny?.amountBaht).toBe(MIN_CHARGE_BAHT);
    const huge = prepaidUpgradeQuote({
      from: "plus",
      to: "ultimate",
      months: 1,
      expiresAt: inDays(400),
      now,
    });
    expect(huge?.amountBaht).toBe(PRICES.ultimate.monthly);
  });

  it("counts a started day as a whole day", () => {
    const q = prepaidUpgradeQuote({
      from: "plus",
      to: "ultimate",
      months: 1,
      expiresAt: new Date(now.getTime() + 36 * 3_600_000),
      now,
    });
    expect(q?.days).toBe(2);
  });

  it("is null when the target is not a higher tier", () => {
    expect(
      prepaidUpgradeQuote({ from: "plus", to: "plus", months: 1, expiresAt: inDays(5), now }),
    ).toBeNull();
    expect(
      prepaidUpgradeQuote({ from: "ultimate", to: "plus", months: 1, expiresAt: inDays(5), now }),
    ).toBeNull();
    expect(
      prepaidUpgradeQuote({ from: "plus", to: "starter", months: 1, expiresAt: inDays(5), now }),
    ).toBeNull();
  });
});

describe("the AI quota on the plan table", () => {
  it("says how many uses of ถาม AI each plan has a month, from the real limits", async () => {
    const { FEATURE_GROUPS } = await import("./pricing");
    const row = FEATURE_GROUPS.flatMap((g) => g.rows).find((r) => r.label.includes("ถาม AI"));
    expect(row?.cells).toEqual([
      "50 ครั้ง/เดือน",
      "600 ครั้ง/เดือน",
      "1,500 ครั้ง/เดือน",
      "3,000 ครั้ง/เดือน",
    ]);
  });
});

describe("Early Bird ends", () => {
  it("is open until the end of 31 Jan 2027 in Bangkok, and closed after", async () => {
    const { earlyBirdOpen } = await import("./pricing");
    expect(earlyBirdOpen(new Date("2027-01-31T16:59:59Z"))).toBe(true); // 23:59:59 in Bangkok
    expect(earlyBirdOpen(new Date("2027-01-31T17:00:00Z"))).toBe(false); // 1 Feb, 00:00
    expect(earlyBirdOpen(new Date("2026-11-14T05:00:00Z"))).toBe(true);
  });
});
