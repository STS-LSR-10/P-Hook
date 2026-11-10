import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "plus";
let mode: "overall" | "category" = "overall";
let budgets: { category_id: string | null; amount: string }[] = [];
const periods: { from: string; to: string }[] = [];
const recentFilters: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/plan-server", () => ({
  getPlanInfo: async () => ({ plan, expiresAt: null }),
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  getSettings: async () => ({ budget_cycle: "monthly", cycle_start_day: 1 }),
  getBudgetMode: async () => mode,
  loadBudgets: async () => budgets,
  loadCategories: async () => [
    { id: "food", name: "อาหาร", color: "#0F766E", icon: "utensils", type: "expense" },
    { id: "trip", name: "เดินทาง", color: null, type: "expense" },
  ],
  periodSummary: async (_db: unknown, i: { from: Date; to: Date }) => {
    periods.push({ from: i.from.toISOString(), to: i.to.toISOString() });
    // the all-time call starts at the epoch
    return i.from.getTime() === 0
      ? { incomeSatang: 5_000_000, expenseSatang: 1_500_000, count: 9 }
      : { incomeSatang: 2_000_000, expenseSatang: 750_000, count: 3 };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, name: string) => {
            if (name === "then") {
              return (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
            }
            return (col?: string) => {
              if (name === "gte" || name === "lt") recentFilters.push(`${name}:${String(col)}`);
              return q;
            };
          },
        },
      );
      return q;
    },
    rpc: async () => ({
      data: [
        { category_id: "trip", total: "250.00" },
        { category_id: "food", total: "500.00" },
        { category_id: null, total: "0" },
      ],
      error: null,
    }),
  }),
}));

import { GET } from "./route";

const get = async (qs = "") =>
  (await GET(new Request(`https://x/api/summary${qs}`))).json() as Promise<Record<string, unknown>>;

beforeEach(() => {
  plan = "plus";
  mode = "overall";
  budgets = [];
  periods.length = 0;
  recentFilters.length = 0;
});

describe("GET /api/summary", () => {
  it("carries the balance kept up to the end of the period", async () => {
    const body = await get();
    expect(body.balanceSatang).toBe(1_250_000);
    expect(body.accumulatedSatang).toBe(3_500_000);
    expect(body.offset).toBe(0);
  });

  it("offset steps back whole cycles; the range ends where the next one starts", async () => {
    const now = await get();
    const back = await get("?offset=-1");
    const nowRange = now.range as { from: string };
    const backRange = back.range as { from: string; to: string };
    expect(backRange.to).toBe(nowRange.from);
    expect(back.offset).toBe(-1);
    expect(recentFilters).toEqual(["gte:occurred_at", "lt:occurred_at"]); // recent entries stay inside it
  });

  it("an offset outside what is allowed (forward, far back, not a number) is clamped", async () => {
    expect((await get("?offset=3")).offset).toBe(0);
    expect((await get("?offset=-99")).offset).toBe(-24);
    expect((await get("?offset=abc")).offset).toBe(0);
  });

  it("budget: the overall amount, or the sum of the category amounts, or none", async () => {
    expect((await get()).budgetSatang).toBeNull();
    budgets = [
      { category_id: null, amount: "8000.00" },
      { category_id: "food", amount: "3000.00" },
    ];
    expect((await get()).budgetSatang).toBe(800_000);
    mode = "category";
    expect((await get()).budgetSatang).toBe(300_000);
  });

  it("categories (Pro and above): biggest first, empty ones dropped, names and colours filled in", async () => {
    const body = await get();
    expect(body.categories).toEqual([
      {
        categoryId: "food",
        name: "อาหาร",
        color: "#0F766E",
        icon: "utensils",
        totalSatang: 50_000,
      },
      { categoryId: "trip", name: "เดินทาง", color: null, icon: null, totalSatang: 25_000 },
    ]);
  });

  it("Free gets no category breakdown (null) but still the totals", async () => {
    plan = "free";
    const body = await get();
    expect(body.categories).toBeNull();
    expect(body.expenseSatang).toBe(750_000);
  });
});
