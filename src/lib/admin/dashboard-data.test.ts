import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  daysBefore,
  formatBytes,
  loadAiCosts,
  loadFeedback,
  loadFeatureUses,
  loadLineUsage,
  loadR2Operations,
  loadStoredFiles,
  loadUsdThb,
  monthRange,
  scanBucket,
  type ListableBucket,
} from "./dashboard-data";
import { readAiPrices } from "./pricing";

/** A stand-in for the database client that serves `rows` in pages like the real API does. */
function fakeDb(rows: unknown[], fail = false, rpc?: unknown): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    lte: () => query,
    gte: () => query,
    limit: () => query,
    order: () => query,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ error: null }),
    range: (from: number, to: number) =>
      Promise.resolve(
        fail
          ? { data: null, error: { message: "boom" } }
          : { data: rows.slice(from, to + 1), error: null },
      ),
  };
  return {
    from: () => query,
    rpc: () =>
      Promise.resolve(
        fail ? { data: null, error: { message: "boom" } } : { data: rpc, error: null },
      ),
  } as unknown as SupabaseClient;
}

const reply = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

describe("monthRange / daysBefore / formatBytes", () => {
  it("gives the Bangkok month bounds, across a year end", () => {
    expect(monthRange("2026-11-01")).toEqual({
      from: "2026-11-01T00:00:00+07:00",
      to: "2026-12-01T00:00:00+07:00",
    });
    expect(monthRange("2026-12-01").to).toBe("2027-01-01T00:00:00+07:00");
  });

  it("lists the days before today", () => {
    expect(daysBefore("2026-11-01")).toEqual([]);
    expect(daysBefore("2026-11-03")).toEqual(["20261101", "20261102"]);
  });

  it("scales bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(250 * 1024 ** 3)).toBe("250 GB");
  });
});

describe("loadAiCosts", () => {
  const prices = { "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 } };

  it("prices each row, totals them and flags unknown models", async () => {
    const db = fakeDb([], false, [
      {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        feature: "owl",
        calls: "10",
        input_tokens: "1000000",
        output_tokens: "200000",
        first_at: "2026-11-02T01:00:00Z",
      },
      {
        provider: "anthropic",
        model: "claude-haiku-5-5",
        feature: "text",
        calls: 2,
        input_tokens: 100,
        output_tokens: 50,
        first_at: "2026-11-01T05:00:00Z",
      },
    ]);
    const result = await loadAiCosts(db, "2026-11-01", prices);
    expect(result.calls).toBe(12);
    expect(result.inputTokens).toBe(1_000_100);
    expect(result.outputTokens).toBe(200_050);
    expect(result.costUsd).toBeCloseTo(0.3 + 0.5, 6);
    expect(result.unpricedModels).toEqual(["claude-haiku-5-5"]);
    expect(result.firstAt).toBe("2026-11-01T05:00:00Z");
    expect(result.rows[0]?.model).toBe("gemini-3.5-flash-lite");
  });

  it("groups by model, pricing each model on its own and matching dated names", async () => {
    const db = fakeDb([], false, [
      {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        feature: "slip",
        calls: 1,
        input_tokens: 1_000_000,
        output_tokens: 0,
        first_at: "2026-11-02T00:00:00Z",
      },
      {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        feature: "owl",
        calls: 1,
        input_tokens: 1_000_000,
        output_tokens: 0,
        first_at: "2026-11-02T00:00:00Z",
      },
      {
        provider: "anthropic",
        model: "claude-sonnet-5-5-20261001",
        feature: "slip",
        calls: 3,
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        first_at: "2026-11-02T00:00:00Z",
      },
      {
        provider: "openai",
        model: "mystery",
        feature: "text",
        calls: 1,
        input_tokens: 5,
        output_tokens: 5,
        first_at: "2026-11-02T00:00:00Z",
      },
    ]);
    const { models, costUsd } = await loadAiCosts(db, "2026-11-01", readAiPrices({}));
    expect(models.map((m) => m.model)).toEqual([
      "claude-sonnet-5-5-20261001",
      "gemini-3.5-flash-lite",
      "mystery",
    ]);
    expect(models[0]).toMatchObject({ calls: 3, costUsd: 12 });
    expect(models[1]).toMatchObject({ calls: 2 });
    expect(models[1]?.costUsd).toBeCloseTo(0.6, 6);
    expect(models[2]).toMatchObject({ costUsd: null, price: null });
    expect(costUsd).toBeCloseTo(12.6, 6);
  });

  it("is empty for a month with no calls and throws when the database fails", async () => {
    expect((await loadAiCosts(fakeDb([], false, []), "2026-11-01", prices)).firstAt).toBeNull();
    await expect(loadAiCosts(fakeDb([], true), "2026-11-01", prices)).rejects.toThrow("ai usage");
  });
});

describe("loadFeatureUses", () => {
  it("sums per kind across people and reads every page", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      user_id: `u${i}`,
      kind: i % 2 === 0 ? "owl" : "router",
      used: 2,
    }));
    rows.push({ user_id: "u0", kind: "pdf", used: 0 });
    expect(await loadFeatureUses(fakeDb(rows), "2026-11-01")).toEqual([
      { kind: "owl", used: 1500, users: 750 },
      { kind: "router", used: 1500, users: 750 },
    ]);
  });
});

