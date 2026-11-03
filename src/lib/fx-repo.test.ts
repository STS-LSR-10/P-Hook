import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getHomeRate, getRate } from "./fx-repo";

interface Row {
  day: string;
  currency: string;
  rate: number;
  source_day: string;
}

/** Just enough of the query builder for fx_rates. */
function fakeDb(rows: Row[]) {
  const upserts: Row[] = [];
  const db = {
    from: () => {
      const filters: { eq: Record<string, string>; lte?: string; gte?: string } = { eq: {} };
      let ordered = false;
      const run = () =>
        rows
          .filter(
            (r) =>
              Object.entries(filters.eq).every(([k, v]) => String(r[k as keyof Row]) === v) &&
              (!filters.lte || r.day <= filters.lte) &&
              (!filters.gte || r.day >= filters.gte),
          )
          .sort((a, b) => (ordered ? b.day.localeCompare(a.day) : 0));
      const chain = {
        select: () => chain,
        eq: (k: string, v: string) => ((filters.eq[k] = v), chain),
        lte: (_k: string, v: string) => ((filters.lte = v), chain),
        gte: (_k: string, v: string) => ((filters.gte = v), chain),
        order: () => ((ordered = true), chain),
        limit: () => chain,
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        upsert: async (row: Row) => (upserts.push(row), { error: null }),
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, upserts };
}

const answer = (rate: number, date = "2026-10-16") =>
  vi.fn(
    async () =>
      ({ ok: true, json: async () => ({ date, rates: { THB: rate } }) }) as unknown as Response,
  ) as unknown as typeof fetch;
const down = vi.fn(async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

describe("getRate", () => {
  it("uses the cached rate without asking the source", async () => {
    const { db } = fakeDb([
      { day: "2026-10-17", currency: "JPY", rate: 0.2335, source_day: "2026-10-16" },
    ]);
    const f = answer(9);
    expect(await getRate(db, "JPY", "2026-10-17", "2026-10-18", f)).toEqual({
      rate: 0.2335,
      sourceDay: "2026-10-16",
      stale: false,
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("asks the source once, then keeps the answer", async () => {
    const { db, upserts } = fakeDb([]);
    const got = await getRate(db, "USD", "2026-10-17", "2026-10-18", answer(35.5));
    expect(got).toEqual({ rate: 35.5, sourceDay: "2026-10-16", stale: false });
    expect(upserts).toEqual([
      { day: "2026-10-17", currency: "USD", rate: 35.5, source_day: "2026-10-16" },
    ]);
  });

  it("today (or later) asks for the latest rate", async () => {
    const { db } = fakeDb([]);
    const f = answer(35.5);
    await getRate(db, "USD", "2026-10-18", "2026-10-18", f);
    expect(vi.mocked(f).mock.calls[0]?.[0]).toContain("/v1/latest?");
  });

  it("when the source is down, uses a rate from the last 7 days and says so", async () => {
    const { db } = fakeDb([
      { day: "2026-10-14", currency: "JPY", rate: 0.23, source_day: "2026-10-14" },
    ]);
    expect(await getRate(db, "JPY", "2026-10-17", "2026-10-18", down)).toEqual({
      rate: 0.23,
      sourceDay: "2026-10-14",
      stale: true,
    });
  });

  it("with nothing recent and the source down, there is no rate", async () => {
    const { db } = fakeDb([
      { day: "2026-09-01", currency: "JPY", rate: 0.23, source_day: "2026-09-01" },
    ]);
    expect(await getRate(db, "JPY", "2026-10-17", "2026-10-18", down)).toBeNull();
    expect(await getRate(db, "USD", "2026-10-17", "2026-10-18", down)).toBeNull();
  });
});

describe("getHomeRate: the price of a currency in the person's own", () => {
  const cached: Row[] = [
    { day: "2026-10-17", currency: "JPY", rate: 0.25, source_day: "2026-10-16" },
    { day: "2026-10-17", currency: "USD", rate: 35, source_day: "2026-10-16" },
  ];

  it("is the baht price when their books are in baht", async () => {
    const { db } = fakeDb(cached);
    expect((await getHomeRate(db, "JPY", "2026-10-17", "2026-10-18", "THB", down))?.rate).toBe(
      0.25,
    );
  });

  it("crosses through the baht for another home currency", async () => {
    const { db } = fakeDb(cached);
    // 1 JPY = 0.25 THB, 1 USD = 35 THB -> 1 JPY = 0.25 / 35 USD
    const r = await getHomeRate(db, "JPY", "2026-10-17", "2026-10-18", "USD", down);
    expect(r?.rate).toBeCloseTo(0.25 / 35, 10);
    expect(r?.stale).toBe(false);
    // the baht itself is foreign to a dollar book: 1 THB = 1/35 USD
    expect(
      (await getHomeRate(db, "THB", "2026-10-17", "2026-10-18", "USD", down))?.rate,
    ).toBeCloseTo(1 / 35, 10);
  });

  it("is 1 for their own currency, and nothing when a side has no rate", async () => {
    const { db } = fakeDb(cached);
    expect((await getHomeRate(db, "USD", "2026-10-17", "2026-10-18", "USD", down))?.rate).toBe(1);
    expect(await getHomeRate(db, "EUR", "2026-10-17", "2026-10-18", "USD", down)).toBeNull();
  });
});
