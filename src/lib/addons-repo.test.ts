import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "plus";
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));

import { loadBonus } from "./addons-repo";

const NOW = new Date("2026-11-10T00:00:00Z");
const GB = 1024 ** 3;
const ROWS = [
  { kind: "storage", units: 10, remaining: null, expires_at: "2026-12-01T00:00:00Z" },
  { kind: "group_slots", units: 2, remaining: null, expires_at: "2026-12-01T00:00:00Z" },
  { kind: "alerts", units: 50, remaining: null, expires_at: null },
  { kind: "slips", units: 100, remaining: 40, expires_at: null },
];
const db = (rows: unknown[], error: unknown = null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ or: () => ({ limit: async () => ({ data: rows, error }) }) }),
      }),
    }),
  }) as unknown as SupabaseClient;

beforeEach(() => {
  plan = "plus";
});

describe("loadBonus", () => {
  it("sums everything bought while the plan is paid", async () => {
    expect(await loadBonus(db(ROWS), "u1", NOW)).toEqual({
      storageBytes: 10 * GB,
      alerts: 50,
      slips: 40,
      groups: 2,
    });
  });

  it("when the plan lapses to Free the monthly add-ons rest and the packs stay", async () => {
    plan = "free";
    expect(await loadBonus(db(ROWS), "u1", NOW)).toEqual({
      storageBytes: 0,
      alerts: 50,
      slips: 40,
      groups: 0,
    });
  });

  it("is zero, never an error, when the table is missing or the read fails", async () => {
    expect(await loadBonus(db([], { message: "no such table" }), "u1", NOW)).toEqual({
      storageBytes: 0,
      alerts: 0,
      slips: 0,
      groups: 0,
    });
    const broken = {
      from: () => {
        throw new Error("down");
      },
    } as unknown as SupabaseClient;
    expect((await loadBonus(broken, "u1", NOW)).slips).toBe(0);
  });
});
