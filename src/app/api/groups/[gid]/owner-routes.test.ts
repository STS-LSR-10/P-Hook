import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupViewer } from "@/lib/group-access";

const GID = "33333333-3333-4333-8333-333333333333";
const E = "55555555-5555-4555-8555-555555555555";
const B = "66666666-6666-4666-8666-666666666666";

let viewer: GroupViewer | null = null;
let ownerPlan = "ultimate";
const calls: unknown[] = [];
const pages: unknown[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "app-Uanna", lineUserId: "Uanna" }),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ LINE_CHANNEL_ACCESS_TOKEN: "x" }) }));
vi.mock("@/lib/group-access", () => ({ groupForViewer: async () => viewer }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/plan-server", () => ({ getPlanInfo: async () => ({ plan: ownerPlan }) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/group-repo", () => ({
  memberNames: async () => new Map([["Uanna", { name: "แอน", updatedAt: "" }]]),
  payerTotals: async () => [{ lineUserId: "Uanna", totalSatang: 50_000, entries: 2 }],
  isEntryCursor: (v: string) => /^2026-.*\|[0-9a-f-]{36}$/.test(v),
  pageEntries: async (_d: unknown, _g: string, limit: number, cursor?: string | null) => {
    pages.push(["page", limit, cursor ?? null]);
    return {
      items: [
        { id: E, title: "ข้าว", amountSatang: 30_000, occurredAt: "x", payerLineUserId: "Uanna" },
      ],
      next: cursor ? null : `2026-11-10T01:00:00+00:00|${E}`,
    };
  },
  getChaseSchedule: async () => ({ everyDays: 1, window: "any" }),
  getLeftAt: async () => new Date("2026-11-08T05:00:00Z"),
  setChaseSchedule: async (_d: unknown, g: string, s: unknown) =>
    void calls.push(["schedule", g, s]),
  updateEntry: async (_d: unknown, g: string, id: string, p: unknown) => {
    calls.push(["update", g, id, p]);
    return id === E;
  },
  deleteEntry: async (_d: unknown, g: string, id: string) => {
    calls.push(["delete", g, id]);
    return id === E;
  },
}));
vi.mock("@/lib/group-manage", () => ({
  openDebts: async () => [{ id: B, title: "หมูกระทะ", unpaid: [] }],
  clearDebts: async (_d: unknown, g: string, scope: unknown) => {
    calls.push(["clear", g, scope]);
    return 2;
  },
}));

import { GET as manage } from "./manage/route";
import { GET as entriesPage } from "./entries/route";
import { DELETE as delEntry, PATCH as patchEntry } from "./entries/[id]/route";
import { POST as debts } from "./debts/route";
import { PUT as schedule } from "./schedule/route";

const owner = (isActive = true): GroupViewer => ({
  group: { id: GID, lineGroupId: "C1", ownerUserId: "app-Uanna", isActive },
  isOwner: true,
});
const req = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = { params: Promise.resolve({ gid: GID }) };
const pe = (id = E) => ({ params: Promise.resolve({ gid: GID, id }) });

beforeEach(() => {
  viewer = owner();
  ownerPlan = "ultimate";
  calls.length = 0;
  pages.length = 0;
});

describe("owner only", () => {
  it("a plain member is refused everywhere", async () => {
    viewer = { ...owner(), isOwner: false };
    expect((await manage(req(), p)).status).toBe(403);
    expect((await debts(req({ kind: "all" }), p)).status).toBe(403);
    expect((await schedule(req({ everyDays: 1, window: "any" }), p)).status).toBe(403);
    expect((await patchEntry(req({ title: "x" }), pe())).status).toBe(403);
    expect((await delEntry(req(), pe())).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("a closed ledger can be read but not changed; one the bot left says when its data goes", async () => {
    viewer = owner(false);
    const res = await manage(req(), p);
    expect(res.status).toBe(200);
    expect((await res.json()).purgeAt).toBe("2026-12-08T05:00:00.000Z");
    expect((await debts(req({ kind: "all" }), p)).status).toBe(409);
    expect((await schedule(req({ everyDays: 1, window: "any" }), p)).status).toBe(409);
    expect(calls).toEqual([]);
  });
});

describe("an owner who left Elite", () => {
  it("can still read the ledger but not change it", async () => {
    ownerPlan = "free";
    expect((await manage(req(), p)).status).toBe(200);
    expect((await debts(req({ kind: "all" }), p)).status).toBe(403);
    expect((await patchEntry(req({ title: "x" }), pe())).status).toBe(403);
    expect((await delEntry(req(), pe())).status).toBe(403);
    expect((await schedule(req({ everyDays: 1, window: "any" }), p)).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("the owner's card", () => {
  it("manage: month totals, entries with names, debts and the schedule", async () => {
    const body = await (await manage(req(), p)).json();
    expect(body.purgeAt).toBeNull(); // an open ledger has no deletion date
    expect(body.summary.totalSatang).toBe(50_000);
    expect(body.entries).toEqual([
      { id: E, title: "ข้าว", amountSatang: 30_000, occurredAt: "x", payerName: "แอน" },
    ]);
    expect(body.debts).toHaveLength(1);
    expect(body.schedule).toEqual({ everyDays: 1, window: "any" });
    // the first page is 10 entries, and says where the next one starts
    expect(pages[0]).toEqual(["page", 10, null]);
    expect(body.nextCursor).toBe(`2026-11-10T01:00:00+00:00|${E}`);
  });
  it("entries page: the next 20 after a cursor, none past the end, and a made-up cursor is refused", async () => {
    const cursor = `2026-11-10T01:00:00+00:00|${E}`;
    const res = await entriesPage(new Request(`http://x?cursor=${encodeURIComponent(cursor)}`), p);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(pages[0]).toEqual(["page", 20, cursor]);
    expect(body.entries).toEqual([
      { id: E, title: "ข้าว", amountSatang: 30_000, occurredAt: "x", payerName: "แอน" },
    ]);
    expect(body.nextCursor).toBeNull(); // the last page
    const bad = await entriesPage(new Request("http://x?cursor=a),id.gt.0"), p);
    expect(bad.status).toBe(400);
    expect(pages).toHaveLength(1);
  });
  it("entries page: a member who is not the owner is refused", async () => {
    viewer = { ...owner(), isOwner: false };
    expect((await entriesPage(new Request("http://x"), p)).status).toBe(403);
  });
  it("entries: edits and deletes in this group; unknown ids are 404; empty or silly edits are 400", async () => {
    expect((await patchEntry(req({ title: " กาแฟ ", amountSatang: 4500 }), pe())).status).toBe(200);
    expect(calls[0]).toEqual(["update", GID, E, { title: "กาแฟ", amountSatang: 4500 }]);
    expect((await patchEntry(req({}), pe())).status).toBe(400);
    expect((await patchEntry(req({ amountSatang: -5 }), pe())).status).toBe(400);
    expect((await patchEntry(req({ title: "x" }), pe(B))).status).toBe(404);
    expect((await delEntry(req(), pe())).status).toBe(200);
    expect((await delEntry(req(), pe(B))).status).toBe(404);
  });
  it("debts: each scope goes through, anything else is 400", async () => {
    for (const scope of [
      { kind: "all" },
      { kind: "user", userId: "Ubob" },
      { kind: "bill", billId: B },
      { kind: "member", billId: B, userId: "Ubob" },
    ]) {
      const res = await debts(req(scope), p);
      expect(await res.json()).toEqual({ cleared: 2 });
    }
    expect(calls.map((c) => (c as unknown[])[2])).toHaveLength(4);
    expect((await debts(req({ kind: "bill", billId: "nope" }), p)).status).toBe(400);
    expect((await debts(req({ kind: "everyone" }), p)).status).toBe(400);
  });
  it("schedule: saves a good one, refuses a bad one", async () => {
    expect((await schedule(req({ everyDays: 3, window: "evening" }), p)).status).toBe(200);
    expect(calls[0]).toEqual(["schedule", GID, { everyDays: 3, window: "evening" }]);
    expect((await schedule(req({ everyDays: 5, window: "evening" }), p)).status).toBe(400);
  });
});
