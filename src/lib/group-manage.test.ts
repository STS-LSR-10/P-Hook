import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillMemberRow, BillRow } from "@/lib/split-bill";

const bill = (id: string, payer = "Uanna"): BillRow => ({
  id,
  groupId: "g1",
  payerLineUserId: payer,
  title: `bill ${id}`,
  amountSatang: 30_000,
  status: "collecting",
  createdAt: "2026-10-01T00:00:00Z",
});
const member = (lineUserId: string, paid = false): BillMemberRow => ({
  lineUserId,
  shareSatang: 10_000,
  paid,
  qrToken: `t-${lineUserId}`,
  claimed: false,
  claimVia: null,
  paidVia: null,
});

let bills: BillRow[] = [];
let members: Record<string, BillMemberRow[]> = {};
const paidCalls: string[] = [];
const cancelled: string[] = [];

vi.mock("@/lib/split-bill-repo", () => ({
  listBills: async () => bills.filter((b) => b.status === "collecting"),
  getBill: async (_db: unknown, _g: string, id: string) => bills.find((b) => b.id === id) ?? null,
  billMembers: async (_db: unknown, id: string) => members[id] ?? [],
  markPaid: async (_db: unknown, id: string, user: string) => {
    paidCalls.push(`${id}:${user}`);
    const m = members[id]?.find((x) => x.lineUserId === user);
    if (!m) return "none";
    m.paid = true;
    return "ok";
  },
  cancelBill: async (_db: unknown, id: string) => {
    cancelled.push(id);
    return true;
  },
}));

import { clearDebts, openDebts } from "./group-manage";

const db = {} as never;
const names = new Map([
  ["Uanna", "แอน"],
  ["Ubob", "บ๊อบ"],
  ["Uchom", "ชมพู"],
]);

beforeEach(() => {
  paidCalls.length = 0;
  cancelled.length = 0;
  bills = [bill("b1"), bill("b2")];
  members = {
    b1: [member("Uanna", true), member("Ubob"), member("Uchom")],
    b2: [member("Uanna", true), member("Ubob")],
  };
});

describe("openDebts", () => {
  it("lists each bill with who still owes (the payer never does)", async () => {
    const out = await openDebts(db, "g1", names);
    expect(out.map((b) => [b.id, b.unpaid.map((u) => u.name)])).toEqual([
      ["b1", ["บ๊อบ", "ชมพู"]],
      ["b2", ["บ๊อบ"]],
    ]);
  });
  it("leaves out a bill nobody owes on", async () => {
    members.b2 = [member("Uanna", true), member("Ubob", true)];
    expect((await openDebts(db, "g1", names)).map((b) => b.id)).toEqual(["b1"]);
  });
});

describe("clearDebts", () => {
  it("one person on one bill", async () => {
    expect(await clearDebts(db, "g1", { kind: "member", billId: "b1", userId: "Ubob" })).toBe(1);
    expect(paidCalls).toEqual(["b1:Ubob"]);
  });
  it("a whole bill is cancelled, if it is the group's own", async () => {
    expect(await clearDebts(db, "g1", { kind: "bill", billId: "b1" })).toBe(1);
    expect(cancelled).toEqual(["b1"]);
    expect(await clearDebts(db, "g1", { kind: "bill", billId: "other-group" })).toBe(0);
    expect(cancelled).toEqual(["b1"]);
  });
  it("everything the group is owed", async () => {
    expect(await clearDebts(db, "g1", { kind: "all" })).toBe(3);
    expect(paidCalls.sort()).toEqual(["b1:Ubob", "b1:Uchom", "b2:Ubob"]);
  });
  it("everything one person owes, on every bill", async () => {
    expect(await clearDebts(db, "g1", { kind: "user", userId: "Ubob" })).toBe(2);
    expect(paidCalls.sort()).toEqual(["b1:Ubob", "b2:Ubob"]);
  });
  it("refuses a member who owes nothing on that bill", async () => {
    expect(await clearDebts(db, "g1", { kind: "member", billId: "b1", userId: "Uanna" })).toBe(0);
    expect(paidCalls).toEqual([]);
  });
});
