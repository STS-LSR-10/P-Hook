import { describe, expect, it } from "vitest";
import {
  can,
  effectivePlan,
  FREE_SLIPS_TOTAL,
  FREE_VOICE_TOTAL,
  GROUP_LEDGER_LIMIT,
  MIN_PLAN,
  nextPlanUp,
  planAtLeast,
  PLAN_ORDER,
  recurringLimit,
  slipsRemaining,
  SLIP_LIMIT,
  VOICE_LIMIT,
  type Feature,
} from "./plan";

const NOW = new Date("2026-10-15T08:00:00Z");

describe("effectivePlan", () => {
  it("free without expiry stays free", () => {
    expect(effectivePlan("free", null, NOW)).toBe("free");
  });

  it("plus without expiry is plus", () => {
    expect(effectivePlan("plus", null, NOW)).toBe("plus");
  });

  it("ultimate keeps its tier while valid and falls back to free once expired", () => {
    expect(effectivePlan("ultimate", null, NOW)).toBe("ultimate");
    expect(effectivePlan("ultimate", "2026-11-01T00:00:00Z", NOW)).toBe("ultimate");
    expect(effectivePlan("ultimate", "2026-10-01T00:00:00Z", NOW)).toBe("free");
  });

  it("an expired plus falls back to free", () => {
    expect(effectivePlan("plus", "2026-10-01T00:00:00Z", NOW)).toBe("free");
  });

  it("a future expiry is plus, even for a free row (redeemed points)", () => {
    expect(effectivePlan("free", "2026-11-01T00:00:00Z", NOW)).toBe("plus");
  });
});

describe("limits", () => {
  it("free cannot read slips", () => {
    expect(slipsRemaining("free", 0)).toBe(0);
    expect(slipsRemaining("free", 99)).toBe(0);
  });

  it("every paid plan has its own monthly slip number; Free has a taste for life instead", () => {
    expect(SLIP_LIMIT).toEqual({ free: 0, starter: 60, plus: 250, ultimate: 600 });
    expect(FREE_SLIPS_TOTAL).toBe(10);
    expect(slipsRemaining("starter", 0)).toBe(60);
    expect(slipsRemaining("starter", 59)).toBe(1);
    expect(slipsRemaining("starter", 60)).toBe(0);
    expect(slipsRemaining("starter", 99)).toBe(0);
    expect(slipsRemaining("ultimate", 599)).toBe(1);
  });

  it("voice logging is Starter and above, with a monthly number each", () => {
    expect(can("free", "voiceLog")).toBe(false);
    for (const p of ["starter", "plus", "ultimate"] as const) expect(can(p, "voiceLog")).toBe(true);
    expect(VOICE_LIMIT).toEqual({ free: 0, starter: 30, plus: 200, ultimate: 400 });
    expect(FREE_VOICE_TOTAL).toBe(10);
  });

  it("recurring entries grow with the plan", () => {
    expect(PLAN_ORDER.map(recurringLimit)).toEqual([0, 20, 100, 300]);
  });

  it("group ledgers: how many groups and people each plan has", () => {
    expect(GROUP_LEDGER_LIMIT).toEqual({
      free: { groups: 0, members: 0 },
      starter: { groups: 1, members: 5 },
      plus: { groups: 5, members: 10 },
      ultimate: { groups: 10, members: 20 },
    });
  });

  it("Elite has every feature", () => {
    for (const f of Object.keys(MIN_PLAN) as Feature[]) expect(can("ultimate", f)).toBe(true);
  });

  it("feature flags", () => {
    expect(can("free", "savingsChart")).toBe(false);
    expect(can("starter", "savingsChart")).toBe(true);
    expect(can("plus", "savingsChart")).toBe(true);
  });
});

describe("the four plans", () => {
  it("are ordered, and a higher plan has everything a lower one has", () => {
    expect(PLAN_ORDER).toEqual(["free", "starter", "plus", "ultimate"]);
    expect(planAtLeast("plus", "starter")).toBe(true);
    expect(planAtLeast("starter", "plus")).toBe(false);
    expect(planAtLeast("free", "free")).toBe(true);
    for (const f of Object.keys(MIN_PLAN) as Feature[]) {
      const has = PLAN_ORDER.map((p) => can(p, f));
      expect(has, f).toEqual([...has].sort((a, b) => Number(a) - Number(b))); // never true then false
    }
  });

  it("nextPlanUp says what to offer; nothing above Elite", () => {
    expect(PLAN_ORDER.map(nextPlanUp)).toEqual(["starter", "plus", "ultimate", null]);
  });

  it("the gates sit where the plan table puts them", () => {
    const at = (f: Feature) => MIN_PLAN[f];
    expect(at("export")).toBe("starter");
    expect(at("foreignCurrency")).toBe("starter");
    expect(at("debts")).toBe("starter");
    expect(at("groupLedger")).toBe("starter");
    expect(at("savingsGoal")).toBe("starter");
    expect(at("insight")).toBe("plus");
    expect(at("forecast")).toBe("plus");
    expect(at("billReminder")).toBe("plus");
    expect(at("advancedExport")).toBe("plus");
    expect(at("pdfExport")).toBe("ultimate");
    expect(at("smartParse")).toBe("ultimate");
  });
});

describe("export and dashboard", () => {
  it("are Starter and above, never Free", () => {
    for (const feature of ["export", "dashboard"] as const) {
      expect(can("free", feature)).toBe(false);
      expect(can("starter", feature)).toBe(true);
      expect(can("plus", feature)).toBe(true);
      expect(can("ultimate", feature)).toBe(true);
    }
  });
});
