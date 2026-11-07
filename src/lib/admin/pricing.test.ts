import { describe, expect, it } from "vitest";
import {
  aiCostUsd,
  lineCostThb,
  LINE_PLANS,
  r2CostUsd,
  r2OperationClass,
  readAiPrices,
  resolveLinePlan,
} from "./pricing";

const GB = 1024 ** 3;

describe("AI prices", () => {
  it("prices tokens per million and returns null for an unknown model", () => {
    const prices = readAiPrices({});
    expect(aiCostUsd(prices, "gemini-3.5-flash-lite", 2_000_000, 1_000_000)).toBeCloseTo(3.1, 6);
    expect(aiCostUsd(prices, "mystery", 10, 10)).toBeNull();
  });

  it("lays AI_PRICES over the table and ignores bad entries or bad JSON", () => {
    const prices = readAiPrices({
      AI_PRICES: '{"claude-haiku-5-5":{"input":1,"output":5},"bad":{"input":-1,"output":2}}',
    });
    expect(prices["claude-haiku-5-5"]).toEqual({ input: 1, output: 5 });
    expect(prices.bad).toBeUndefined();
    expect(prices["gemini-3.5-flash-lite"]).toBeDefined();
    expect(readAiPrices({ AI_PRICES: "{nope" })["gemini-3.5-flash-lite"]).toBeDefined();
  });
});

describe("LINE plans", () => {
  it("tells the plan from the quota, or from LINE_OA_PLAN", () => {
    expect(resolveLinePlan(300, {})?.id).toBe("free");
    expect(resolveLinePlan(15_000, {})?.id).toBe("basic");
    expect(resolveLinePlan(null, {})).toBeNull();
    expect(resolveLinePlan(1234, {})).toBeNull();
    expect(resolveLinePlan(300, { LINE_OA_PLAN: "PRO" })?.id).toBe("pro");
  });

  it("charges the fee, messages past the quota, and 7% VAT", () => {
    const basic = LINE_PLANS.find((p) => p.id === "basic")!;
    const cost = lineCostThb(basic, 16_000);
    expect(cost.extraMessages).toBe(1000);
    expect(cost.extraThb).toBeCloseTo(100, 6);
    expect(cost.totalThb).toBeCloseTo(1380 * 1.07, 6);
    expect(lineCostThb(LINE_PLANS[0]!, 11).totalThb).toBe(0);
  });
});

describe("R2", () => {
  it("classifies operations", () => {
    expect(r2OperationClass("PutObject")).toBe("A");
    expect(r2OperationClass("ListObjects")).toBe("A");
    expect(r2OperationClass("GetObject")).toBe("B");
    expect(r2OperationClass("DeleteObject")).toBe("free");
  });

  it("charges only past the free allowance", () => {
    expect(r2CostUsd(5 * GB, 500_000, 2_000_000).totalUsd).toBe(0);
    const cost = r2CostUsd(110 * GB, 3_000_000, 20_000_000);
    expect(cost.storageUsd).toBeCloseTo(1.5, 6);
    expect(cost.classAUsd).toBeCloseTo(9, 6);
    expect(cost.classBUsd).toBeCloseTo(3.6, 6);
    expect(r2CostUsd(0, null, null).totalUsd).toBe(0);
  });
});
