import { describe, expect, it } from "vitest";
import { countByPlan } from "./members";

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
