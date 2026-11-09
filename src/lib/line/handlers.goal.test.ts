import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { goalProgress, type GoalDto } from "@/lib/goal";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "plus";
let goals: GoalDto[] = [];
let undoResult: "ok" | "missing" | "blocked" = "ok";
const created: Record<string, unknown>[] = [];
const deposits: Record<string, unknown>[] = [];
const undone: string[] = [];
const NOW = new Date("2026-10-18T05:00:00Z");

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
  }),
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => ({
    id: "t1",
    status: input.status,
    type: input.type,
    title: input.title,
    amount: "50.00",
    occurred_at: NOW.toISOString(),
    category_id: null,
    slip_id: null,
  }),
  categoryTotalSatang: async () => 0,
}));
vi.mock("@/lib/goal-repo", () => ({
  listGoals: async () => goals,
  createGoal: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return input.name === "ซ้ำ" ? "duplicate" : "g-new";
  },
  addDeposit: async (_db: unknown, _u: string, goalId: string, input: Record<string, unknown>) => {
    deposits.push({ goalId, ...input });
    return "dep-1";
  },
  undoDeposit: async (_db: unknown, _u: string, _g: string, depositId: string) => {
    undone.push(depositId);
    return undoResult;
  },
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});
const postback = (data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  postback: { data },
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
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));

const goal = (name: string, savedSatang: number, over: Partial<GoalDto> = {}): GoalDto => {
  const base = { targetSatang: 3_000_000, savedSatang, dueOn: null as string | null };
  return {
    id: `id-${name}`,
    name,
    emoji: null,
    archived: false,
    ...base,
    ...goalProgress(base, NOW),
    ...over,
  };
};

beforeEach(() => {
  plan = "plus";
  goals = [goal("เที่ยวญี่ปุ่น", 1_200_000), goal("รถ", 0)];
  undoResult = "ok";
  created.length = 0;
  deposits.length = 0;
  undone.length = 0;
});

describe("เป้าหมาย", () => {
  it("lists the goals with progress", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เป้าหมาย"), deps);
    const json = sent(reply);
    expect(json).toContain("เที่ยวญี่ปุ่น");
    expect(json).toContain("40%");
  });

  it("explains how to start when there are none; Free is told it needs Starter", async () => {
    goals = [];
    let { deps, reply } = setup();
    await handleEvent(say("เป้าหมาย"), deps);
    expect(sent(reply)).toContain("ยังไม่มีเป้าหมายการออม");

    plan = "free";
    ({ deps, reply } = setup());
    await handleEvent(say("เป้าหมาย"), deps);
    expect(sent(reply)).toContain("Starter");
  });
});

describe("เป้าหมาย ใหม่", () => {
  it("creates a goal with a target and a date", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เป้าหมาย ใหม่ บ้าน 500000 ภายใน 31/3"), deps);
    expect(created[0]).toMatchObject({
      name: "บ้าน",
      targetSatang: 50_000_000,
      dueOn: "2027-03-31",
    });
    expect(sent(reply)).toContain("สร้างเป้าหมายแล้ว");
  });

  it("refuses a name already used, and a full set", async () => {
    let { deps, reply } = setup();
    await handleEvent(say("เป้าหมาย ใหม่ ซ้ำ 100"), deps);
    expect(sent(reply)).toContain("มีเป้าหมายชื่อนี้อยู่แล้ว");

    goals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => goal(`g${n}`, 0));
    created.length = 0;
    ({ deps, reply } = setup());
    await handleEvent(say("เป้าหมาย ใหม่ ที่หก 100"), deps);
    expect(created).toHaveLength(0);
    expect(sent(reply)).toContain("มีเป้าหมายได้ 10 ใบแล้ว");
    expect(sent(reply)).toContain("Elite"); // what the next plan up has
  });

  it("Free is told it needs Starter", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("เป้าหมาย ใหม่ บ้าน 1000"), deps);
    expect(created).toHaveLength(0);
    expect(sent(reply)).toContain("Starter");
  });
});

