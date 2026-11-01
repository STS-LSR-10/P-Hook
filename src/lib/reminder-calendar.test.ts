import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDayMap,
  monthGrid,
  nextOccurrence,
  roundAfter,
  weekStart,
  ymdOf,
} from "./reminder-calendar";
import type { ReminderDto } from "./user-reminder";

const at = (iso: string) => new Date(iso);
const reminder = (over: Partial<ReminderDto>): ReminderDto => ({
  id: "r",
  body: "กินยา",
  remindAt: "2026-11-02T11:00:00.000Z",
  repeat: null,
  status: "active",
  category: null,
  ...over,
});

describe("nextOccurrence", () => {
  it("steps a day and a week in Bangkok", () => {
    expect(nextOccurrence(at("2026-11-02T11:00:00Z"), "daily").toISOString()).toBe(
      "2026-11-03T11:00:00.000Z",
    );
    expect(nextOccurrence(at("2026-11-02T11:00:00Z"), "weekly").toISOString()).toBe(
      "2026-11-09T11:00:00.000Z",
    );
  });

  it("stays in the next month, as the reminder job does", () => {
    expect(nextOccurrence(at("2027-01-31T02:00:00Z"), "monthly").toISOString()).toBe(
      "2027-02-28T02:00:00.000Z",
    );
  });

  it("steps by the Bangkok day, not the UTC one", () => {
    // 1 Nov 23:00 UTC is 2 Nov 06:00 in Bangkok; a month on is 2 Dec there
    expect(nextOccurrence(at("2026-11-01T23:00:00Z"), "monthly").toISOString()).toBe(
      "2026-12-01T23:00:00.000Z",
    );
  });
});

describe("roundAfter", () => {
  it("is the round after this one", () => {
    const now = at("2026-11-01T00:00:00Z");
    expect(roundAfter(at("2026-11-02T11:00:00Z"), "daily", now).toISOString()).toBe(
      "2026-11-03T11:00:00.000Z",
    );
  });

  it("is never in the past", () => {
    const now = at("2026-11-10T00:00:00Z");
    expect(roundAfter(at("2026-11-02T11:00:00Z"), "daily", now).toISOString()).toBe(
      "2026-11-10T11:00:00.000Z",
    );
  });
});

describe("day helpers", () => {
  it("reads the Bangkok day", () => expect(ymdOf(at("2026-11-01T18:00:00Z"))).toBe("2026-11-02"));
  it("adds days across a month", () => expect(addDays("2026-10-31", 1)).toBe("2026-11-01"));
  it("starts a week on Sunday", () => expect(weekStart("2026-11-04")).toBe("2026-11-01"));
});

describe("monthGrid", () => {
  it("fills whole weeks around November 2569", () => {
    const grid = monthGrid(2026, 11);
    expect(grid[0]).toEqual({ ymd: "2026-11-01", inMonth: true });
    expect(grid).toHaveLength(35);
    expect(grid[grid.length - 1]).toEqual({ ymd: "2026-12-05", inMonth: false });
  });

  it("starts with the end of the month before", () => {
    expect(monthGrid(2026, 12)[0]).toEqual({ ymd: "2026-11-29", inMonth: false });
  });
});

describe("buildDayMap", () => {
  const range = { from: "2026-11-01", to: "2026-11-30" };

  it("puts a one-off on its day", () => {
    const map = buildDayMap([reminder({})], range);
    expect(map.get("2026-11-02")?.[0]?.next).toBe(true);
    expect(map.size).toBe(1);
  });

  it("puts a repeat on every coming day, only the first being the next round", () => {
    const map = buildDayMap([reminder({ repeat: "daily" })], range);
    expect(map.size).toBe(29);
    expect(map.has("2026-11-01")).toBe(false);
    expect(map.get("2026-11-02")?.[0]?.next).toBe(true);
    expect(map.get("2026-11-03")?.[0]?.next).toBe(false);
  });

  it("does not repeat one that is done", () => {
    const map = buildDayMap([reminder({ repeat: "daily", status: "done" })], range);
    expect(map.size).toBe(1);
  });

  it("orders a day by time", () => {
    const map = buildDayMap(
      [
        reminder({ id: "late", remindAt: "2026-11-02T12:00:00.000Z" }),
        reminder({ id: "early", remindAt: "2026-11-02T01:00:00.000Z" }),
      ],
      range,
    );
    expect(map.get("2026-11-02")?.map((e) => e.reminder.id)).toEqual(["early", "late"]);
  });

  it("keeps the clock time of a repeat", () => {
    const map = buildDayMap([reminder({ repeat: "weekly" })], range);
    expect(map.get("2026-11-09")?.[0]?.at.toISOString()).toBe("2026-11-09T11:00:00.000Z");
  });

  it("reaches a far month without running away", () => {
    const far = buildDayMap([reminder({ repeat: "daily" })], {
      from: "2036-01-01",
      to: "2036-01-31",
    });
    expect(far.size).toBe(31);
  });
});
