import { describe, expect, it } from "vitest";
import { countAddons, countByPlan, flagTrialBurn } from "./members";

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

describe("flagTrialBurn", () => {
  const trials = [
    {
      user_id: "a",
      plan: "plus" as const,
      started_at: "2026-11-08T12:00:00Z",
      code: "PH-P2600001",
    },
    {
      user_id: "b",
      plan: "starter" as const,
      started_at: "2026-11-08T12:00:00Z",
      code: "PH-S2600002",
    },
  ];

  it("flags a trial that used 80% of a trial limit in its first two days", () => {
    const flags = flagTrialBurn(
      trials,
      [
        { user_id: "a", kind: "ai_chat", used: 200 }, // 200 of 240 = 83%
        { user_id: "b", kind: "voice", used: 3 }, // 3 of 6 = 50%
      ],
      Array.from({ length: 8 }, () => ({ user_id: "b", created_at: "2026-11-08T13:00:00Z" })), // 8 slips of 9
      NOW,
    );
    expect(flags.map((f) => [f.code, f.what, f.percent])).toEqual([
      ["PH-S2600002", "slips", 89],
      ["PH-P2600001", "ai_chat", 83],
    ]);
  });

  it("does not count slips read before the trial started", () => {
    const before = Array.from({ length: 8 }, () => ({
      user_id: "b",
      created_at: "2026-11-08T10:00:00Z",
    }));
    expect(flagTrialBurn([trials[1]!], [], before, NOW)).toEqual([]);
  });

  it("ignores trials older than two days and limits a plan does not have", () => {
    const old = [{ ...trials[0]!, started_at: "2026-11-01T00:00:00Z" }];
    expect(flagTrialBurn(old, [{ user_id: "a", kind: "ai_chat", used: 240 }], [], NOW)).toEqual([]);
    expect(flagTrialBurn([trials[1]!], [{ user_id: "b", kind: "pdf", used: 5 }], [], NOW)).toEqual(
      [],
    );
  });
});
