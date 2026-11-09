import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvite,
  createSharedWallet,
  isMember,
  membersOf,
  redeemInvite,
  removeMember,
} from "./shared-wallet-repo";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the parts of the Supabase client these functions use. */
function fakeDb(tables: Record<string, Row[]>, unique: Record<string, string[]> = {}) {
  const data = tables;
  const from = (table: string) => {
    const rows = (data[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] = {};
    let order: { col: string } | null = null;
    const matching = () => rows.filter((r) => filters.every((f) => f(r)));
    const run = (single: boolean) => {
      if (mode === "insert") {
        const items = Array.isArray(payload) ? payload : [payload];
        for (const item of items) {
          const key = unique[table];
          if (key && rows.some((r) => key.every((k) => r[k] === item[k]))) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          rows.push({ id: `${table}-${rows.length + 1}`, ...item });
        }
        const last = rows.slice(-items.length);
        return { data: single ? (last[0] ?? null) : last, error: null };
      }
      if (mode === "update") {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, payload));
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      }
      if (mode === "delete") {
        const hit = matching();
        data[table] = rows.filter((r) => !hit.includes(r));
        rows.length = 0;
        rows.push(...data[table]!);
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      }
      let out = matching();
      if (order)
        out = [...out].sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])));
      return { data: single ? (out[0] ?? null) : out, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (p: Row | Row[]) => ((mode = "insert"), (payload = p), q),
      update: (p: Row) => ((mode = "update"), (payload = p), q),
      delete: () => ((mode = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      lt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) < String(v)), q),
      order: (c: string) => ((order = { col: c }), q),
      maybeSingle: async () => run(true),
      single: async () => run(true),
      then: (resolve: (v: unknown) => unknown) => resolve(run(false)),
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, data };
}

const NOW = new Date("2026-10-18T05:00:00Z");
const SOON = new Date(NOW.getTime() + 3_600_000).toISOString();
const PAST = new Date(NOW.getTime() - 3_600_000).toISOString();

