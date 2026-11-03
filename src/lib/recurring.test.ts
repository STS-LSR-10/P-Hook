import { describe, expect, it } from "vitest";
import { describeRule, dueRuns, firstRunAt, nextRunAfter, resumeAfter } from "./recurring";

// Fri 2026-10-16 15:00 Bangkok
const NOW = new Date("2026-10-16T08:00:00Z");
const iso = (d: Date) => d.toISOString();
// Bangkok midnight of a given day, written as UTC: day D 00:00 +07 = (D-1) 17:00Z
const bkk = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, -7));

describe("firstRunAt", () => {
  it("daily starts today", () => {
    expect(iso(firstRunAt(NOW, "daily", null))).toBe(iso(bkk(2026, 10, 16)));
  });

  it("weekly picks the next matching weekday (today counts)", () => {
    expect(iso(firstRunAt(NOW, "weekly", 5))).toBe(iso(bkk(2026, 10, 16))); // Friday = today
    expect(iso(firstRunAt(NOW, "weekly", 1))).toBe(iso(bkk(2026, 10, 19))); // next Monday
    expect(iso(firstRunAt(NOW, "weekly", 0))).toBe(iso(bkk(2026, 10, 18))); // Sunday
  });

  it("monthly: later this month, or next month when already past", () => {
    expect(iso(firstRunAt(NOW, "monthly", 25))).toBe(iso(bkk(2026, 10, 25)));
    expect(iso(firstRunAt(NOW, "monthly", 16))).toBe(iso(bkk(2026, 10, 16)));
    expect(iso(firstRunAt(NOW, "monthly", 5))).toBe(iso(bkk(2026, 11, 5)));
  });

  it("monthly clamps to short months", () => {
    const feb = new Date("2027-02-10T05:00:00Z");
    expect(iso(firstRunAt(feb, "monthly", 31))).toBe(iso(bkk(2027, 2, 28)));
  });
});

describe("nextRunAfter", () => {
  it("daily and weekly", () => {
    expect(iso(nextRunAfter(bkk(2026, 10, 31), "daily", null))).toBe(iso(bkk(2026, 11, 1)));
    expect(iso(nextRunAfter(bkk(2026, 10, 26), "weekly", 1))).toBe(iso(bkk(2026, 11, 2)));
  });

  it("monthly keeps the rule's day: 31st -> Feb 28 -> Mar 31", () => {
    const jan31 = bkk(2027, 1, 31);
    const feb = nextRunAfter(jan31, "monthly", 31);
    expect(iso(feb)).toBe(iso(bkk(2027, 2, 28)));
    expect(iso(nextRunAfter(feb, "monthly", 31))).toBe(iso(bkk(2027, 3, 31)));
  });

  it("monthly rolls over the year", () => {
    expect(iso(nextRunAfter(bkk(2026, 12, 15), "monthly", 15))).toBe(iso(bkk(2027, 1, 15)));
  });
});

describe("dueRuns / resumeAfter", () => {
  it("nothing is due before the run time", () => {
    expect(dueRuns(bkk(2026, 10, 17), NOW, "daily", null)).toEqual([]);
  });

  it("catches up every missed day, oldest first", () => {
    const runs = dueRuns(bkk(2026, 10, 13), NOW, "daily", null);
    expect(runs.map(iso)).toEqual([
      iso(bkk(2026, 10, 13)),
      iso(bkk(2026, 10, 14)),
      iso(bkk(2026, 10, 15)),
      iso(bkk(2026, 10, 16)),
    ]);
    expect(iso(resumeAfter(bkk(2026, 10, 13), runs.length, "daily", null))).toBe(
      iso(bkk(2026, 10, 17)),
    );
  });

  it("caps catch-up after a long outage", () => {
    const runs = dueRuns(bkk(2026, 1, 1), NOW, "daily", null, 12);
    expect(runs).toHaveLength(12);
  });

  it("a monthly rule due today runs once", () => {
    expect(dueRuns(bkk(2026, 10, 16), NOW, "monthly", 16)).toHaveLength(1);
  });
});

describe("describeRule", () => {
  it("reads naturally in Thai", () => {
    expect(describeRule("daily", null)).toBe("ทุกวัน");
    expect(describeRule("weekly", 1)).toBe("ทุกวันจันทร์");
    expect(describeRule("monthly", 25)).toBe("ทุกเดือน วันที่ 25");
  });
});

describe("recurring days in the owner's zone", () => {
  it("runs at their midnight, not Bangkok's", async () => {
    const { runInZone } = await import("@/lib/zone-scope");
    const { firstRunAt: first } = await import("./recurring");
    // 3 Nov 2026 12:00 UTC: the day is 3 Nov both in Bangkok and in New York (EST)
    const now = new Date("2026-11-03T12:00:00Z");
    expect(runInZone("America/New_York", () => first(now, "daily", null)).toISOString()).toBe(
      "2026-11-03T05:00:00.000Z",
    );
    expect(first(now, "daily", null).toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });
});
