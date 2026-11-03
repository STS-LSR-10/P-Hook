import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCategoryCompare,
  loadCategorySpend,
  loadForecastInput,
  loadSummaryData,
  loadYearData,
} from "./summary-load";
import { resolveYear } from "./year-summary";

let rules: Record<string, unknown>[] = [];
let budgetMode: "overall" | "category" = "overall";
let budgetRows: { id: string; category_id: string | null; amount: string }[] = [];
vi.mock("@/lib/recurring-repo", () => ({ listRules: async () => rules }));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  getBudgetMode: async () => budgetMode,
  loadBudgets: async () => budgetRows,
}));

const range = {
  from: new Date("2026-10-01T00:00:00+07:00"),
  to: new Date("2026-10-16T00:00:00+07:00"),
};
const previous = { from: new Date("2026-09-16T00:00:00+07:00"), to: range.from };

function fakeDb(categories: { name: string; total: string }[], fail = false) {
  const rpc = vi.fn(async (name: string, args: { p_from: string }) => {
    if (name === "summary_by_period") {
      const isCurrent = args.p_from === range.from.toISOString();
      return {
        data: [
          isCurrent
            ? { income: "1000.00", expense: "400.00", tx_count: 5 }
            : { income: "0", expense: "200.00", tx_count: 2 },
        ],
        error: null,
      };
    }
    if (fail) return { data: null, error: { message: "boom" } };
    return { data: categories, error: null };
  });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe("loadSummaryData", () => {
  it("adds up both periods in the database and keeps the three biggest expense categories", async () => {
    const { db, rpc } = fakeDb([
      { name: "ไม่ระบุหมวด", total: "20.00" },
      { name: "อาหาร", total: "200.00" },
      { name: "เดินทาง", total: "120.00" },
      { name: "ช้อปปิ้ง", total: "60.00" },
    ]);
    const data = await loadSummaryData(db, "u1", range, previous);
    expect(data.current).toEqual({ income: 100_000, expense: 40_000, count: 5 });
    expect(data.previous).toEqual({ income: 0, expense: 20_000, count: 2 });
    expect(data.topExpenses).toEqual([
      { name: "อาหาร", amountSatang: 20_000, percent: 50 },
      { name: "เดินทาง", amountSatang: 12_000, percent: 30 },
      { name: "ช้อปปิ้ง", amountSatang: 6_000, percent: 15 },
    ]);
    // totals for the current period, totals for the previous one, and the category split
    expect(rpc.mock.calls.map((c) => c[0]).sort()).toEqual([
      "spend_by_category",
      "summary_by_period",
      "summary_by_period",
    ]);
  });

  it("has no categories when nothing was spent", async () => {
    const data = await loadSummaryData(fakeDb([]).db, "u1", range, previous);
    expect(data.topExpenses).toEqual([]);
  });

  it("fails loudly when the category query fails", async () => {
    await expect(loadSummaryData(fakeDb([], true).db, "u1", range, previous)).rejects.toThrow(
      "load category totals: boom",
    );
  });
});

describe("loadCategorySpend", () => {
  it("returns every category with its exact satang, biggest first", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { name: "เดินทาง", total: "120.50", icon: "bus" },
        { name: "ค่าอาหารแมว", total: "300.00", icon: "🐱" },
      ],
      error: null,
    }));
    const out = await loadCategorySpend({ rpc } as unknown as SupabaseClient, "u1", range);
    expect(out).toEqual([
      { name: "ค่าอาหารแมว", amountSatang: 30_000, icon: "🐱" },
      { name: "เดินทาง", amountSatang: 12_050, icon: "bus" },
    ]);
    expect(rpc).toHaveBeenCalledWith("spend_by_category", {
      p_user: "u1",
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_type: "expense",
    });
  });

  it("throws on a database error", async () => {
    const rpc = async () => ({ data: null, error: { message: "boom" } });
    await expect(
      loadCategorySpend({ rpc } as unknown as SupabaseClient, "u1", range),
    ).rejects.toThrow("load category spend: boom");
  });
});

describe("loadYearData", () => {
  it("returns the year's totals and one entry per month so far, zero where nothing happened", async () => {
    const year = resolveYear(null, new Date("2026-03-10T05:00:00Z"));
    if (!year.ok) throw new Error("year");
    const rpc = vi.fn(async (name: string, args: Record<string, string>) => {
      if (name === "analytics_series") {
        return {
          data: [
            { bucket_start: "2025-12-31T17:00:00Z", income: "1000.00", expense: "400.00" }, // Jan
            { bucket_start: "2026-02-28T17:00:00Z", income: "0", expense: "250.50" }, // Mar
          ],
          error: null,
        };
      }
      if (name === "summary_by_period") {
        return { data: [{ income: "1000.00", expense: "650.50", tx_count: 6 }], error: null };
      }
      void args;
      return { data: [{ name: "อาหาร", total: "300.00" }], error: null };
    });
    const data = await loadYearData({ rpc } as unknown as SupabaseClient, "u1", year);
    expect(data.summary.current).toEqual({ income: 100_000, expense: 65_050, count: 6 });
    expect(data.months.map((m) => [m.incomeSatang, m.expenseSatang])).toEqual([
      [100_000, 40_000],
      [0, 0], // February: no row
      [0, 25_050],
    ]);
    const series = rpc.mock.calls.find((c) => c[0] === "analytics_series")![1];
    // the chart's buckets are in the zone of the request, the same one the app counts in
    expect(series).toMatchObject({ p_bucket: "month", p_user: "u1", p_tz: "Asia/Bangkok" });
  });

  it("throws when the monthly query fails", async () => {
    const year = resolveYear(null, new Date("2026-03-10T05:00:00Z"));
    if (!year.ok) throw new Error("year");
    const rpc = async (name: string) => {
      if (name === "analytics_series") return { data: null, error: { message: "boom" } };
      if (name === "spend_by_category") return { data: [], error: null };
      return { data: [{ income: "0", expense: "0", tx_count: 0 }], error: null };
    };
    await expect(loadYearData({ rpc } as unknown as SupabaseClient, "u1", year)).rejects.toThrow(
      "load monthly totals: boom",
    );
  });
});

