import { describe, expect, it } from "vitest";
import { queryCommand } from "./query-command";

// Wednesday 4 November 2026, 10:00 in Bangkok
const now = new Date("2026-11-04T03:00:00Z");
const ask = (
  period: Parameters<typeof queryCommand>[0]["period"],
  searchTerm: string | null = null,
) => queryCommand({ period, fromDate: null, toDate: null, searchTerm }, now);

describe("queryCommand", () => {
  it("today and this month are the summaries everyone has", () => {
    expect(ask("today")).toEqual({ kind: "summary", scope: "today" });
    expect(ask("this_month")).toEqual({ kind: "summary", scope: "month" });
  });

  it("other days are a range, worked out here and not by the AI", () => {
    expect(ask("yesterday")).toEqual({
      kind: "summary-range",
      start: { year: 2026, month: 11, day: 3 },
      end: { year: 2026, month: 11, day: 3 },
    });
    expect(ask("last_month")).toEqual({
      kind: "summary-range",
      start: { year: 2026, month: 10, day: 1 },
      end: { year: 2026, month: 10, day: 31 },
    });
    // weeks start on Monday
    expect(ask("this_week")).toEqual({
      kind: "summary-range",
      start: { year: 2026, month: 11, day: 2 },
      end: "today",
    });
    expect(ask("last_week")).toEqual({
      kind: "summary-range",
      start: { year: 2026, month: 10, day: 26 },
      end: { year: 2026, month: 11, day: 1 },
    });
    expect(ask("last_7_days")).toMatchObject({ start: { month: 10, day: 29 }, end: "today" });
    expect(ask("this_year")).toMatchObject({ start: { year: 2026, month: 1, day: 1 } });
    expect(ask("last_year")).toMatchObject({
      start: { year: 2025, month: 1, day: 1 },
      end: { year: 2025, month: 12, day: 31 },
    });
  });

  it("one thing asked about is a search over those days", () => {
    expect(ask("last_month", "กาแฟ")).toEqual({
      kind: "search",
      term: "กาแฟ",
      start: { year: 2026, month: 10, day: 1 },
      end: { year: 2026, month: 10, day: 31 },
    });
    expect(ask("today", "กาแฟ")).toMatchObject({ kind: "search", end: "today" });
  });

  it("days of the person's own", () => {
    expect(
      queryCommand(
        { period: "custom", fromDate: "2026-10-05", toDate: "2026-10-20", searchTerm: null },
        now,
      ),
    ).toEqual({
      kind: "summary-range",
      start: { year: 2026, month: 10, day: 5 },
      end: { year: 2026, month: 10, day: 20 },
    });
    expect(
      queryCommand(
        { period: "custom", fromDate: "2026-02-30", toDate: null, searchTerm: null },
        now,
      ),
    ).toBeNull();
  });
});
