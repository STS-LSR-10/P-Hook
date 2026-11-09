import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillDto } from "@/lib/bill";

let plan = "ultimate";
let bills: BillDto[] = [];
let createResult = "new-id";
const created: Record<string, unknown>[] = [];
const patched: Record<string, unknown>[] = [];
const settled: string[] = [];
const recorded: { amountSatang: number }[] = [];
const B = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/wallet-repo", () => ({ listWallets: async () => [] }));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({ id: "u1", line_user_id: "U1", plan, plan_expires_at: null }),
}));
vi.mock("@/lib/bill-repo", () => ({
  listBills: async () => bills,
  createBill: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return createResult;
  },
  updateBill: async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
    patched.push(patch);
    return "ok";
  },
  deleteBill: async () => true,
}));
vi.mock("@/lib/bill-actions", () => ({
  settleBill: async (_db: unknown, _u: string, bill: BillDto) => {
    settled.push(bill.id);
    return { nextDueOn: "2026-12-15" };
  },
  recordBillExpense: async (_db: unknown, _u: unknown, _b: BillDto, amountSatang: number) => {
    recorded.push({ amountSatang });
    return { tx: {}, categoryId: null };
  },
}));

import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";
import { POST as PAY } from "./[id]/pay/route";

const bill = (over: Partial<BillDto> = {}): BillDto => ({
  id: B,
  name: "ค่าไฟ",
  amountSatang: 125_000,
  cadence: "monthly",
  dayOfMonth: 15,
  monthOfYear: null,
  nextDueOn: "2026-11-15",
  remindDays: [1],
  remindHour: 9,
  snoozedOn: null,
  note: null,
  isActive: true,
  ...over,
});
const req = (method: string, body?: unknown) =>
  new Request("https://app.example.com/api/bills", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ id: B }) };

beforeEach(() => {
  plan = "ultimate";
  bills = [];
  createResult = "new-id";
  created.length = 0;
  patched.length = 0;
  settled.length = 0;
  recorded.length = 0;
});

describe("POST /api/bills", () => {
  it.each(["free", "starter"])("is Pro and above: %s gets a 403", async (p) => {
    plan = p;
    const res = await POST(req("POST", { name: "ค่าไฟ", cadence: "monthly", dayOfMonth: 15 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true });
    expect(created).toHaveLength(0);
  });

  it("saves a bill with defaults: remind 1 day before at 09:00, amount as satang", async () => {
    const res = await POST(
      req("POST", { name: " ค่าไฟ ", amount: "1,250", cadence: "monthly", dayOfMonth: 15 }),
    );
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({
      name: "ค่าไฟ",
      amountSatang: 125_000,
      cadence: "monthly",
      dayOfMonth: 15,
      monthOfYear: null,
      remindDays: [1],
      remindHour: 9,
    });
    expect(typeof created[0]?.nextDueOn).toBe("string");
  });

  it("keeps the chosen reminder days (biggest first) and hour; yearly needs a month", async () => {
    await POST(
      req("POST", {
        name: "ประกัน",
        cadence: "yearly",
        dayOfMonth: 1,
        monthOfYear: 3,
        remindDays: [1, 7, 1],
        remindHour: 20,
      }),
    );
    expect(created[0]).toMatchObject({ monthOfYear: 3, remindDays: [7, 1], remindHour: 20 });
    expect((await POST(req("POST", { name: "x", cadence: "yearly", dayOfMonth: 1 }))).status).toBe(
      400,
    );
  });

  it.each([
    [{ name: "x", cadence: "monthly", dayOfMonth: 0 }],
    [{ name: "x", cadence: "monthly", dayOfMonth: 32 }],
    [{ name: "x", cadence: "weekly", dayOfMonth: 5 }],
    [{ name: "", cadence: "monthly", dayOfMonth: 5 }],
    [{ name: "x", cadence: "monthly", dayOfMonth: 5, remindHour: 24 }],
    [{ name: "x", cadence: "monthly", dayOfMonth: 5, remindDays: [] }],
    [{ name: "x", cadence: "monthly", dayOfMonth: 5, amount: "abc" }],
    [{ name: "x", cadence: "monthly", dayOfMonth: 5, amount: "0" }],
  ])("%j is refused", async (body) => {
    expect((await POST(req("POST", body))).status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("stops at 30 bills; a name already used is a 409", async () => {
    bills = Array.from({ length: 30 }, (_, i) => bill({ id: `b${i}` }));
    expect(
      (await POST(req("POST", { name: "ใหม่", cadence: "monthly", dayOfMonth: 5 }))).status,
    ).toBe(400);
    bills = [];
    createResult = "duplicate";
    expect(
      (await POST(req("POST", { name: "ซ้ำ", cadence: "monthly", dayOfMonth: 5 }))).status,
    ).toBe(409);
  });
});

describe("GET /api/bills", () => {
  it("lists the bills, soonest first", async () => {
    bills = [bill({ nextDueOn: "2026-12-01" }), bill({ id: "b2", nextDueOn: "2026-11-01" })];
    const body = await (await GET(req("GET"))).json();
    expect(body.items.map((b: BillDto) => b.nextDueOn)).toEqual(["2026-11-01", "2026-12-01"]);
    expect(body).toMatchObject({ limit: 30, canAdd: true });
  });
});

describe("PATCH /api/bills/:id", () => {
  it("a changed schedule moves the next due date to one that fits it", async () => {
    bills = [bill()];
    await PATCH(req("PATCH", { dayOfMonth: 20 }), params);
    expect(patched[0]).toMatchObject({ dayOfMonth: 20, monthOfYear: null });
    expect(typeof patched[0]?.nextDueOn).toBe("string");
  });

  it("renaming alone leaves the date; the amount can be cleared", async () => {
    bills = [bill()];
    await PATCH(req("PATCH", { name: "ค่าไฟบ้าน", amount: null }), params);
    expect(patched[0]).toMatchObject({ name: "ค่าไฟบ้าน", amountSatang: null });
    expect(patched[0]?.nextDueOn).toBeUndefined();
  });

  it("an unknown bill is a 404; Starter is refused", async () => {
    expect((await PATCH(req("PATCH", { name: "x" }), params)).status).toBe(404);
    bills = [bill()];
    plan = "starter";
    expect((await PATCH(req("PATCH", { name: "x" }), params)).status).toBe(403);
  });
});

describe("POST /api/bills/:id/pay", () => {
  it("paid: moves to the next due date without recording anything", async () => {
    bills = [bill()];
    const body = await (await PAY(req("POST", {}), params)).json();
    expect(body).toMatchObject({ ok: true, nextDueOn: "2026-12-15", recorded: false });
    expect(settled).toEqual([B]);
    expect(recorded).toHaveLength(0);
  });

  it("paid and recorded: uses the bill's amount, or the one given", async () => {
    bills = [bill()];
    await PAY(req("POST", { record: true }), params);
    await PAY(req("POST", { record: true, amount: "1,300.50" }), params);
    expect(recorded.map((r) => r.amountSatang)).toEqual([125_000, 130_050]);
  });

  it("recording with no amount anywhere is refused and nothing moves", async () => {
    bills = [bill({ amountSatang: null })];
    expect((await PAY(req("POST", { record: true }), params)).status).toBe(400);
    expect(settled).toHaveLength(0);
    expect((await PAY(req("POST", { record: true, amount: "abc" }), params)).status).toBe(400);
  });

  it("an unknown bill is a 404", async () => {
    expect((await PAY(req("POST", {}), params)).status).toBe(404);
  });
});
