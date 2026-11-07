import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  estimateR2Usd,
  formatBytes,
  loadAiUsage,
  loadLineQuota,
  loadStorage,
} from "./dashboard-data";

const GB = 1024 ** 3;

/** A stand-in for the database client that serves `rows` in pages like the real API does. */
function fakeDb(rows: unknown[], fail = false): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: (from: number, to: number) =>
      Promise.resolve(
        fail
          ? { data: null, error: { message: "boom" } }
          : { data: rows.slice(from, to + 1), error: null },
      ),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

describe("estimateR2Usd", () => {
  it("is free under 10 GB and 1.5 cents per GB above it", () => {
    expect(estimateR2Usd(5 * GB)).toBe(0);
    expect(estimateR2Usd(10 * GB)).toBe(0);
    expect(estimateR2Usd(110 * GB)).toBeCloseTo(1.5, 5);
  });
});

describe("formatBytes", () => {
  it("scales the unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(250 * GB)).toBe("250 GB");
  });
});

describe("loadAiUsage", () => {
  it("sums per kind across people and reads every page", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      user_id: `u${i}`,
      kind: i % 2 === 0 ? "owl" : "router",
      used: 2,
    }));
    rows.push({ user_id: "u0", kind: "pdf", used: 0 });
    const result = await loadAiUsage(fakeDb(rows), "2026-11-01");
    expect(result).toEqual([
      { kind: "owl", used: 1500, users: 750 },
      { kind: "router", used: 1500, users: 750 },
    ]);
  });

  it("throws when the database fails", async () => {
    await expect(loadAiUsage(fakeDb([], true), "2026-11-01")).rejects.toThrow("usage counters");
  });
});

describe("loadStorage", () => {
  it("adds up bytes (bigint arrives as a string) and counts by status", async () => {
    const rows = [
      { size_bytes: "1000", status: "ready" },
      { size_bytes: 500, status: "ready" },
      { size_bytes: 20, status: "pending" },
    ];
    expect(await loadStorage(fakeDb(rows))).toEqual({
      readyFiles: 2,
      pendingFiles: 1,
      bytes: 1520,
      estimatedUsd: 0,
    });
  });
});

describe("loadLineQuota", () => {
  const reply = (body: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => body }) as Response;

  it("reads the cap and the usage", async () => {
    const fetchImpl = (async (url: string) =>
      url.endsWith("/consumption")
        ? reply({ totalUsage: 120 })
        : reply({ type: "limited", value: 300 })) as unknown as typeof fetch;
    expect(await loadLineQuota("t", fetchImpl)).toEqual({ type: "limited", limit: 300, used: 120 });
  });

  it("handles an uncapped plan", async () => {
    const fetchImpl = (async (url: string) =>
      url.endsWith("/consumption")
        ? reply({ totalUsage: 7 })
        : reply({ type: "none" })) as unknown as typeof fetch;
    expect(await loadLineQuota("t", fetchImpl)).toEqual({ type: "none", limit: null, used: 7 });
  });

  it("fails with the status only", async () => {
    const fetchImpl = (async () => reply({}, false, 401)) as unknown as typeof fetch;
    await expect(loadLineQuota("secret-token", fetchImpl)).rejects.toThrow("401");
    await expect(loadLineQuota("secret-token", fetchImpl)).rejects.not.toThrow(/secret-token/);
  });
});
