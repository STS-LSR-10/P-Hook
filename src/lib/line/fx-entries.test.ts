import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ParsedEntry } from "@/lib/parse/text-parser";
import { runInZone } from "@/lib/zone-scope";

const asked: string[] = [];
vi.mock("@/lib/fx-repo", () => ({
  getHomeRate: async (_db: unknown, currency: string, _d: string, _t: string, home: string) => {
    asked.push(`${currency}>${home}`);
    return { rate: 0.5, sourceDay: "2026-11-02", stale: false };
  },
}));

import { convertForeignEntries } from "./fx-entries";

const entry = (currency: string, minor: number) =>
  ({
    amountSatang: minor,
    occurredAt: new Date("2026-11-03T03:00:00Z"),
    foreign: { currency, minor, supported: true },
  }) as unknown as ParsedEntry;
const deps = { db: {} as SupabaseClient, now: () => new Date("2026-11-03T03:00:00Z") };

describe("foreign amounts in the person's own currency", () => {
  it("are turned into it at the day's rate", async () => {
    asked.length = 0;
    const out = await runInZone(
      null,
      () => convertForeignEntries([entry("EUR", 1000)], deps),
      "USD",
    );
    expect(asked).toEqual(["EUR>USD"]);
    expect((out as ParsedEntry[])[0]).toMatchObject({ amountSatang: 500, fx: { currency: "EUR" } });
  });

  it("an amount already in it is not foreign", async () => {
    asked.length = 0;
    const out = await runInZone(
      null,
      () => convertForeignEntries([entry("USD", 1200)], deps),
      "USD",
    );
    expect(asked).toEqual([]);
    expect((out as ParsedEntry[])[0]).toMatchObject({ amountSatang: 1200, foreign: null });
  });
});
