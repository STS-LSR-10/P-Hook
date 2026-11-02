import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "plus";
let expires: string | null = "2027-10-17T00:00:00Z";
let signedIn = true;
const usageAsked: { kind: string; month: string }[][] = [];
let failNotes = false;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () =>
    signedIn
      ? { userId: "u1", lineUserId: "U1" }
      : new Response(JSON.stringify({ error: "กรุณาเข้าสู่ระบบอีกครั้ง" }), { status: 401 }),
}));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: expires }),
  countSlipsThisMonth: async () => 4,
  countSlipsThisWeek: async () => 1,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/file-repo", () => ({ fileUsage: async () => 2048 }));
vi.mock("@/lib/note-repo", () => ({
  countNotes: async () => {
    if (failNotes) throw new Error("db down");
    return 12;
  },
}));
vi.mock("@/lib/user-reminder-repo", () => ({ countActiveReminders: async () => 3 }));
vi.mock("@/lib/recurring-repo", () => ({ countRules: async () => 2 }));
vi.mock("@/lib/photo-repo", () => ({ countPhotosThisMonth: async () => 6 }));
vi.mock("@/lib/wallet-repo", () => ({
  // a read only: nothing is created or repaired while counting
  listWallets: async () => [
    { id: "a", ownerId: "u1", shared: false },
    { id: "b", ownerId: "u1", shared: false },
    { id: "c", ownerId: "someone", shared: true },
  ],
}));
vi.mock("@/lib/goal-repo", () => ({
  listGoals: async () => [{ archived: false }, { archived: true }],
}));
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  readUsage: async (_db: unknown, _u: string, keys: { kind: string; month: string }[]) => {
    usageAsked.push(keys);
    return keys.map(
      (k) => ({ voice: 5, teaser_voice: 1, pdf: 2, owl: 8, router: 9, file_save: 1 })[k.kind] ?? 0,
    );
  },
}));

import { GET } from "./route";

const get = () => GET(new Request("https://app.example.com/api/quota"));
const items = async (res: Response) => {
  const body = (await res.json()) as { kept: { key: string }[]; counted: { key: string }[] };
  return Object.fromEntries(
    [...body.kept, ...body.counted].map((i) => [i.key, i as Record<string, unknown>]),
  );
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T05:00:00Z")); // 2 Nov 2026, 12:00 Bangkok
  plan = "plus";
  expires = "2027-10-17T00:00:00Z";
  signedIn = true;
  failNotes = false;
  usageAsked.length = 0;
});

describe("GET /api/quota", () => {
  it("gives the plan and what each quota has used", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.clone().json()) as { plan: string; planExpiresAt: string };
    expect(body.plan).toBe("plus");
    expect(body.planExpiresAt).toBe("2027-10-17T00:00:00Z");
    const q = await items(res);
    expect(q.storage).toMatchObject({ used: 2048 });
    expect(q.wallets).toMatchObject({ used: 2 }); // only the person's own
    expect(q.goals).toMatchObject({ used: 1 }); // not the archived one
    expect(q.notes).toMatchObject({ used: 12 });
    expect(q.reminders).toMatchObject({ used: 3 });
    expect(q.recurring).toMatchObject({ used: 2 });
    expect(q.slips).toMatchObject({ used: 4, period: "month" });
    expect(q.photos).toMatchObject({ used: 6 });
    expect(q.voice).toMatchObject({ used: 5 });
    expect(q.owl).toMatchObject({ used: 8 });
    expect(q.router).toMatchObject({ used: 9 });
    expect(q.fileSaves).toMatchObject({ used: 1 });
    expect(q.pdf).toMatchObject({ used: 2 });
    // each counter in the period its limit counts: the month, or today
    expect(usageAsked[0]).toEqual([
      { kind: "voice", month: "2026-11-01" },
      { kind: "pdf", month: "2026-11-01" },
      { kind: "owl", month: "2026-11-01" },
      { kind: "router", month: "2026-11-02" },
      { kind: "file_save", month: "2026-11-02" },
    ]);
  });

  it("a free row with days still running (redeemed coins) counts as Pro", async () => {
    plan = "free";
    const res = await get();
    expect(((await res.clone().json()) as { plan: string }).plan).toBe("plus");
    expect((await items(res)).slips).toMatchObject({ used: 4, period: "month" });
  });

  it("needs a sign-in", async () => {
    signedIn = false;
    expect((await get()).status).toBe(401);
  });

  it("Free counts slips this week and the one voice try for life", async () => {
    plan = "free";
    expires = null;
    const q = await items(await get());
    expect(q.slips).toMatchObject({ used: 1, period: "week" });
    expect(q.voice).toMatchObject({ used: 1, period: "once" });
    expect(usageAsked[0]).toContainEqual({ kind: "teaser_voice", month: "2000-01-01" });
  });

  it("fails as a whole when a count cannot be read", async () => {
    failNotes = true;
    expect((await get()).status).toBe(500);
  });
});
