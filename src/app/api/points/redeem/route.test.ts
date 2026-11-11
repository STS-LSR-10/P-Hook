import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotEnoughPointsError } from "@/lib/points";

let broke = false;
const redeemed: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/points", async (original) => ({
  ...(await original<typeof import("@/lib/points")>()),
  redeemForPlus: async (_db: unknown, _u: string, pack: string) => {
    if (broke) throw new NotEnoughPointsError();
    redeemed.push(pack);
    return "2027-01-01T00:00:00Z";
  },
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("https://app.example.com/api/points/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  broke = false;
  redeemed.length = 0;
});

describe("POST /api/points/redeem", () => {
  it("sells the three packs at the server's prices", async () => {
    for (const [pack, coins, days] of [
      ["pass3", 35, 3],
      ["pass7", 75, 7],
      ["pass15", 150, 15],
    ] as const) {
      const res = await post({ pack });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ spent: coins, days });
    }
    expect(redeemed).toEqual(["pass3", "pass7", "pass15"]);
  });

  it("refuses anything that is not a pack (free-choice days, a price, nothing)", async () => {
    for (const body of [{ days: 30 }, { pack: "pass1" }, { pack: "pass3", coins: 1 }, null]) {
      const res = await post(body);
      // an extra field is ignored, the rest is refused
      expect(res.status).toBe(body && "coins" in body ? 200 : 400);
    }
    expect(redeemed).toEqual(["pass3"]);
  });

  it("says how many coins are needed when there are not enough", async () => {
    broke = true;
    const res = await post({ pack: "pass7" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("75");
  });
});
