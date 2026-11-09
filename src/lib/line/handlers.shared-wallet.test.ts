import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/lib/wallet";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "plus";
let wallets: Wallet[] = [];
let redeem: unknown = { ok: true, wallet: { id: "ws", name: "กองกลาง", ownerId: "other" } };
let memberCount = 1;
let allowJoinTries = true;
const inserted: Record<string, unknown>[] = [];
const invitesMade: string[] = [];
const left: { walletId: string; userId: string }[] = [];
const redeemed: { code: string; userId: string }[] = [];
const NOW = new Date("2026-10-18T05:00:00Z");

const wallet = (over: Partial<Wallet>): Wallet => ({
  id: "w-cash",
  name: "เงินสด",
  kind: "cash",
  isDefault: true,
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
  ...over,
});

vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/wallet-repo", () => ({
  listWallets: async () => wallets,
  ensureWallets: async () => wallets,
  setEntryWallet: async () => true,
}));
vi.mock("@/lib/shared-wallet-repo", () => ({
  redeemInvite: async (_db: unknown, code: string, userId: string) => {
    redeemed.push({ code, userId });
    return redeem;
  },
  membersOf: async () =>
    Array.from({ length: memberCount }, (_, i) => ({
      userId: `m${i}`,
      name: `m${i}`,
      role: i === 0 ? "owner" : "member",
    })),
  createInvite: async (_db: unknown, walletId: string) => {
    invitesMade.push(walletId);
    return { code: "482913", expiresAt: new Date("2026-10-19T05:00:00Z") };
  },
  removeMember: async (_db: unknown, walletId: string, userId: string) => {
    left.push({ walletId, userId });
    return true;
  },
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "me",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: "short",
    budget_cycle: "monthly",
    cycle_start_day: 1,
  }),
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => {
    inserted.push(input);
    return {
      id: "t1",
      status: input.status,
      type: input.type,
      title: input.title,
      amount: "300.00",
      occurred_at: NOW.toISOString(),
      category_id: null,
      slip_id: null,
    };
  },
  categoryTotalSatang: async () => 0,
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});

function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => NOW,
    limit: async () => ({ allowed: allowJoinTries, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));

const mine = () =>
  wallet({
    id: "ws",
    name: "กองกลาง",
    kind: "bank",
    isDefault: false,
    shared: true,
    ownerId: "me",
    memberCount: 1,
  });
const theirs = () => ({ ...mine(), ownerId: "other", memberCount: 2 });

beforeEach(() => {
  plan = "plus";
  wallets = [wallet({ ownerId: "me" }), mine()];
  redeem = { ok: true, wallet: { id: "ws", name: "กองกลาง", ownerId: "other" } };
  memberCount = 1;
  allowJoinTries = true;
  inserted.length = 0;
  invitesMade.length = 0;
  left.length = 0;
  redeemed.length = 0;
});

describe("เชิญ <กระเป๋าร่วม>", () => {
  it("the owner gets a code and how to use it", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เชิญ กองกลาง"), deps);
    expect(invitesMade).toEqual(["ws"]);
    const text = said(reply);
    expect(text).toContain("482913");
    expect(text).toContain("ร่วมกระเป๋า 482913");
    expect(text).toContain("24 ชั่วโมง");
  });

  it("someone who is only a member is told only the owner can invite", async () => {
    wallets = [wallet({ ownerId: "me" }), theirs()];
    const { deps, reply } = setup();
    await handleEvent(say("เชิญ กองกลาง"), deps);
    expect(invitesMade).toHaveLength(0);
    expect(said(reply)).toContain("เฉพาะเจ้าของ");
  });

  it("a name that is no shared wallet of theirs is an ordinary message", async () => {
    const { deps } = setup();
    await handleEvent(say("เชิญ เพื่อนมากิน"), deps);
    expect(invitesMade).toHaveLength(0);
  });

  it("a full wallet (Starter: two people) cannot invite more; Pro (five) can", async () => {
    plan = "starter";
    memberCount = 2;
    let { deps, reply } = setup();
    await handleEvent(say("เชิญ กองกลาง"), deps);
    expect(invitesMade).toHaveLength(0);
    expect(said(reply)).toContain("เต็ม");

    plan = "plus";
    ({ deps, reply } = setup());
    await handleEvent(say("เชิญ กองกลาง"), deps);
    expect(invitesMade).toEqual(["ws"]);
  });

  it("a lapsed plan cannot invite", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("เชิญ กองกลาง"), deps);
    expect(invitesMade).toHaveLength(0);
    expect(said(reply)).toContain("Starter");
  });
});

