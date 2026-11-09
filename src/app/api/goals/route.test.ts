import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalProgress, type GoalDto } from "@/lib/goal";

let plan = "plus";
let goals: GoalDto[] = [];
const created: Record<string, unknown>[] = [];
const deposits: Record<string, unknown>[] = [];
let createResult = "new-id";
const G = "11111111-1111-4111-8111-111111111111";

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
vi.mock("@/lib/goal-repo", () => ({
  listGoals: async () => goals,
  createGoal: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return createResult;
  },
  addDeposit: async (_db: unknown, _u: string, goalId: string, input: Record<string, unknown>) => {
    deposits.push({ goalId, ...input });
    return "dep-1";
  },
  listDeposits: async () => [],
  updateGoal: async () => "ok",
  deleteGoal: async () => true,
  undoDeposit: async () => "ok",
}));

import { GET, POST } from "./route";
import { POST as DEPOSIT } from "./[id]/deposits/route";

const goal = (n: number, savedSatang = 0): GoalDto => {
  const base = { targetSatang: 3_000_000, savedSatang, dueOn: null };
  return {
    id: n === 1 ? G : `22222222-2222-4222-8222-22222222222${n}`,
    name: `เป้า ${n}`,
    emoji: null,
    archived: false,
    ...base,
    ...goalProgress(base, new Date("2026-10-18T05:00:00Z")),
  };
};
const req = (body?: unknown) =>
  new Request("https://app.example.com/api/goals", {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ id: G }) };

beforeEach(() => {
  plan = "plus";
  goals = [];
  created.length = 0;
  deposits.length = 0;
  createResult = "new-id";
});

describe("POST /api/goals", () => {
  it("is for Pro and above", async () => {
    plan = "free";
    const res = await POST(req({ name: "เที่ยว", target: "30000" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true });
    expect(created).toHaveLength(0);
  });

  it("saves the target as satang with the emoji and date", async () => {
    const res = await POST(
      req({ name: " เที่ยวญี่ปุ่น ", target: "30,000", emoji: "🇯🇵", dueOn: "2027-03-31" }),
    );
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({
      name: "เที่ยวญี่ปุ่น",
      targetSatang: 3_000_000,
      emoji: "🇯🇵",
      dueOn: "2027-03-31",
    });
  });

  it("Starter stops at 2 live goals, Pro at 10, Elite only at a hard cap of 100", async () => {
    plan = "starter";
    goals = [1, 2].map((n) => goal(n));
    const res = await POST(req({ name: "ที่ 3", target: "100" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ upgrade: true });

    plan = "plus";
    expect((await POST(req({ name: "ที่ 3", target: "100" }))).status).toBe(201);
    goals = Array.from({ length: 10 }, (_, i) => goal(i + 1));
    expect((await POST(req({ name: "ที่ 11", target: "100" }))).status).toBe(403);

    plan = "ultimate";
    expect((await POST(req({ name: "ที่ 11", target: "100" }))).status).toBe(201);
    goals = Array.from({ length: 100 }, (_, i) => goal(i + 1));
    const full = await POST(req({ name: "ที่ 101", target: "100" }));
    expect(full.status).toBe(403);
    expect(await full.json()).toMatchObject({ upgrade: false });
  });

  it("archived goals do not count towards the limit", async () => {
    goals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ ...goal(n), archived: true }));
    expect((await POST(req({ name: "ใหม่", target: "100" }))).status).toBe(201);
  });

  it.each([
    [{ name: "x", target: "0" }, 400],
    [{ name: "x", target: "abc" }, 400],
    [{ name: "", target: "100" }, 400],
    [{ name: "x", target: "100", emoji: "abc" }, 400],
    [{ name: "x", target: "100", dueOn: "31/3" }, 400],
  ])("%j is refused with %s", async (body, status) => {
    expect((await POST(req(body))).status).toBe(status);
    expect(created).toHaveLength(0);
  });

  it("a name already used is a 409", async () => {
    createResult = "duplicate";
    expect((await POST(req({ name: "เที่ยว", target: "100" }))).status).toBe(409);
  });
});

describe("GET /api/goals", () => {
  it("says what the plan allows", async () => {
    goals = [goal(1), goal(2)];
    expect(await (await GET(req())).json()).toMatchObject({ limit: 10, canAdd: true });
    plan = "free";
    expect(await (await GET(req())).json()).toMatchObject({ limit: 0, canAdd: false });
  });
});

describe("POST /api/goals/:id/deposits", () => {
  it("puts money in and tells when the target is reached", async () => {
    goals = [goal(1, 2_900_000)];
    const res = await DEPOSIT(req({ amount: "1000" }), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ savedSatang: 3_000_000, reachedTarget: true });
    expect(deposits[0]).toMatchObject({ goalId: G, amountSatang: 100_000 });
  });

  it("taking out records a negative amount, never more than is saved", async () => {
    goals = [goal(1, 50_000)];
    expect((await DEPOSIT(req({ amount: "200", direction: "out" }), params)).status).toBe(201);
    expect(deposits[0]).toMatchObject({ amountSatang: -20_000 });
    expect((await DEPOSIT(req({ amount: "500.01", direction: "out" }), params)).status).toBe(400);
  });

  it("is Pro and above, and refuses bad amounts and unknown goals", async () => {
    goals = [goal(1, 50_000)];
    plan = "free";
    expect((await DEPOSIT(req({ amount: "10" }), params)).status).toBe(403);
    plan = "plus";
    expect((await DEPOSIT(req({ amount: "0" }), params)).status).toBe(400);
    expect((await DEPOSIT(req({ amount: "abc" }), params)).status).toBe(400);
    goals = [];
    expect((await DEPOSIT(req({ amount: "10" }), params)).status).toBe(404);
  });
});
