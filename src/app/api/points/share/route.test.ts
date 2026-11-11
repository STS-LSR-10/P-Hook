import { beforeEach, describe, expect, it, vi } from "vitest";

let paid = true;
let limited = false;
const calls: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => (limited ? new Response("{}", { status: 429 }) : null),
}));
vi.mock("@/lib/points", () => ({
  awardShare: async (_db: unknown, userId: string) => {
    calls.push(userId);
    return paid;
  },
}));

import { POST } from "./route";

const post = () =>
  POST(new Request("https://app.example.com/api/points/share", { method: "POST" }));

beforeEach(() => {
  paid = true;
  limited = false;
  calls.length = 0;
});

describe("POST /api/points/share", () => {
  it("says how many coins the first share of the month paid", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ awarded: true, coins: 3 });
    expect(calls).toEqual(["u1"]);
  });

  it("pays nothing the second time in a month", async () => {
    paid = false;
    expect(await (await post()).json()).toEqual({ awarded: false, coins: 0 });
  });

  it("is rate limited before it touches the ledger", async () => {
    limited = true;
    expect((await post()).status).toBe(429);
    expect(calls).toEqual([]);
  });
});
