import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "free";
const saved: { categoryId: string | null; amountSatang: number | null }[] = [];
const modes: Record<string, unknown>[] = [];
const FOOD = "11111111-1111-4111-8111-111111111111";

let limited = false;
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => (limited ? new Response("{}", { status: 429 }) : null),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      upsert: async (row: unknown) => {
        modes.push(row as Record<string, unknown>);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  getSettings: async () => ({ budget_cycle: "monthly", cycle_start_day: 1 }),
  loadCategories: async () => [{ id: FOOD, type: "expense", name: "อาหาร" }],
  setBudget: async (
    _db: unknown,
    input: { categoryId: string | null; amountSatang: number | null },
  ) => {
    saved.push(input);
  },
}));

import { PUT } from "./route";

const put = (body: unknown) =>
  PUT(
    new Request("https://app.example.com/api/budgets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  limited = false;
  plan = "free";
  saved.length = 0;
  modes.length = 0;
});

describe("PUT /api/budgets: who may set what", () => {
  it("Free can set the overall budget and go back to the overall mode", async () => {
    expect((await put({ mode: "overall", overall: "10000" })).status).toBe(200);
    expect(saved).toMatchObject([{ categoryId: null, amountSatang: 1_000_000 }]);
  });

  it("Free cannot switch to per-category budgets or set one", async () => {
    for (const body of [
      { mode: "category" },
      { categories: [{ categoryId: FOOD, amount: "1500" }] },
    ]) {
      const res = await put(body);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ upgrade: true });
    }
    expect(saved).toHaveLength(0);
    expect(modes).toHaveLength(0);
  });

  it("Free can still clear a category budget they set before", async () => {
    expect((await put({ categories: [{ categoryId: FOOD, amount: null }] })).status).toBe(200);
    expect(saved).toMatchObject([{ categoryId: FOOD, amountSatang: null }]);
  });

  it.each(["plus", "ultimate"])("%s sets per-category budgets", async (p) => {
    plan = p;
    expect(
      (await put({ mode: "category", categories: [{ categoryId: FOOD, amount: "1500" }] })).status,
    ).toBe(200);
    expect(saved).toMatchObject([{ categoryId: FOOD, amountSatang: 150_000 }]);
  });
});

describe("PUT /api/budgets: the daily limit", () => {
  it.each(["plus", "ultimate"])("%s sets it", async (p) => {
    plan = p;
    expect((await put({ daily: "500" })).status).toBe(200);
    expect(modes[0]).toMatchObject({ user_id: "u1", daily_budget: "500.00" });
  });

  it("Free cannot set it but can clear one left from before", async () => {
    const res = await put({ daily: "500" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true });
    expect(modes).toHaveLength(0);

    expect((await put({ daily: null })).status).toBe(200);
    expect(modes[0]).toMatchObject({ daily_budget: null });
  });

  it("zero clears it and a bad amount is refused", async () => {
    plan = "plus";
    expect((await put({ daily: "0" })).status).toBe(200);
    expect(modes[0]).toMatchObject({ daily_budget: null });
    expect((await put({ daily: "abc" })).status).toBe(400);
  });
});

describe("PUT /api/budgets: limits", () => {
  it("is refused when sent too often, before anything is saved", async () => {
    limited = true;
    expect((await put({ mode: "overall", overall: "10000" })).status).toBe(429);
    expect(saved).toEqual([]);
  });

  it("refuses a body far larger than any real one", async () => {
    const res = await put({ mode: "overall", overall: "10000", junk: "x".repeat(200_000) });
    expect(res.status).toBe(400);
    expect(saved).toEqual([]);
  });
});
