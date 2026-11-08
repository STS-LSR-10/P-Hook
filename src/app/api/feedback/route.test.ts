import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: unknown[] = [];
let allowed = true;
const rateCalls: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "app-1", lineUserId: "U1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/plan-server", () => ({ getPlanInfo: async () => ({ plan: "ultimate" }) }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async (_db: unknown, bucket: string, subject: string) => {
    rateCalls.push(`${bucket}:${subject}`);
    return allowed ? null : new Response("{}", { status: 429 });
  },
}));
vi.mock("@/lib/feedback-repo", () => ({
  addFeedback: async (_db: unknown, input: unknown) => void saved.push(input),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  saved.length = 0;
  rateCalls.length = 0;
  allowed = true;
});

describe("POST /api/feedback", () => {
  it("saves a suggestion from the app with the sender's plan, sharing the chat's daily limit", async () => {
    const res = await post({ body: "  อยากให้มีโหมดมืด " });
    expect(res.status).toBe(200);
    expect(saved).toEqual([
      { userId: "app-1", plan: "ultimate", body: "อยากให้มีโหมดมืด", source: "app" },
    ]);
    expect(rateCalls).toEqual(["feedback_day:U1"]);
  });
  it("refuses an empty or a too long one", async () => {
    expect((await post({ body: "   " })).status).toBe(400);
    expect((await post({ body: "ก".repeat(1001) })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(saved).toEqual([]);
  });
  it("stops at the daily limit", async () => {
    allowed = false;
    expect((await post({ body: "อีกข้อ" })).status).toBe(429);
    expect(saved).toEqual([]);
  });
});
