import { describe, expect, it } from "vitest";
import { countAddons, countByPlan } from "./members";

const NOW = new Date("2026-11-09T00:00:00Z");

describe("countByPlan", () => {
  it("counts the plan in force: expired paid plans are Free, redeemed days on Free read as Pro", () => {
    const r = countByPlan(
      [
        { plan: "starter", plan_expires_at: "2026-12-01T00:00:00Z" },
        { plan: "plus", plan_expires_at: "2026-10-01T00:00:00Z" }, // ended
        { plan: "ultimate", plan_expires_at: null },
        { plan: "free", plan_expires_at: "2026-11-20T00:00:00Z" }, // redeemed with points
      ],
      10,
      NOW,
    );
    expect(r).toEqual({ free: 7, starter: 1, plus: 1, ultimate: 1 });
  });
});

describe("countAddons", () => {
  it("counts what was sold and what is still in force", () => {
    const r = countAddons(
      [
        { sku: "groups_2", remaining: null, expires_at: "2026-12-01T00:00:00Z" },
        { sku: "groups_2", remaining: null, expires_at: "2026-10-01T00:00:00Z" }, // ended
        { sku: "slips_100", remaining: 0, expires_at: null }, // used up
        { sku: "slips_100", remaining: 12, expires_at: null },
      ],
      NOW,
    );
    expect(r.find((x) => x.sku === "groups_2")).toEqual({ sku: "groups_2", sold: 2, active: 1 });
    expect(r.find((x) => x.sku === "slips_100")).toEqual({ sku: "slips_100", sold: 2, active: 1 });
    // a pack no longer on sale shows only while it has sales
    expect(r.find((x) => x.sku === "storage_15")).toEqual({
      sku: "storage_15",
      sold: 0,
      active: 0,
    });
    expect(r.find((x) => x.sku === "storage_10")).toBeUndefined();
    expect(r.find((x) => x.sku === "slips_100")).toBeDefined();
  });
});