describe("loadLineUsage", () => {
  it("reads the quota and adds up every ready day of the month", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/message/quota")) return reply({ type: "limited", value: 300 });
      if (url.endsWith("/consumption")) return reply({ totalUsage: 11 });
      if (url.endsWith("20261101"))
        return reply({ status: "ready", apiReply: 40, apiPush: 5, chat: 1 });
      if (url.endsWith("20261102")) return reply({ status: "unready" });
      return reply({}, false, 500);
    }) as unknown as typeof fetch;
    expect(await loadLineUsage("t", "2026-11-04", fetchImpl)).toEqual({
      quotaType: "limited",
      quotaLimit: 300,
      quotaUsed: 11,
      sent: { total: 46, reply: 40, push: 5, other: 1, days: 1 },
    });
  });

  it("fails with the status only when the quota cannot be read", async () => {
    const fetchImpl = (async () => reply({}, false, 401)) as unknown as typeof fetch;
    await expect(loadLineUsage("secret-token", "2026-11-01", fetchImpl)).rejects.toThrow("401");
    await expect(loadLineUsage("secret-token", "2026-11-01", fetchImpl)).rejects.not.toThrow(
      /secret-token/,
    );
  });
});

describe("loadStoredFiles + scanBucket", () => {
  const stored = fakeDb([
    { r2_key: "u1/a.jpg", size_bytes: "1000", status: "ready" },
    { r2_key: "u1/b.pdf", size_bytes: 500, status: "ready" },
    { r2_key: "u2/c.mp4", size_bytes: 20, status: "pending" },
  ]);

  function bucket(objects: { key: string; size: number }[], pageSize = 2): ListableBucket {
    return {
      async list({ cursor }) {
        const start = cursor ? Number(cursor) : 0;
        const page = objects.slice(start, start + pageSize);
        const next = start + pageSize;
        return {
          objects: page,
          truncated: next < objects.length,
          cursor: next < objects.length ? String(next) : undefined,
        };
      },
    };
  }

  it("counts files by status and keeps their keys", async () => {
    const files = await loadStoredFiles(stored);
    expect(files.readyFiles).toBe(2);
    expect(files.pendingFiles).toBe(1);
    expect(files.bytes).toBe(1520);
    expect(files.keys.get("u2/c.mp4")).toBe("pending");
  });

  it("finds objects left behind and files missing from the bucket; previews belong to their file", async () => {
    const files = await loadStoredFiles(stored);
    const scan = await scanBucket(
      bucket([
        { key: "u1/a.jpg", size: 1000 },
        { key: "u1/a.jpg.thumb", size: 30 },
        { key: "u2/c.mp4", size: 20 },
        { key: "old/gone.png", size: 700 },
        { key: "old/gone.png.thumb", size: 10 },
      ]),
      files.keys,
    );
    expect(scan).toEqual({
      objects: 5,
      bytes: 1760,
      orphanObjects: 2,
      orphanBytes: 710,
      missingFiles: 1, // u1/b.pdf
      truncated: false,
    });
  });

  it("stops at the limit and then does not claim missing files", async () => {
    const objects = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, size: 1 }));
    const scan = await scanBucket(bucket(objects), new Map([["x", "ready"]]), 4);
    expect(scan.truncated).toBe(true);
    expect(scan.objects).toBe(4);
    expect(scan.missingFiles).toBe(0);
  });
});

