import { describe, expect, it } from "vitest";
import {
  bangkokDay,
  buildSummaryCard,
  buildSummaryMessage,
  expenseChangePercent,
  isMonthlySummaryDue,
  isWeeklySummaryDue,
  lastMonthRange,
  lastWeekRange,
  monthlyStartDay,
  previousRange,
  rangeLabel,
  summarize,
  type SummaryTx,
} from "./summary-report";

// 2026-10-19 is a Monday. Times below are Bangkok (UTC+7).
const MON_0859 = new Date("2026-10-19T01:59:00Z");
const MON_0900 = new Date("2026-10-19T02:00:00Z");
const MON_2300 = new Date("2026-10-19T16:00:00Z");
const TUE_0900 = new Date("2026-10-20T02:00:00Z");

describe("weekly schedule", () => {
  it("is due on Monday from 09:00 and not before, not on other days", () => {
    expect(isWeeklySummaryDue(MON_0859, null)).toBe(false);
    expect(isWeeklySummaryDue(MON_0900, null)).toBe(true);
    expect(isWeeklySummaryDue(MON_2300, null)).toBe(true); // a missed hour is caught up
    expect(isWeeklySummaryDue(TUE_0900, null)).toBe(false);
  });

  it("is sent once per Monday", () => {
    expect(isWeeklySummaryDue(MON_0900, "2026-10-19")).toBe(false);
    expect(isWeeklySummaryDue(MON_0900, "2026-10-12")).toBe(true);
  });

  it("uses the Bangkok day, not UTC (Sunday 20:00 UTC is already Monday in Bangkok)", () => {
    const sundayNightUtc = new Date("2026-10-18T20:00:00Z"); // Mon 03:00 Bangkok
    expect(bangkokDay(sundayNightUtc)).toBe("2026-10-19");
    expect(isWeeklySummaryDue(sundayNightUtc, null)).toBe(false); // before 09:00
  });
});

describe("monthly schedule", () => {
  const day25 = new Date("2026-10-25T03:00:00Z"); // 10:00 Bangkok

  it("follows the budget cycle start day", () => {
    expect(isMonthlySummaryDue(day25, "monthly", 25, null)).toBe(true);
    expect(isMonthlySummaryDue(day25, "monthly", 1, null)).toBe(false);
    expect(isMonthlySummaryDue(day25, "monthly", 25, "2026-10-25")).toBe(false);
    expect(isMonthlySummaryDue(new Date("2026-10-25T01:00:00Z"), "monthly", 25, null)).toBe(false); // 08:00
  });

  it("a weekly budget cycle has no start day, so it uses the 1st", () => {
    expect(monthlyStartDay("weekly", 25)).toBe(1);
    expect(isMonthlySummaryDue(new Date("2026-11-01T03:00:00Z"), "weekly", 25, null)).toBe(true);
  });

  it("keeps a start day up to 31, and clamps outside 1-31", () => {
    expect(monthlyStartDay("monthly", 31)).toBe(31);
    expect(monthlyStartDay("monthly", 40)).toBe(31);
    expect(monthlyStartDay("monthly", 0)).toBe(1);
  });

  it("a start day past the end of the month sends on the last day", () => {
    const apr30 = new Date("2027-04-30T03:00:00Z");
    expect(isMonthlySummaryDue(apr30, "monthly", 31, null)).toBe(true);
    expect(isMonthlySummaryDue(apr30, "monthly", 30, null)).toBe(true);
    expect(isMonthlySummaryDue(new Date("2027-04-29T03:00:00Z"), "monthly", 31, null)).toBe(false);
    expect(isMonthlySummaryDue(new Date("2027-02-28T03:00:00Z"), "monthly", 29, null)).toBe(true);
    expect(isMonthlySummaryDue(new Date("2028-02-28T03:00:00Z"), "monthly", 29, null)).toBe(false);
    expect(isMonthlySummaryDue(new Date("2027-05-31T03:00:00Z"), "monthly", 31, null)).toBe(true);
  });
});

