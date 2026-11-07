import { describe, expect, it } from "vitest";
import { DEFAULT_CHASE, inChaseWindow, parseChase } from "./chase-schedule";

describe("inChaseWindow", () => {
  it("any: from 10:00 on, never at night (the old behaviour)", () => {
    expect(inChaseWindow(9, "any")).toBe(false);
    expect(inChaseWindow(10, "any")).toBe(true);
    expect(inChaseWindow(23, "any")).toBe(true);
  });
  it("morning, noon and evening are their own hours", () => {
    expect([9, 10, 11, 12].map((h) => inChaseWindow(h, "morning"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect([11, 12, 15, 16].map((h) => inChaseWindow(h, "noon"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect([15, 16, 21, 22].map((h) => inChaseWindow(h, "evening"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("parseChase", () => {
  it("takes 0 (off), 1, 2, 3 and 7 days with a known window", () => {
    expect(parseChase({ everyDays: 0, window: "any" })).toEqual({ everyDays: 0, window: "any" });
    expect(parseChase({ everyDays: 3, window: "evening" })).toEqual({
      everyDays: 3,
      window: "evening",
    });
  });
  it("refuses anything else", () => {
    expect(parseChase({ everyDays: 4, window: "any" })).toBeNull();
    expect(parseChase({ everyDays: 1, window: "night" })).toBeNull();
    expect(parseChase(null)).toBeNull();
  });
  it("the default is today's behaviour: every day, from 10:00", () => {
    expect(DEFAULT_CHASE).toEqual({ everyDays: 1, window: "any" });
  });
});
