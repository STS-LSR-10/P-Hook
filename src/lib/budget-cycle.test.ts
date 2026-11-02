import { describe, expect, it } from "vitest";
import { calendarMonthRange, cycleRange, dayRange, monthStart } from "./budget-cycle";

// Thu 2026-10-15 15:00 Bangkok
const NOW = new Date("2026-10-15T08:00:00Z");

describe("budget-cycle", () => {
  it("dayRange covers the Bangkok day", () => {
    const r = dayRange(NOW);
    expect(r.from.toISOString()).toBe("2026-10-14T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-15T17:00:00.000Z");
  });

  it("a day just after midnight Bangkok belongs to the new Bangkok day", () => {
    const r = dayRange(new Date("2026-10-14T17:30:00Z")); // 00:30 on the 15th Bangkok
    expect(r.from.toISOString()).toBe("2026-10-14T17:00:00.000Z");
  });

  it("calendar month", () => {
    const r = calendarMonthRange(NOW);
    expect(r.from.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("monthly cycle starting on the 1st", () => {
    const r = cycleRange(NOW, "monthly", 1);
    expect(r.from.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("monthly cycle that started last month", () => {
    const r = cycleRange(NOW, "monthly", 25); // 15th < 25 -> since Sep 25
    expect(r.from.toISOString()).toBe("2026-09-24T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-24T17:00:00.000Z");
  });

  it("monthly cycle across a year boundary", () => {
    const r = cycleRange(new Date("2027-01-05T05:00:00Z"), "monthly", 20);
    expect(r.from.toISOString()).toBe("2026-12-19T17:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-01-19T17:00:00.000Z");
  });

  it("weekly cycle starts on Monday", () => {
    const r = cycleRange(NOW, "weekly");
    expect(r.from.toISOString()).toBe("2026-10-11T17:00:00.000Z"); // Mon Oct 12 00:00 BKK
    expect(r.to.toISOString()).toBe("2026-10-18T17:00:00.000Z");
  });

  it("a start day past the end of a month starts on that month's last day", () => {
    // 31: Sep has 30 days, so the cycle runs from 30 Sep to 31 Oct
    const r = cycleRange(NOW, "monthly", 31);
    expect(r.from.toISOString()).toBe("2026-09-29T17:00:00.000Z"); // 30 Sep 00:00 BKK
    expect(r.to.toISOString()).toBe("2026-10-30T17:00:00.000Z"); // 31 Oct 00:00 BKK
  });

  it("February ends on the 28th, or the 29th in a leap year", () => {
    const feb2027 = cycleRange(new Date("2027-03-10T03:00:00Z"), "monthly", 30);
    expect(feb2027.from.toISOString()).toBe("2027-02-27T17:00:00.000Z"); // 28 Feb 2027
    expect(feb2027.to.toISOString()).toBe("2027-03-29T17:00:00.000Z"); // 30 Mar 2027
    const feb2028 = cycleRange(new Date("2028-03-10T03:00:00Z"), "monthly", 31);
    expect(feb2028.from.toISOString()).toBe("2028-02-28T17:00:00.000Z"); // 29 Feb 2028
  });

  it("on the last day of a short month the new cycle has begun", () => {
    // 30 Apr with 31 chosen: April has no 31st, so the cycle starts today
    const r = cycleRange(new Date("2027-04-30T03:00:00Z"), "monthly", 31);
    expect(r.from.toISOString()).toBe("2027-04-29T17:00:00.000Z"); // 30 Apr
    expect(r.to.toISOString()).toBe("2027-05-30T17:00:00.000Z"); // 31 May
  });

  it("day 31 across a year boundary", () => {
    const r = cycleRange(new Date("2027-01-05T03:00:00Z"), "monthly", 31);
    expect(r.from.toISOString()).toBe("2026-12-30T17:00:00.000Z"); // 31 Dec 2026
    expect(r.to.toISOString()).toBe("2027-01-30T17:00:00.000Z"); // 31 Jan 2027
  });

  it("monthStart clamps to the month and rolls over the year", () => {
    expect(monthStart(2027, 2, 31).toISOString()).toBe("2027-02-27T17:00:00.000Z");
    expect(monthStart(2027, 0, 31).toISOString()).toBe("2026-12-30T17:00:00.000Z"); // Dec 2026
    expect(monthStart(2026, 13, 15).toISOString()).toBe("2027-01-14T17:00:00.000Z"); // Jan 2027
    expect(monthStart(2026, 5, 0).toISOString()).toBe("2026-04-30T17:00:00.000Z"); // 1 May
  });
});