describe("ranges", () => {
  it("last week is the Monday-Sunday week before this Monday", () => {
    const r = lastWeekRange(MON_0900);
    expect(r.from.toISOString()).toBe("2026-10-11T17:00:00.000Z"); // Mon 12 Oct 00:00 Bangkok
    expect(r.to.toISOString()).toBe("2026-10-18T17:00:00.000Z"); // Mon 19 Oct 00:00 Bangkok
  });

  it("last month ends where the current cycle starts", () => {
    const r = lastMonthRange(new Date("2026-10-25T03:00:00Z"), "monthly", 25);
    expect(r.from.toISOString()).toBe("2026-09-24T17:00:00.000Z"); // 25 Sep 00:00 Bangkok
    expect(r.to.toISOString()).toBe("2026-10-24T17:00:00.000Z"); // 25 Oct 00:00 Bangkok
    const calendar = lastMonthRange(new Date("2026-11-01T03:00:00Z"), "monthly", 1);
    expect(calendar.from.toISOString()).toBe("2026-09-30T17:00:00.000Z"); // 1 Oct
    expect(calendar.to.toISOString()).toBe("2026-10-31T17:00:00.000Z"); // 1 Nov
  });

  it("last month with day 31 runs between the last days of short months", () => {
    const r = lastMonthRange(new Date("2027-04-30T03:00:00Z"), "monthly", 31);
    expect(r.from.toISOString()).toBe("2027-03-30T17:00:00.000Z"); // 31 Mar
    expect(r.to.toISOString()).toBe("2027-04-29T17:00:00.000Z"); // 30 Apr
  });

  it("the month before a clamped cycle starts on the chosen day again", () => {
    // the cycle from 28 Feb (31 chosen) follows the one from 31 Jan, not 28 Jan
    const feb = lastMonthRange(new Date("2027-03-31T03:00:00Z"), "monthly", 31);
    expect(feb.from.toISOString()).toBe("2027-02-27T17:00:00.000Z"); // 28 Feb
    expect(previousRange("monthly", feb, 31).from.toISOString()).toBe(
      "2027-01-30T17:00:00.000Z", // 31 Jan
    );
  });

  it("the previous period is a week / a month earlier", () => {
    const week = lastWeekRange(MON_0900);
    expect(previousRange("weekly", week).to.getTime()).toBe(week.from.getTime());
    expect(previousRange("weekly", week).from.toISOString()).toBe("2026-10-04T17:00:00.000Z");
    const month = lastMonthRange(new Date("2026-10-25T03:00:00Z"), "monthly", 25);
    expect(previousRange("monthly", month).from.toISOString()).toBe("2026-08-24T17:00:00.000Z");
  });

  it("labels a range with its last day inclusive", () => {
    expect(rangeLabel(lastWeekRange(MON_0900))).toBe("12 ต.ค. – 18 ต.ค.");
  });
});

const week = lastWeekRange(MON_0900);
const before = previousRange("weekly", week);
const at = (iso: string) => new Date(iso);
const tx = (
  iso: string,
  type: "income" | "expense",
  baht: number,
  cat: string | null,
): SummaryTx => ({
  occurredAt: at(iso),
  type,
  amountSatang: baht * 100,
  categoryName: cat,
});

const sample: SummaryTx[] = [
  tx("2026-10-13T05:00:00Z", "expense", 100, "อาหาร"),
  tx("2026-10-14T05:00:00Z", "expense", 300, "เดินทาง"),
  tx("2026-10-15T05:00:00Z", "expense", 50, "อาหาร"),
  tx("2026-10-16T05:00:00Z", "income", 1000, "เงินเดือน"),
  tx("2026-10-17T05:00:00Z", "expense", 25, null),
  // previous week
  tx("2026-10-06T05:00:00Z", "expense", 200, "อาหาร"),
  tx("2026-10-07T05:00:00Z", "income", 500, "เงินเดือน"),
  // outside both
  tx("2026-09-01T05:00:00Z", "expense", 9999, "อาหาร"),
  tx("2026-10-19T05:00:00Z", "expense", 9999, "อาหาร"),
];

describe("summarize", () => {
  const data = summarize(sample, week, before);

  it("totals the period and the one before, ignoring everything else", () => {
    expect(data.current).toEqual({ income: 100_000, expense: 47_500, count: 5 });
    expect(data.previous).toEqual({ income: 50_000, expense: 20_000, count: 2 });
  });

  it("lists the biggest expense categories with their share", () => {
    expect(data.topExpenses.map((c) => [c.name, c.amountSatang, c.percent])).toEqual([
      ["เดินทาง", 30_000, 63],
      ["อาหาร", 15_000, 32],
      ["ไม่ระบุหมวด", 2_500, 5],
    ]);
  });

  it("compares expenses with the previous period", () => {
    expect(expenseChangePercent(data)).toBe(138); // 475 vs 200
    expect(
      expenseChangePercent({ ...data, previous: { income: 0, expense: 0, count: 0 } }),
    ).toBeNull();
  });
});

describe("buildSummaryMessage", () => {
  const data = summarize(sample, week, before);

  it("is a flex card with the totals, the top categories and the comparison", () => {
    const msg = buildSummaryMessage({
      kind: "weekly",
      range: week,
      data,
      liffUrl: "https://app.example.com/analytics",
    });
    const json = JSON.stringify(msg);
    expect(msg.type).toBe("flex");
    expect(json).toContain("สรุปรายสัปดาห์");
    expect(json).toContain("+฿1,000");
    expect(json).toContain("-฿475");
    expect(json).toContain("฿525"); // net
    expect(json).toContain("เดินทาง");
    expect(json).toContain("เพิ่มขึ้น 138% จากสัปดาห์ก่อน");
    expect(json).toContain("จดไว้ 5 รายการ");
    expect(json).toContain("https://app.example.com/analytics");
  });

  it("monthly wording, a negative balance and no footer without an https link", () => {
    const d = summarize([tx("2026-10-13T05:00:00Z", "expense", 80, "อาหาร")], week, before);
    const json = JSON.stringify(
      buildSummaryMessage({
        kind: "monthly",
        range: week,
        data: d,
        liffUrl: "http://localhost/analytics",
      }),
    );
    expect(json).toContain("สรุปรายเดือน");
    expect(json).toContain("-฿80"); // balance below zero
    expect(json).not.toContain("ดูรายละเอียด");
    expect(json).not.toContain("จากเดือนก่อน"); // no baseline
  });
});

