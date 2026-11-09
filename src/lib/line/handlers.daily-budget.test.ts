import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "plus";
let dailyBudget: string | null = "500.00";
let todaySpent = 62_000; // including the entry being recorded
const saved: Record<string, unknown>[] = [];

vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: "short",
    budget_cycle: "monthly",
    cycle_start_day: 1,
    daily_budget: dailyBudget,
  }),
  getBudgetMode: async () => "overall",
  loadBudgets: async () => [],
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  expenseTotalSatang: async () => todaySpent,
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => ({
    id: "t1",
    status: input.status,
    type: input.type,
    title: input.title,
    amount: String((input.amountSatang as number) / 100),
    occurred_at: (input.occurredAt as Date).toISOString(),
    category_id: null,
    slip_id: null,
  }),
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
  const db = {
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        saved.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const deps: HandlerDeps = {
    db,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-18T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const everything = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));

beforeEach(() => {
  plan = "plus";
  dailyBudget = "500.00";
  todaySpent = 62_000;
  saved.length = 0;
});

describe("the daily limit after recording", () => {
  it("scolds when today's spending went over it", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ช้อปปิ้ง 300"), deps); // ฿620 today, was ฿320
    // the phrasing is random; every phrasing names the excess
    expect(everything(reply)).toContain("฿120");
  });

  it("once over, a further entry gets the short line", async () => {
    todaySpent = 70_000;
    const { deps, reply } = setup();
    await handleEvent(say("ขนม 80"), deps); // was ฿620, now ฿700
    expect(everything(reply)).toContain("ยังเกินงบวันนี้อยู่ ฿200");
  });

  it("is quiet under the limit, for income, for Free and for a backdated entry", async () => {
    todaySpent = 20_000;
    let { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    expect(everything(reply)).not.toContain("งบวันนี้");

    todaySpent = 90_000;
    ({ deps, reply } = setup());
    await handleEvent(say("+300 ขายของ"), deps);
    expect(everything(reply)).not.toContain("เกิน");

    plan = "free";
    ({ deps, reply } = setup());
    await handleEvent(say("ช้อปปิ้ง 300"), deps);
    expect(everything(reply)).not.toContain("งบ");

    plan = "plus";
    ({ deps, reply } = setup());
    await handleEvent(say("เมื่อวาน ช้อปปิ้ง 300"), deps);
    expect(everything(reply)).not.toContain("เกินงบ");
  });

  it("two entries in one message give one warning", async () => {
    todaySpent = 62_000;
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 150, ช้อปปิ้ง 150"), deps);
    const count = everything(reply).split("฿120").length - 1;
    expect(count).toBe(1);
  });
});

describe("the งบวัน command", () => {
  it("sets the limit", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("งบวัน 800"), deps);
    expect(saved[0]).toMatchObject({ user_id: "u1", daily_budget: "800.00" });
    expect(everything(reply)).toContain("ตั้งงบรายวัน ฿800");
  });

  it("shows where today stands", async () => {
    todaySpent = 32_000;
    const { deps, reply } = setup();
    await handleEvent(say("งบวัน"), deps);
    expect(everything(reply)).toContain("ใช้ไป ฿320 (64%)");
  });

  it("says so when none is set", async () => {
    dailyBudget = null;
    const { deps, reply } = setup();
    await handleEvent(say("งบวัน"), deps);
    expect(everything(reply)).toContain("ยังไม่ได้ตั้งงบรายวัน");
  });

  it("clears it, even on Free", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("งบวัน ปิด"), deps);
    expect(saved[0]).toMatchObject({ daily_budget: null });
    expect(everything(reply)).toContain("ปิดงบรายวันแล้ว");
  });

  it("Free cannot set or view it", async () => {
    plan = "free";
    let { deps, reply } = setup();
    await handleEvent(say("งบวัน 500"), deps);
    expect(saved).toHaveLength(0);
    expect(everything(reply)).toContain("Starter");

    ({ deps, reply } = setup());
    await handleEvent(say("งบวัน"), deps);
    expect(everything(reply)).toContain("Starter");
  });

  it("a bad amount shows the usage", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("งบวัน abc"), deps);
    expect(saved).toHaveLength(0);
    expect(everything(reply)).toContain("งบวัน 500");
  });
});
