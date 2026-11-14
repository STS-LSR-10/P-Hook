import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { findActivity, loadActivityColumns, readPeriod, yearRange } from "./activity";

const NOW = new Date("2026-12-31T18:00:00Z"); // 1 Jan 2027, 01:00 in Bangkok

describe("readPeriod", () => {
  it("defaults to this month and year in Bangkok", () => {
    expect(readPeriod({}, NOW)).toEqual({ month: "2027-01", year: "2027" });
  });
  it("takes a good month and year, and ignores bad ones", () => {
    expect(readPeriod({ month: "2026-11", year: "2026" }, NOW)).toEqual({
      month: "2026-11",
      year: "2026",
    });
    expect(readPeriod({ month: "2026-13", year: "26'; drop" }, NOW)).toEqual({
      month: "2027-01",
      year: "2027",
    });
  });
});

describe("loading", () => {
  it("asks for the month, the year and everything, in Bangkok time", async () => {
    const asked: unknown[] = [];
    const db = {
      rpc: async (_fn: string, args: unknown) => {
        asked.push(args);
        return { data: [{ grp: "note", kind: null, uses: "3", people: "2" }], error: null };
      },
    } as unknown as SupabaseClient;
    const [month] = await loadActivityColumns(db, { month: "2026-11", year: "2026" });
    expect(asked[0]).toEqual({
      p_from: "2026-11-01T00:00:00+07:00",
      p_to: "2026-12-01T00:00:00+07:00",
    });
    expect(asked[1]).toEqual({ p_from: yearRange("2026").from, p_to: yearRange("2026").to });
    expect(findActivity(month, "note", null)).toMatchObject({ uses: 3, people: 2 });
    expect(findActivity(month, "image", null)).toMatchObject({ uses: 0, people: 0 });
  });
});