describe("buildSummaryCard", () => {
  const data = summarize(sample, week, before);

  it("uses the given title and subtitle, and names the previous period it compares with", () => {
    const json = JSON.stringify(
      buildSummaryCard({
        title: "สรุปเดือนนี้",
        range: week,
        data,
        against: "เดือนก่อน",
        subtitle: "1 ต.ค. 2569 – 31 ต.ค. 2569",
      }),
    );
    expect(json).toContain("สรุปเดือนนี้");
    expect(json).toContain("1 ต.ค. 2569 – 31 ต.ค. 2569");
    expect(json).toContain("จากเดือนก่อน");
  });

  it("has no comparison line when no previous period is named, even if there is data", () => {
    const json = JSON.stringify(buildSummaryCard({ title: "สรุปวันนี้", range: week, data }));
    expect(json).not.toContain("เพิ่มขึ้น");
    expect(json).not.toContain("ลดลง");
    expect(json).toContain("จดไว้ 5 รายการ");
  });

  it("buildSummaryMessage still gives the same card as before", () => {
    const old = JSON.stringify(buildSummaryMessage({ kind: "weekly", range: week, data }));
    const next = JSON.stringify(
      buildSummaryCard({ title: "สรุปรายสัปดาห์", range: week, data, against: "สัปดาห์ก่อน" }),
    );
    expect(next).toBe(old);
  });
});

describe("buildSummaryCard: the daily limit line", () => {
  const range = { from: new Date("2026-10-17T17:00:00Z"), to: new Date("2026-10-18T17:00:00Z") };
  const data = (expense: number) => ({
    current: { income: 0, expense, count: 2 },
    previous: { income: 0, expense: 0, count: 0 },
    topExpenses: [],
  });
  const json = (expense: number, dailyLimitSatang?: number) =>
    JSON.stringify(
      buildSummaryCard({
        title: "สรุปวันนี้",
        range,
        data: data(expense) as never,
        dailyLimitSatang,
      }),
    );

  it("says how much of the day's limit is used", () => {
    expect(json(32_000, 50_000)).toContain("ใช้ไป 64% ของงบวันนี้ ฿500");
  });

  it("says how much over when over", () => {
    expect(json(62_000, 50_000)).toContain("เกินงบวันนี้ ฿120");
  });

  it("has no such line without a limit", () => {
    expect(json(32_000)).not.toContain("งบวันนี้");
  });
});

describe("the look of the summary card", () => {
  const data = summarize(sample, week, before);
  const json = () =>
    JSON.stringify(
      buildSummaryCard({
        title: "สรุปเดือนนี้",
        range: week,
        data,
        liffUrl: "https://liff.line.me/1/summary",
      }),
    );

  it("has an emoji and an arrow on each figure, and the balance with the money emoji", () => {
    const out = json();
    expect(out).toContain("💰 รายรับ");
    expect(out).toContain("↑ +฿1,000");
    expect(out).toContain("🧾 รายจ่าย");
    expect(out).toContain("↓ -฿475");
    expect(out).toContain("💵 ฿525");
  });

  it("shows each top category with a coloured bar between its name and its amount", () => {
    const out = json();
    expect(out).toContain("ใช้จ่ายเยอะสุด");
    expect(out).toContain("#A583E0"); // the first bar
    expect(out).toContain("📝 จดไว้ 5 รายการ");
  });

  it("has the calendar emoji on the header and a rounded button with the arrow", () => {
    const out = json();
    expect(out).toContain('"text":"📅"');
    expect(out).toContain('"text":"ดูรายละเอียด ➡️"');
    expect(out).toContain('"label":"ดูรายละเอียด"');
  });
});

describe("ranges across a clock change", () => {
  it("a week before, and the label's last day, are calendar days (New York, 1 Nov)", async () => {
    const { runInZone } = await import("@/lib/zone-scope");
    const { fromBangkok } = await import("@/lib/thai-date");
    const { previousRange: prev, rangeLabel: label } = await import("./summary-report");
    runInZone("America/New_York", () => {
      const week = { from: fromBangkok(2026, 11, 2), to: fromBangkok(2026, 11, 9) };
      expect(prev("weekly", week).from.toISOString()).toBe(fromBangkok(2026, 10, 26).toISOString());
      const across = { from: fromBangkok(2026, 10, 26), to: fromBangkok(2026, 11, 2) };
      expect(label(across)).toBe("26 ต.ค. – 1 พ.ย.");
    });
  });
});
