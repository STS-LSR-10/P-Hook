import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/lib/wallet";

let plan = "plus";
let wallets: Wallet[] = [];
let memberRows: { userId: string; name: string; role: "owner" | "member" }[] = [];
let redeemResult: unknown = { ok: true, wallet: { id: "ws", name: "กองกลาง", ownerId: "owner-1" } };
let limited = false;
const invites: string[] = [];
const removed: { walletId: string; userId: string }[] = [];
const WS = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";
let me = OWNER;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: me, lineUserId: "U1" }),
}));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async (_db: unknown, bucket: string) =>
    limited && bucket === "join_wallet"
      ? Response.json({ error: "ช้าลงหน่อย" }, { status: 429 })
      : null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/wallet-repo", () => ({
  ensureWallets: async () => wallets,
  listWallets: async () => wallets,
}));
vi.mock("@/lib/shared-wallet-repo", () => ({
  membersOf: async () => memberRows,
  createInvite: async (_db: unknown, walletId: string) => {
    invites.push(walletId);
    return { code: "482913", expiresAt: new Date("2026-10-19T05:00:00Z") };
  },
  removeMember: async (_db: unknown, walletId: string, userId: string) => {
    removed.push({ walletId, userId });
    return true;
  },
  redeemInvite: async () => redeemResult,
}));

import { POST as INVITE } from "./[id]/invite/route";
import { DELETE as REMOVE } from "./[id]/members/[userId]/route";
import { POST as JOIN } from "./join/route";

const sharedWallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: WS,
  name: "กองกลาง",
  kind: "bank",
  isDefault: false,
  openingSatang: 0,
  incomeSatang: 0,
  expenseSatang: 0,
  transferInSatang: 0,
  transferOutSatang: 0,
  debtInSatang: 0,
  debtOutSatang: 0,
  entryCount: 0,
  creditLimitSatang: null,
  statementDay: null,
  dueDay: null,
  shared: true,
  ownerId: OWNER,
  memberCount: 1,
  ...over,
});
const req = (body?: unknown) =>
  new Request("https://app.example.com/api/wallets/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ id: WS }) };
const memberParams = (userId: string) => ({ params: Promise.resolve({ id: WS, userId }) });

beforeEach(() => {
  plan = "plus";
  me = OWNER;
  wallets = [sharedWallet()];
  memberRows = [{ userId: OWNER, name: "แอน", role: "owner" }];
  redeemResult = { ok: true, wallet: { id: "ws", name: "กองกลาง", ownerId: OWNER } };
  limited = false;
  invites.length = 0;
  removed.length = 0;
});

describe("POST /api/wallets/:id/invite", () => {
  it("the owner gets a code", async () => {
    const res = await INVITE(req(), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      code: "482913",
      expiresAt: "2026-10-19T05:00:00.000Z",
    });
    expect(invites).toEqual([WS]);
  });

  it("not for Free, not for a member who is not the owner, not for a private wallet", async () => {
    plan = "free";
    expect((await INVITE(req(), params)).status).toBe(403);
    plan = "plus";
    me = BOB;
    wallets = [sharedWallet({ ownerId: OWNER })];
    expect((await INVITE(req(), params)).status).toBe(403);
    me = OWNER;
    wallets = [sharedWallet({ shared: false })];
    expect((await INVITE(req(), params)).status).toBe(404);
    expect(invites).toHaveLength(0);
  });

  it("no invite when the wallet is full for the owner's plan", async () => {
    memberRows = [
      { userId: OWNER, name: "แอน", role: "owner" },
      { userId: BOB, name: "บ๊อบ", role: "member" },
    ];
    plan = "starter";
    const res = await INVITE(req(), params); // Starter: 2 people
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true });
    plan = "ultimate";
    expect((await INVITE(req(), params)).status).toBe(201);
  });
});

describe("DELETE /api/wallets/:id/members/:userId", () => {
  beforeEach(() => {
    memberRows = [
      { userId: OWNER, name: "แอน", role: "owner" },
      { userId: BOB, name: "บ๊อบ", role: "member" },
    ];
  });

  it("a member leaves on their own", async () => {
    me = BOB;
    wallets = [sharedWallet()];
    expect((await REMOVE(req(), memberParams(BOB))).status).toBe(200);
    expect(removed).toEqual([{ walletId: WS, userId: BOB }]);
  });

  it("the owner can take somebody off; a member cannot take off another", async () => {
    expect((await REMOVE(req(), memberParams(BOB))).status).toBe(200);
    removed.length = 0;
    me = BOB;
    const other = "44444444-4444-4444-8444-444444444444";
    expect((await REMOVE(req(), memberParams(other))).status).toBe(403);
    expect(removed).toHaveLength(0);
  });

  it("the owner cannot leave (they delete the wallet instead)", async () => {
    expect((await REMOVE(req(), memberParams(OWNER))).status).toBe(400);
  });

  it("a wallet the person is not on, or a private one, is a 404", async () => {
    wallets = [];
    expect((await REMOVE(req(), memberParams(BOB))).status).toBe(404);
    wallets = [sharedWallet({ shared: false })];
    expect((await REMOVE(req(), memberParams(BOB))).status).toBe(404);
  });
});

describe("POST /api/wallets/join", () => {
  it("joins with a good code, whatever the person's own plan", async () => {
    plan = "free";
    const res = await JOIN(req({ code: "482913" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: "กองกลาง" });
  });

  it.each([
    ["invalid", 400],
    ["expired", 400],
    ["used", 400],
    ["own", 400],
    ["already", 400],
    ["full", 403],
  ])("%s -> %s", async (reason, status) => {
    redeemResult = { ok: false, reason };
    const res = await JOIN(req({ code: "482913" }));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBeTruthy();
  });

  it("only a 6-digit code is looked at", async () => {
    for (const code of ["12345", "1234567", "abcdef", ""]) {
      expect((await JOIN(req({ code }))).status).toBe(400);
    }
  });

  it("guessing is limited per person", async () => {
    limited = true;
    expect((await JOIN(req({ code: "482913" }))).status).toBe(429);
  });
});
