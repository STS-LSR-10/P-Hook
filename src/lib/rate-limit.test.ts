import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { clientIp, hashKey, limitOr429, rateLimit } from "./rate-limit";

function fakeDb(result: { data?: unknown; error?: { message: string } }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const RULE = { limit: 3, windowSeconds: 60 };

describe("hashKey", () => {
  it("is stable, short and hides the input", () => {
    expect(hashKey("U123")).toBe(hashKey("U123"));
    expect(hashKey("U123")).not.toBe(hashKey("U124"));
    expect(hashKey("U123")).toHaveLength(24);
    expect(hashKey("U123")).not.toContain("U123");
  });
});

describe("rateLimit", () => {
  it("allows a hit within the limit and sends a hashed key", async () => {
    const { db, rpc } = fakeDb({ data: [{ is_allowed: true, hits_in_window: 2 }] });
    expect(await rateLimit(db, "chat", "Uabc", RULE)).toEqual({ allowed: true, hits: 2, limit: 3 });
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args.p_key).toBe(`chat:${hashKey("Uabc")}`);
    expect(String(args.p_key)).not.toContain("Uabc");
    expect(args.p_limit).toBe(3);
    expect(args.p_window_seconds).toBe(60);
  });

  it("blocks once over the limit", async () => {
    const { db } = fakeDb({ data: [{ is_allowed: false, hits_in_window: 4 }] });
    expect(await rateLimit(db, "chat", "Uabc", RULE)).toMatchObject({ allowed: false, hits: 4 });
  });

  it("fails OPEN when the limiter errors (e.g. migration not applied)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ error: { message: "function check_rate_limit does not exist" } });
    expect((await rateLimit(db, "chat", "Uabc", RULE)).allowed).toBe(true);
    quiet.mockRestore();
  });

  it("fails open on an empty response too", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ data: [] });
    expect((await rateLimit(db, "chat", "Uabc", RULE)).allowed).toBe(true);
    quiet.mockRestore();
  });
});

describe("limitOr429", () => {
  it("returns null when allowed and a polite 429 when not", async () => {
    const ok = fakeDb({ data: [{ is_allowed: true, hits_in_window: 1 }] });
    expect(await limitOr429(ok.db, "x", "u", RULE)).toBeNull();

    const blocked = fakeDb({ data: [{ is_allowed: false, hits_in_window: 9 }] });
    const res = await limitOr429(blocked.db, "x", "u", RULE);
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("60");
    expect(((await res?.json()) as { error: string }).error).toContain("ถี่เกินไป");
  });
});

describe("clientIp", () => {
  it("prefers cf-connecting-ip, which a visitor cannot write", () => {
    const req = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "5.6.7.8", "x-forwarded-for": "1.2.3.4" },
    });
    expect(clientIp(req)).toBe("5.6.7.8");
  });

  it("uses the first x-forwarded-for hop", () => {
    const req = new Request("https://x.test", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(new Request("https://x.test", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe(
      "9.9.9.9",
    );
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
