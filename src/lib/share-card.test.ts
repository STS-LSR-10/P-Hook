import { describe, expect, it } from "vitest";
import { buildShareCard, changePercent, type ShareSummary } from "./share-card";

const base: ShareSummary = {
  range: { from: "2026-10-31T17:00:00Z", to: "2026-11-30T17:00:00Z" }, // November in Bangkok
  cycle: "monthly",
  incomeSatang: 3_000_000,
  expenseSatang: 1_200_000,
  balanceSatang: 1_800_000,
  count: 42,
  budgetSatang: null,
  categories: [
    { name: "อาหาร", color: "#0F766E", icon: "utensils", totalSatang: 600_000 },
    { name: "เดินทาง", color: "#0369A1", icon: "bus", totalSatang: 300_000 },
    { name: "ช้อปปิ้ง", color: "#DB2777", icon: "shopping-bag", totalSatang: 200_000 },
    { name: "อื่นๆ", color: null, icon: "ellipsis", totalSatang: 100_000 },
  ],
};
const before = (expenseSatang: number): ShareSummary => ({ ...base, expenseSatang });

describe("changePercent", () => {
  it("is the rise or fall in whole percent, and nothing without a before", () => {
    expect(changePercent(12_000, 10_000)).toBe(20);
    expect(changePercent(8_000, 10_000)).toBe(-20);
    expect(changePercent(100, 0)).toBeNull();
    expect(changePercent(100, null)).toBeNull();
  });
});

describe("buildShareCard: amounts hidden (the default)", () => {
  const hidden = { hideAmounts: true };

  it("says no baht anywhere: percentages, counts and ranks only", () => {
    const m = buildShareCard(base, before(1_500_000), hidden);
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/฿|\d,\d{3}/);
    expect(m.top.every((t) => t.amount === undefined)).toBe(true);
  });

  it("the hero is how much of the budget went, when there is a budget", () => {
    const m = buildShareCard({ ...base, budgetSatang: 2_000_000 }, null, hidden);
    expect(m.heroLabel).toBe("ใช้ไปแล้ว");
    expect(m.heroValue).toBe("60% ของงบ");
  });

  it("without a budget it is how much of the income was kept", () => {
    const m = buildShareCard(base, null, hidden);
    expect(m.heroLabel).toBe("ออมได้");
    expect(m.heroValue).toBe("60% ของรายรับ");
  });

  it("with no income and no budget it is how many entries were recorded", () => {
    const m = buildShareCard({ ...base, incomeSatang: 0, balanceSatang: -1_200_000 }, null, hidden);
    expect(m.heroValue).toBe("42 รายการ");
  });

  it("spending more than the income says so", () => {
    const m = buildShareCard(
      { ...base, incomeSatang: 1_000_000, balanceSatang: -200_000 },
      null,
      hidden,
    );
    expect(m.heroLabel).toBe("ใช้เกินรายรับ");
    expect(m.heroValue).toBe("20%");
  });

  it("compares with the period before in the second figure", () => {
    expect(buildShareCard(base, before(1_500_000), hidden).stats[1]).toEqual({
      label: "เทียบเดือนก่อน",
      value: "-20%",
    });
    expect(buildShareCard(base, null, hidden).stats[1]?.value).toBe("–");
  });
});

describe("buildShareCard: amounts shown", () => {
  it("shows the balance, the income and the spending, and each category's amount", () => {
    const m = buildShareCard(base, null, { hideAmounts: false });
    expect(m.heroLabel).toBe("คงเหลือ");
    expect(m.heroValue).toBe("฿18,000");
    expect(m.stats).toEqual([
      { label: "รายรับ", value: "฿30,000" },
      { label: "รายจ่าย", value: "฿12,000" },
    ]);
    expect(m.top[0]?.amount).toBe("฿6,000");
  });

  it("a negative balance says ติดลบ, with the size", () => {
    const m = buildShareCard({ ...base, balanceSatang: -50_000 }, null, { hideAmounts: false });
    expect(m.heroLabel).toBe("ติดลบ");
    expect(m.heroValue).toBe("฿500");
  });
});

describe("buildShareCard: the rest", () => {
  const show = { hideAmounts: true };

  it("the three biggest categories, with their share of the spending, icons and colours", () => {
    const m = buildShareCard(base, null, show);
    expect(m.top.map((t) => [t.name, t.percent, t.emoji])).toEqual([
      ["อาหาร", 50, "🍜"],
      ["เดินทาง", 25, "🚌"],
      ["ช้อปปิ้ง", 17, "🛍️"],
    ]);
    expect(m.top[0]?.color).toBe("#0F766E");
  });

  it("a plan with no breakdown (Free) has no rows, and the card still works", () => {
    const m = buildShareCard({ ...base, categories: null }, null, show);
    expect(m.top).toEqual([]);
    expect(m.title).toBe("พฤศจิกายนของฉัน");
  });

  it("the title is the month; a weekly cycle is the week", () => {
    expect(buildShareCard(base, null, show).title).toBe("พฤศจิกายนของฉัน");
    expect(buildShareCard({ ...base, cycle: "weekly" }, null, show).title).toBe("สัปดาห์ของฉัน");
  });

  it("the subtitle is the days of the period, in the Thai calendar", () => {
    expect(buildShareCard(base, null, show).subtitle).toBe("1 พ.ย. 2569 – 30 พ.ย. 2569");
  });

  it("the headline follows what happened: over budget, less, more, about the same, nothing", () => {
    expect(buildShareCard({ ...base, budgetSatang: 1_000_000 }, null, show).headline).toContain(
      "เกินงบ",
    );
    expect(buildShareCard(base, before(1_500_000), show).headline).toContain(
      "น้อยกว่าเดือนก่อน 20%",
    );
    expect(buildShareCard(base, before(1_000_000), show).headline).toContain(
      "มากกว่าเดือนก่อน 20%",
    );
    expect(buildShareCard(base, before(1_220_000), show).headline).toContain("ใกล้เคียง");
    expect(buildShareCard({ ...base, count: 0, expenseSatang: 0 }, null, show).headline).toContain(
      "ยังไม่มีรายการ",
    );
  });

  it("with nothing to compare against it does not claim 'about the same'", () => {
    const h = buildShareCard(base, null, show).headline;
    expect(h).toContain("จดมาแล้ว 42 รายการ");
    expect(h).not.toContain("ใกล้เคียง");
    // a tiny period before (under ฿100) is not a base either
    expect(buildShareCard(base, before(5_000), show).headline).not.toContain("มากกว่า");
    expect(changePercent(50_000, 100)).toBeNull();
    expect(changePercent(10_000_000, 10_000)).toBe(999);
  });

  it("a cycle that starts mid-month is named for the month most of it falls in", () => {
    const mid = { ...base, range: { from: "2026-10-24T17:00:00Z", to: "2026-11-24T17:00:00Z" } }; // 25 Oct – 24 Nov
    expect(buildShareCard(mid, null, show).title).toBe("พฤศจิกายนของฉัน");
  });

  it("rounding never contradicts the words", () => {
    const over = buildShareCard({ ...base, budgetSatang: 1_195_000 }, null, show); // spent 100.4% of it
    expect(over.heroValue).toBe("101% ของงบ");
    const slightlyOver = buildShareCard(
      { ...base, incomeSatang: 1_000_000, expenseSatang: 1_003_000, balanceSatang: -3_000 },
      null,
      show,
    );
    expect(slightlyOver.heroLabel).toBe("ใช้เกินรายรับ");
    expect(slightlyOver.heroValue).toBe("1%");
  });
});
