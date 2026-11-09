import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "ultimate";
let profile: { displayName?: string } | null = { displayName: "แอน" };
let lineFails = false;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "app-1", lineUserId: "U1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/plan-server", () => ({ getPlanInfo: async () => ({ plan }) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ LINE_CHANNEL_ACCESS_TOKEN: "t" }) }));
vi.mock("@/lib/line/client", () => ({
  createLineClient: () => ({
    getProfile: async () => {
      if (lineFails) throw new Error("network");
      return profile;
    },
  }),
}));

import { GET } from "./route";

const get = () => GET(new Request("http://x/api/group-open"));

beforeEach(() => {
  plan = "ultimate";
  profile = { displayName: "แอน" };
  lineFails = false;
});

describe("GET /api/group-open", () => {
  it("a friend on Elite can open the ledger", async () => {
    const body = await (await get()).json();
    expect(body).toMatchObject({ friend: true, plan: "ultimate", canOpen: true });
    expect(body.addFriendUrl).toBe("https://line.me/R/ti/p/%40964jamyy");
  });

  it("someone who is not a friend of the bot is told so (LINE gives no profile for them)", async () => {
    profile = null;
    expect(await (await get()).json()).toMatchObject({ friend: false, canOpen: true });
  });

  it("a friend on Free cannot open it; Starter and above can", async () => {
    plan = "free";
    expect(await (await get()).json()).toMatchObject({ friend: true, canOpen: false });
    for (const p of ["starter", "plus", "ultimate"]) {
      plan = p;
      expect(await (await get()).json()).toMatchObject({ canOpen: true });
    }
  });

  it("when LINE cannot be asked, friend is null (the page lets them try) instead of an error", async () => {
    lineFails = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).friend).toBeNull();
  });
});