describe("loadCategoryCompare", () => {
  it("compares the two spans category by category and adds up each side", async () => {
    const rpc = vi.fn(async (_name: string, args: { p_from: string }) => ({
      data:
        args.p_from === range.from.toISOString()
          ? [{ name: "อาหาร", total: "150.00" }]
          : [
              { name: "อาหาร", total: "100.00" },
              { name: "เดินทาง", total: "40.00" },
            ],
      error: null,
    }));
    const out = await loadCategoryCompare(
      { rpc } as unknown as SupabaseClient,
      "u1",
      range,
      previous,
    );
    expect(out.currentSatang).toBe(15_000);
    expect(out.previousSatang).toBe(14_000);
    expect(out.rows.map((r) => [r.name, r.kind])).toEqual([
      ["อาหาร", "up"],
      ["เดินทาง", "gone"],
    ]);
  });
});

describe("loadForecastInput", () => {
  const NOW = new Date("2026-10-17T08:00:00Z"); // 17 Oct 2026 in Bangkok
  const cycle = { from: new Date("2026-09-30T17:00:00Z"), to: new Date("2026-10-31T17:00:00Z") };
  const calls: { from: string; to: string }[] = [];

  function db() {
    const rpc = vi.fn(async (name: string, args: { p_from: string; p_to: string }) => {
      if (name !== "period_totals_by_source")
        return { data: null, error: { message: "unexpected" } };
      calls.push({ from: args.p_from, to: args.p_to });
      // the cycle so far is asked first, the last seven days second (the windows can coincide)
      const week = calls.length === 2;
      return {
        data: [
          week
            ? {
                income: "0",
                expense: "700.00",
                recurring_income: "0",
                recurring_expense: "0",
                tx_count: 7,
              }
            : {
                income: "30000.00",
                expense: "16000.00",
                recurring_income: "30000.00",
                recurring_expense: "5000.00",
                tx_count: 21,
              },
        ],
        error: null,
      };
    });
    return { db: { rpc } as unknown as SupabaseClient, rpc };
  }

  beforeEach(() => {
    calls.length = 0;
    rules = [];
    budgetMode = "overall";
    budgetRows = [];
  });

  it("reads the cycle so far (to the end of today) and the last seven days", async () => {
    const out = await loadForecastInput(db().db, "u1", NOW, cycle);
    expect(out.incomeSatang).toBe(3_000_000);
    expect(out.expenseSatang).toBe(1_600_000);
    expect(out.recurringExpenseSatang).toBe(500_000);
    expect(out.entryCount).toBe(21);
    expect(out.last7VariableSatang).toBe(70_000);
    // the cycle so far ends at the start of tomorrow, the week starts six days before today
    expect(calls[0]).toEqual({ from: cycle.from.toISOString(), to: "2026-10-17T17:00:00.000Z" });
    expect(calls[1]).toEqual({ from: "2026-10-10T17:00:00.000Z", to: "2026-10-17T17:00:00.000Z" });
  });

  it("early in a cycle the short window is scaled up to a week", async () => {
    const out = await loadForecastInput(db().db, "u1", new Date("2026-10-02T05:00:00Z"), cycle);
    // 2 days of data (1 and 2 Oct) -> 700 over 2 days = 2,450 over 7
    expect(out.last7VariableSatang).toBe(245_000);
  });

  it("brings in the recurring rules that are still to come", async () => {
    rules = [
      {
        type: "income",
        amount: "30000.00",
        title: "เงินเดือน",
        cadence: "monthly",
        day_of_period: 25,
        next_run_at: "2026-10-24T17:00:00Z",
        is_active: true,
      },
      {
        type: "expense",
        amount: "999.00",
        title: "ปิดอยู่",
        cadence: "monthly",
        day_of_period: 28,
        next_run_at: "2026-10-27T17:00:00Z",
        is_active: false,
      },
    ];
    const out = await loadForecastInput(db().db, "u1", NOW, cycle);
    expect(out.upcoming.map((o) => [o.title, o.amountSatang])).toEqual([["เงินเดือน", 3_000_000]]);
  });

  it("uses the overall budget only when the person budgets overall", async () => {
    budgetRows = [
      { id: "b1", category_id: null, amount: "20000.00" },
      { id: "b2", category_id: "c1", amount: "3000.00" },
    ];
    expect((await loadForecastInput(db().db, "u1", NOW, cycle)).budgetSatang).toBe(2_000_000);
    budgetMode = "category";
    expect((await loadForecastInput(db().db, "u1", NOW, cycle)).budgetSatang).toBeNull();
  });

  it("throws when the database says no", async () => {
    const rpc = async () => ({ data: null, error: { message: "boom" } });
    await expect(
      loadForecastInput({ rpc } as unknown as SupabaseClient, "u1", NOW, cycle),
    ).rejects.toThrow("load totals by source: boom");
  });
});
