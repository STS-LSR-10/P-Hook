import { beforeEach, describe, expect, it, vi } from "vitest";

const userUpdates: Record<string, unknown>[] = [];
const settingsUpserts: Record<string, unknown>[] = [];
let storedZone = "Asia/Bangkok";

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/repo", () => ({
  getSettings: async () => ({ confirm_style: "full" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { timezone: storedZone }, error: null }),
        update: (v: Record<string, unknown>) => {
          userUpdates.push(v);
          storedZone = String(v.timezone);
          return chain;
        },
        upsert: async (v: Record<string, unknown>) => {
          settingsUpserts.push(v);
          return { error: null };
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
      };
      return table === "users" || table === "user_settings" ? chain : chain;
    },
  }),
}));

import { GET, PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(
    new Request("https://x.test/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  );

beforeEach(() => {
  userUpdates.length = 0;
  settingsUpserts.length = 0;
  storedZone = "Asia/Bangkok";
});

describe("the time zone in settings", () => {
  it("is read with the settings", async () => {
    const body = await (await GET(new Request("https://x.test/api/settings"))).json();
    expect(body).toMatchObject({ confirm_style: "full", timezone: "Asia/Bangkok" });
  });

  it("is saved on the person, alone", async () => {
    const res = await patch({ timezone: "Asia/Tokyo" });
    expect(res.status).toBe(200);
    expect(userUpdates).toEqual([{ timezone: "Asia/Tokyo" }]);
    expect(settingsUpserts).toEqual([]);
    expect(await res.json()).toMatchObject({ timezone: "Asia/Tokyo" });
  });

  it("only one of the zones we list", async () => {
    expect((await patch({ timezone: "Mars/Olympus" })).status).toBe(400);
    expect(userUpdates).toEqual([]);
  });
});