describe("ออม / ถอน", () => {
  it("puts money in and says where the goal stands, with an undo button", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ออม เที่ยวญี่ปุ่น 2000"), deps);
    expect(deposits[0]).toMatchObject({ goalId: "id-เที่ยวญี่ปุ่น", amountSatang: 200_000 });
    const json = sent(reply);
    expect(json).toContain("หยอดแล้ว ฿2,000");
    expect(json).toContain("฿14,000 จาก ฿30,000 (46%)");
    expect(json).toContain("a=gx&id=dep-1&g=id-เที่ยวญี่ปุ่น");
  });

  it("the deposit that reaches the target gets the celebration", async () => {
    goals = [goal("รถ", 2_900_000)];
    const { deps, reply } = setup();
    await handleEvent(say("ออม รถ 1000"), deps);
    expect(sent(reply)).toContain("ถึงเป้าแล้ว");
  });

  it("a deposit that does not reach it gets no celebration", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ออม รถ 10"), deps);
    expect(sent(reply)).not.toContain("ถึงเป้าแล้ว");
  });

  it("takes money out, but not more than is saved", async () => {
    let { deps, reply } = setup();
    await handleEvent(say("ถอน เที่ยวญี่ปุ่น 500"), deps);
    expect(deposits[0]).toMatchObject({ amountSatang: -50_000 });
    expect(sent(reply)).toContain("ถอนแล้ว ฿500");

    deposits.length = 0;
    ({ deps, reply } = setup());
    await handleEvent(say("ถอน เที่ยวญี่ปุ่น 99999"), deps);
    expect(deposits).toHaveLength(0);
    expect(sent(reply)).toContain("ถอนเกินยอดที่ออมไว้ไม่ได้");
  });

  it("a unique start of the name is enough; several matches ask for more", async () => {
    goals = [goal("เที่ยวญี่ปุ่น", 0), goal("เที่ยวเกาหลี", 0)];
    let { deps, reply } = setup();
    await handleEvent(say("ออม เที่ยวญี่ 100"), deps);
    expect(deposits[0]).toMatchObject({ goalId: "id-เที่ยวญี่ปุ่น" });

    deposits.length = 0;
    ({ deps, reply } = setup());
    await handleEvent(say("ออม เที่ยว 100"), deps);
    expect(deposits).toHaveLength(0);
    expect(sent(reply)).toContain("ตรงกับหลายเป้าหมาย");
  });

  it("a name that is none of their goals is an ordinary message (e.g. a saving at a bank)", async () => {
    const { deps } = setup();
    await handleEvent(say("ออม ธนาคาร 500"), deps);
    expect(deposits).toHaveLength(0);
  });

  it("Free typing it gets an ordinary message too, not a lock", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("ออม เที่ยวญี่ปุ่น 2000"), deps);
    expect(deposits).toHaveLength(0);
    expect(sent(reply)).not.toContain("Pro");
  });
});

describe("the undo button", () => {
  it("removes the deposit", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=gx&id=dep-1&g=id-รถ"), deps);
    expect(undone).toEqual(["dep-1"]);
    expect(sent(reply)).toContain("ยกเลิกรายการหยอดกระปุกแล้ว");
  });

  it("says when a later withdrawal depends on it, or when it is gone", async () => {
    undoResult = "blocked";
    let { deps, reply } = setup();
    await handleEvent(postback("a=gx&id=dep-1&g=id-รถ"), deps);
    expect(sent(reply)).toContain("ยกเลิกรายการนี้ไม่ได้");

    undoResult = "missing";
    ({ deps, reply } = setup());
    await handleEvent(postback("a=gx&id=dep-1&g=id-รถ"), deps);
    expect(sent(reply)).toContain("ไม่พบ");
  });
});