describe("ร่วมกระเป๋า <รหัส>", () => {
  it("joins with the code, even on Free, and explains what they will and will not see", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("ร่วมกระเป๋า 482913"), deps);
    expect(redeemed).toEqual([{ code: "482913", userId: "me" }]);
    const text = said(reply);
    expect(text).toContain('ร่วมกระเป๋า \\"กองกลาง\\" แล้ว');
    expect(text).toContain("@กองกลาง");
    expect(text).toContain("ยังเป็นส่วนตัว");
  });

  it("understands Thai digits", async () => {
    const { deps } = setup();
    await handleEvent(say("ร่วมกระเป๋า ๔๘๒๙๑๓"), deps);
    expect(redeemed[0]?.code).toBe("482913");
  });

  it.each([
    ["invalid", "ไม่พบรหัสนี้"],
    ["expired", "หมดอายุ"],
    ["used", "ถูกใช้ไปแล้ว"],
    ["own", "กระเป๋าของคุณเอง"],
    ["already", "ร่วมกระเป๋านี้อยู่แล้ว"],
    ["full", "เต็ม"],
  ])("a code that fails (%s) says why", async (reason, words) => {
    redeem = { ok: false, reason };
    const { deps, reply } = setup();
    await handleEvent(say("ร่วมกระเป๋า 482913"), deps);
    expect(said(reply)).toContain(words);
  });

  it("without a 6-digit code it shows how", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ร่วมกระเป๋า"), deps);
    await handleEvent(say("ร่วมกระเป๋า 123"), deps);
    expect(redeemed).toHaveLength(0);
    expect(said(reply)).toContain("ร่วมกระเป๋า 482913");
  });

  it("too many tries stops it before the code is even looked at", async () => {
    allowJoinTries = false;
    const { deps } = setup();
    await handleEvent(say("ร่วมกระเป๋า 482913"), deps);
    expect(redeemed).toHaveLength(0);
  });
});

describe("ออกจากกระเป๋า <ชื่อ>", () => {
  it("a member leaves", async () => {
    wallets = [wallet({ ownerId: "me" }), theirs()];
    const { deps, reply } = setup();
    await handleEvent(say("ออกจากกระเป๋า กองกลาง"), deps);
    expect(left).toEqual([{ walletId: "ws", userId: "me" }]);
    expect(said(reply)).toContain("ออกจากกระเป๋า");
  });

  it("the owner cannot; an unknown name is an ordinary message", async () => {
    let { deps, reply } = setup();
    await handleEvent(say("ออกจากกระเป๋า กองกลาง"), deps);
    expect(left).toHaveLength(0);
    expect(said(reply)).toContain("เจ้าของออกจากกระเป๋าร่วมไม่ได้");

    ({ deps, reply } = setup());
    await handleEvent(say("ออกจากกระเป๋า เงินสด"), deps); // a private wallet
    expect(left).toHaveLength(0);
  });
});

describe("recording into a shared wallet", () => {
  it("@กองกลาง records into it and the card shows the shared mark", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ข้าวเย็น 300 @กองกลาง"), deps);
    expect(inserted[0]).toMatchObject({ title: "ข้าวเย็น", accountId: "ws" });
    expect(said(reply)).toContain("👥");
    expect(said(reply)).toContain("กองกลาง");
  });

  it("the wallets card marks it and counts the people", async () => {
    wallets = [wallet({ ownerId: "me" }), theirs()];
    const { deps, reply } = setup();
    await handleEvent(say("กระเป๋า"), deps);
    expect(said(reply)).toContain("กองกลาง 👥");
    expect(said(reply)).toContain("2 คน");
  });
});

describe("what a shared wallet does not take yet", () => {
  it("no transfers in or out of it", async () => {
    plan = "ultimate";
    const { deps, reply } = setup();
    await handleEvent(say("โอน 500 เงินสด>กองกลาง"), deps);
    expect(said(reply)).toContain("กระเป๋าร่วมใช้ได้เฉพาะรายรับ/รายจ่าย");
  });
});