/** Ann owns "กองกลาง" (shared); the owner's plan is the parameter. */
function world(plan: string, members: string[] = ["ann"], invite: Partial<Row> = {}) {
  return fakeDb(
    {
      accounts: [
        {
          id: "w1",
          name: "กองกลาง",
          user_id: "ann",
          is_shared: true,
          users: { plan, plan_expires_at: null },
        },
        {
          id: "w2",
          name: "ส่วนตัว",
          user_id: "ann",
          is_shared: false,
          users: { plan, plan_expires_at: null },
        },
      ],
      wallet_members: members.map((m, i) => ({
        wallet_id: "w1",
        user_id: m,
        role: i === 0 ? "owner" : "member",
        joined_at: `2026-10-0${i + 1}`,
        users: { display_name: m === "ann" ? "แอน" : "บ๊อบ" },
      })),
      wallet_invites: [
        {
          code: "482913",
          wallet_id: "w1",
          created_by: "ann",
          expires_at: SOON,
          used_at: null,
          ...invite,
        },
      ],
    },
    { wallet_invites: ["code"], wallet_members: ["wallet_id", "user_id"] },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("redeemInvite", () => {
  it("a good code puts the person on the wallet and uses the code up", async () => {
    const { db, data } = world("plus");
    const r = await redeemInvite(db, "482913", "bob", NOW);
    expect(r).toEqual({ ok: true, wallet: { id: "w1", name: "กองกลาง", ownerId: "ann" } });
    expect(data.wallet_members?.some((m) => m.user_id === "bob" && m.role === "member")).toBe(true);
    expect(data.wallet_invites?.[0]).toMatchObject({ used_by: "bob" });
    expect(data.wallet_invites?.[0]?.used_at).toBeTruthy();
  });

  it("the code works once: the next person gets 'used'", async () => {
    const { db } = world("ultimate");
    expect((await redeemInvite(db, "482913", "bob", NOW)).ok).toBe(true);
    expect(await redeemInvite(db, "482913", "carl", NOW)).toEqual({ ok: false, reason: "used" });
  });

  it("an unknown or expired code", async () => {
    const { db } = world("plus");
    expect(await redeemInvite(db, "000000", "bob", NOW)).toEqual({ ok: false, reason: "invalid" });
    const old = world("plus", ["ann"], { expires_at: PAST });
    expect(await redeemInvite(old.db, "482913", "bob", NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(old.data.wallet_members).toHaveLength(1);
  });

  it("the owner cannot use their own code, and nobody joins twice", async () => {
    const { db } = world("plus");
    expect(await redeemInvite(db, "482913", "ann", NOW)).toEqual({ ok: false, reason: "own" });
    const both = world("ultimate", ["ann", "bob"]);
    expect(await redeemInvite(both.db, "482913", "bob", NOW)).toEqual({
      ok: false,
      reason: "already",
    });
  });

  it("Starter: two people (the owner and one more); the third is turned away and the code stays unused", async () => {
    const { db, data } = world("starter", ["ann", "bob"]);
    expect(await redeemInvite(db, "482913", "carl", NOW)).toEqual({ ok: false, reason: "full" });
    expect(data.wallet_invites?.[0]?.used_at).toBeNull();
    expect(data.wallet_members).toHaveLength(2);
  });

  it("Pro: up to five", async () => {
    const four = world("plus", ["ann", "b", "c", "d"]);
    expect((await redeemInvite(four.db, "482913", "last", NOW)).ok).toBe(true);
    const five = world("plus", ["ann", "b", "c", "d", "e"]);
    expect(await redeemInvite(five.db, "482913", "extra", NOW)).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("Elite: up to ten", async () => {
    const nine = world("ultimate", ["ann", ...Array.from({ length: 8 }, (_, i) => `m${i}`)]);
    expect((await redeemInvite(nine.db, "482913", "last", NOW)).ok).toBe(true);
    const ten = world("ultimate", ["ann", ...Array.from({ length: 9 }, (_, i) => `m${i}`)]);
    expect(await redeemInvite(ten.db, "482913", "extra", NOW)).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("the limit is the OWNER's plan: a lapsed owner cannot take anyone new", async () => {
    const { db } = world("free");
    expect(await redeemInvite(db, "482913", "bob", NOW)).toEqual({ ok: false, reason: "full" });
  });

  it("a code for something that is not a shared wallet does nothing", async () => {
    const { db } = world("plus", ["ann"], { wallet_id: "w2" });
    expect(await redeemInvite(db, "482913", "bob", NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("createInvite", () => {
  it("makes a 6-digit code that expires in 24 hours", async () => {
    const { db, data } = world("plus");
    data.wallet_invites = [];
    const inv = await createInvite(db, "w1", "ann", NOW);
    expect(inv.code).toMatch(/^\d{6}$/);
    expect(inv.expiresAt.toISOString()).toBe("2026-10-19T05:00:00.000Z");
    expect(data.wallet_invites).toHaveLength(1);
  });

  it("tries another code when one is taken", async () => {
    const { db, data } = world("plus");
    vi.spyOn(Math, "random").mockReturnValueOnce(0.482913).mockReturnValueOnce(0.5);
    const inv = await createInvite(db, "w1", "ann", NOW);
    expect(inv.code).toBe("500000");
    expect(data.wallet_invites?.some((i) => i.code === "500000")).toBe(true);
  });

  it("forgets invites that ended days ago", async () => {
    const { db, data } = world("plus", ["ann"], {
      expires_at: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
    });
    await createInvite(db, "w1", "ann", NOW);
    expect(data.wallet_invites?.some((i) => i.code === "482913")).toBe(false);
  });
});

describe("members", () => {
  it("lists the owner first with the names shown", async () => {
    const { db } = world("plus", ["ann", "bob"]);
    expect(await membersOf(db, "w1")).toEqual([
      { userId: "ann", role: "owner", name: "แอน" },
      { userId: "bob", role: "member", name: "บ๊อบ" },
    ]);
  });

  it("a member can be removed, the owner cannot", async () => {
    const { db } = world("plus", ["ann", "bob"]);
    expect(await removeMember(db, "w1", "ann")).toBe(false);
    expect(await removeMember(db, "w1", "bob")).toBe(true);
    expect(await isMember(db, "w1", "bob")).toBe(false);
    expect(await isMember(db, "w1", "ann")).toBe(true);
  });
});

describe("createSharedWallet", () => {
  it("makes a wallet that is shared, not the main one, with its owner on it", async () => {
    const { db, data } = fakeDb({}, { accounts: ["user_id", "name"] });
    const id = await createSharedWallet(db, "ann", {
      name: "กองกลาง",
      kind: "bank",
      openingSatang: 500_000,
    });
    expect(id).not.toBe("duplicate");
    expect(data.accounts?.[0]).toMatchObject({
      user_id: "ann",
      name: "กองกลาง",
      is_shared: true,
      is_default: false,
      opening_balance: "5000.00",
    });
    expect(data.wallet_members?.[0]).toMatchObject({ user_id: "ann", role: "owner" });
  });

  it("a name already used is a duplicate and nothing else is created", async () => {
    const { db, data } = fakeDb(
      { accounts: [{ user_id: "ann", name: "กองกลาง" }] },
      { accounts: ["user_id", "name"] },
    );
    expect(
      await createSharedWallet(db, "ann", { name: "กองกลาง", kind: "cash", openingSatang: 0 }),
    ).toBe("duplicate");
    expect(data.wallet_members ?? []).toHaveLength(0);
  });
});