describe("loadR2Operations", () => {
  it("splits operations into class A, B and free", async () => {
    let sent: { variables?: Record<string, string> } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return reply({
        data: {
          viewer: {
            accounts: [
              {
                r2OperationsAdaptiveGroups: [
                  { sum: { requests: 100 }, dimensions: { actionType: "PutObject" } },
                  { sum: { requests: 900 }, dimensions: { actionType: "GetObject" } },
                  { sum: { requests: 50 }, dimensions: { actionType: "ListObjects" } },
                  { sum: { requests: 7 }, dimensions: { actionType: "DeleteObject" } },
                ],
              },
            ],
          },
        },
        errors: null,
      });
    }) as unknown as typeof fetch;
    const ops = await loadR2Operations(
      "acc",
      "tok",
      "2026-11-01T00:00:00+07:00",
      "2026-12-01T00:00:00+07:00",
      fetchImpl,
    );
    expect(ops).toMatchObject({ classA: 150, classB: 900, free: 7 });
    expect(sent.variables).toEqual({
      accountTag: "acc",
      start: "2026-10-31T17:00:00.000Z",
      end: "2026-11-30T17:00:00.000Z",
    });
  });

  it("throws on a GraphQL error", async () => {
    const fetchImpl = (async () =>
      reply({ data: null, errors: [{ message: "not authorized" }] })) as unknown as typeof fetch;
    await expect(loadR2Operations("a", "t", "2026-11-01", "2026-12-01", fetchImpl)).rejects.toThrow(
      "not authorized",
    );
  });
});

describe("loadUsdThb", () => {
  it("falls back to USD_THB_RATE when no rate can be found, else null", async () => {
    const db = fakeDb([]);
    const offline = (async () => reply({}, false, 503)) as unknown as typeof fetch;
    const realFetch = globalThis.fetch;
    globalThis.fetch = offline;
    try {
      expect(await loadUsdThb(db, "2026-11-07", "32.5")).toEqual({
        rate: 32.5,
        source: "USD_THB_RATE",
      });
      expect(await loadUsdThb(db, "2026-11-07", undefined)).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("loadFeedback", () => {
  const dbOf = (rows: unknown[], fail = false) => {
    const seen: unknown[] = [];
    const query = {
      select: () => query,
      order: (...a: unknown[]) => (seen.push(a), query),
      limit: (n: number) =>
        Promise.resolve(
          fail
            ? { data: null, error: { message: "boom" } }
            : { data: rows.slice(0, n), error: null },
        ),
    };
    return { db: { from: () => query } as unknown as SupabaseClient, seen };
  };

  it("lists the newest first with who sent it, their plan and where it came from", async () => {
    const { db, seen } = dbOf([
      {
        id: "f1",
        body: "อยากให้มีโหมดมืด",
        plan: "plus",
        source: "line",
        created_at: "2026-11-08T03:00:00Z",
        users: { display_name: "สมชาย" },
      },
      {
        id: "f2",
        body: "ขอส่งออก PDF",
        plan: "free",
        source: "app",
        created_at: "2026-11-07T03:00:00Z",
        users: null,
      },
    ]);
    expect(await loadFeedback(db)).toEqual([
      {
        id: "f1",
        body: "อยากให้มีโหมดมืด",
        plan: "plus",
        source: "line",
        createdAt: "2026-11-08T03:00:00Z",
        name: "สมชาย",
      },
      {
        id: "f2",
        body: "ขอส่งออก PDF",
        plan: "free",
        source: "app",
        createdAt: "2026-11-07T03:00:00Z",
        name: null,
      },
    ]);
    expect(seen).toEqual([["created_at", { ascending: false }]]);
  });

  it("fails loudly when the database does", async () => {
    await expect(loadFeedback(dbOf([], true).db)).rejects.toThrow(/feedback/);
  });
});
