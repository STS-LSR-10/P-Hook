import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DebtDto } from "@/lib/debt";

let plan = "ultimate";
let debts: DebtDto[] = [];
const created: Record<string, unknown>[] = [];
const paid: { parts: { debtId: string; amountSatang: number }[]; accountId: string }[] = [];
const patched: Record<string, unknown>[] = [];
const MAIN = "11111111-1111-4111-8111-111111111111";
const BANK = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const DEBT = "44444444-4444-4444-8444-444444444444";

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
vi.mock("@/lib/wallet-repo", () => ({
  ensureWallets: async () => [
    { id: MAIN, isDefault: true },
    { id: BANK, isDefault: false },
  ],
}));
vi.mock("@/lib/debt-repo", async () => {
  const { openDebtsOf } =
    await vi.importActual<typeof import("@/lib/debt-repo")>("@/lib/debt-repo");
  return {
    openDebtsOf,
    listDebts: async () => debts,
    createDebt: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
      created.push(input);
      return "new-id";
    },
    updateDebt: async (_db: unknown, _u: string, _id: string, patch: Record<string, unknown>) => {
      patched.push(patch);
      return true;
    },
    addPayments: async (
      _db: unknown,
      _u: string,
      parts: { debtId: string; amountSatang: number }[],
      input: { accountId: string },
    ) => {
      paid.push({ parts, accountId: input.accountId });
      return ["pay-1"];
    },
    listPayments: async () => [],
  };
});

import { GET, POST } from "./route";
import { PATCH } from "./[id]/route";
import { POST as PAY } from "./[id]/payments/route";

const req = (method: string, body?: unknown) =>
  new Request("https://app.example.com/api/debts", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ id: DEBT }) };

const debt = (over: Partial<DebtDto>): DebtDto => ({
  id: DEBT,
  direction: "lent",
  person: "สมชาย",
  amountSatang: 50000,
  paidSatang: 10000,
  remainingSatang: 40000,
  accountId: BANK,
  accountName: "กสิกร",
  occurredAt: "2026-10-01T05:00:00Z",
  dueAt: null,
  note: null,
  ...over,
});

beforeEach(() => {
  plan = "ultimate";
  debts = [];
  created.length = 0;
  paid.length = 0;
  patched.length = 0;
});

describe("GET /api/debts", () => {
  it("lists the debts with what is owed each way", async () => {
    debts = [debt({}), debt({ id: "x", direction: "borrowed", remainingSatang: 7000 })];
    const body = await (await GET(req("GET"))).json();
    expect(body).toMatchObject({ lentSatang: 40000, borrowedSatang: 7000 });
    expect(body.items).toHaveLength(2);
  });
});

describe("POST /api/debts", () => {
  it.each(["free"])("is for paid plans only: %s gets a 403", async (p) => {
    plan = p;
    const res = await POST(req("POST", { direction: "lent", person: "ก", amount: "100" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true });
    expect(created).toHaveLength(0);
  });

  it("saves against the named wallet, or the main one", async () => {
    await POST(
      req("POST", { direction: "lent", person: " สมชาย ", amount: "1,500.50", accountId: BANK }),
    );
    await POST(req("POST", { direction: "borrowed", person: "แม่", amount: 200 }));
    expect(created[0]).toMatchObject({
      direction: "lent",
      person: "สมชาย",
      amountSatang: 150050,
      accountId: BANK,
    });
    expect(created[1]).toMatchObject({ direction: "borrowed", accountId: MAIN });
  });

  it.each([
    [{ direction: "lent", person: "ก", amount: "0" }, 400],
    [{ direction: "lent", person: "ก", amount: "abc" }, 400],
    [{ direction: "gift", person: "ก", amount: "5" }, 400],
    [{ direction: "lent", person: "  ", amount: "5" }, 400],
    [{ direction: "lent", person: "ก", amount: "5", accountId: STRANGER }, 404],
  ])("%j is refused with %s", async (body, status) => {
    expect((await POST(req("POST", body))).status).toBe(status);
    expect(created).toHaveLength(0);
  });

  it("stops at 200 open debts for one person", async () => {
    debts = Array.from({ length: 200 }, (_, i) => debt({ id: `d${i}`, remainingSatang: 100 }));
    const res = await POST(req("POST", { direction: "lent", person: "สมชาย", amount: "5" }));
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });
});

describe("PATCH /api/debts/:id", () => {
  it("cannot make the debt smaller than what is already paid", async () => {
    debts = [debt({})];
    const res = await PATCH(req("PATCH", { amount: "50" }), params); // paid is ฿100
    expect(res.status).toBe(400);
    expect(patched).toHaveLength(0);
  });

  it("changes the amount and the wallet", async () => {
    debts = [debt({})];
    const res = await PATCH(req("PATCH", { amount: "800", accountId: MAIN }), params);
    expect(res.status).toBe(200);
    expect(patched[0]).toMatchObject({ amountSatang: 80000, accountId: MAIN });
  });

  it("is for paid plans only", async () => {
    plan = "free";
    debts = [debt({})];
    expect((await PATCH(req("PATCH", { note: "x" }), params)).status).toBe(403);
  });
});

describe("POST /api/debts/:id/payments", () => {
  it("pays into the debt's own wallet unless another is named", async () => {
    debts = [debt({})];
    await PAY(req("POST", { amount: "100" }), params);
    await PAY(req("POST", { amount: "50", accountId: MAIN }), params);
    expect(paid[0]).toMatchObject({
      accountId: BANK,
      parts: [{ debtId: DEBT, amountSatang: 10000 }],
    });
    expect(paid[1]).toMatchObject({ accountId: MAIN });
  });

  it("says when the debt is now settled", async () => {
    debts = [debt({})];
    const body = await (await PAY(req("POST", { amount: "400" }), params)).json();
    expect(body.settled).toBe(true);
  });

  it("refuses more than is left, a zero amount and a wallet that is not theirs", async () => {
    debts = [debt({})];
    expect((await PAY(req("POST", { amount: "400.01" }), params)).status).toBe(400);
    expect((await PAY(req("POST", { amount: "0" }), params)).status).toBe(400);
    expect((await PAY(req("POST", { amount: "10", accountId: STRANGER }), params)).status).toBe(
      404,
    );
    expect(paid).toHaveLength(0);
  });

  it("an unknown debt is a 404", async () => {
    expect((await PAY(req("POST", { amount: "10" }), params)).status).toBe(404);
  });
});
