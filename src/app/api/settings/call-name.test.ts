import { beforeEach, describe, expect, it, vi } from "vitest";

const upserts: Record<string, unknown>[] = [];
let locked = false;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/plan-server", () => ({
  requireFeature: async () => (locked ? new Response("{}", { status: 402 }) : null),
}));
vi.mock("@/lib/repo", () => ({ getSettings: async () => ({ confirm_style: "full" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: {}, error: null }),
        update: () => chain,
        upsert: async (v: Record<string, unknown>) => {
          upserts.push(v);
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));

import { PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(
    new Request("https://x.test/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  );

beforeEach(() => {
  upserts.length = 0;
  locked = false;
});

describe("the name the bot calls someone", () => {
  it("is saved trimmed", async () => {
    expect((await patch({ call_name: "  คุณบาส " })).status).toBe(200);
    expect(upserts).toEqual([{ user_id: "u1", call_name: "คุณบาส" }]);
  });

  it("blank or null clears it", async () => {
    await patch({ call_name: "   " });
    await patch({ call_name: null });
    expect(upserts.map((u) => u.call_name)).toEqual([null, null]);
  });

  it("longer than 20 letters is refused and nothing is saved", async () => {
    const res = await patch({ call_name: "ก".repeat(21) });
    expect(res.status).toBe(400);
    expect(upserts).toEqual([]);
  });

  it("setting one needs the plan that has manners; clearing one never does", async () => {
    locked = true;
    expect((await patch({ call_name: "บาส" })).status).toBe(402);
    expect(upserts).toEqual([]);
    expect((await patch({ call_name: null })).status).toBe(200);
    expect(upserts).toEqual([{ user_id: "u1", call_name: null }]);
  });
});
