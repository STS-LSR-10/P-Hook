import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let style = "full";
let budgets: { category_id: string | null; amount: number }[] = [];
let spent = 0;
let nextId = 0;
let mode = "overall";

const CATEGORIES = [
  {
    id: "cat",
    user_id: "u1",
    type: "expense",
    name: "อาหารแมว",
    icon: "🐱",
    color: "#7C3AED",
    keywords: ["ทราย"],
    sort_order: 1,
    is_hidden: false,
  },
  {
    id: "snack",
    user_id: null,
    type: "expense",
    name: "ของกินเล่น",
    icon: "x",
    color: "#0F766E",
    keywords: ["ขนม"],
    sort_order: 3,
    is_hidden: false,
  },
  {
    id: "ride",
    user_id: null,
    type: "expense",
    name: "ค่ารถ",
    icon: "x",
    color: "#0F766E",
    keywords: ["รถ"],
    sort_order: 4,
    is_hidden: false,
  },
  {
    id: "food",
    user_id: null,
    type: "expense",
    name: "อาหาร",
    icon: "utensils",
    color: "#0F766E",
    keywords: ["ข้าว"],
    sort_order: 2,
    is_hidden: false,
  },
];

vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan: "plus", plan_expires_at: null }),
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan: "plus",
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: style,
    budget_cycle: "monthly",
    cycle_start_day: 1,
    daily_budget: null,
    card_theme: "mint",
    bot_persona: "plain",
  }),
  getBudgetMode: async () => mode,
  loadBudgets: async () => budgets,
  loadCategories: async () => CATEGORIES,
  loadMemoryFor: async () => [],
  expenseTotalSatang: async () => spent,
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => ({
    id: `t${++nextId}`,
    status: input.status,
    type: input.type,
    title: input.title,
    amount: String((input.amountSatang as number) / 100),
    occurred_at: (input.occurredAt as Date).toISOString(),
    category_id: input.categoryId,
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
  const reply = vi.fn<(token: string, messages: Record<string, unknown>[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply: reply as unknown as HandlerDeps["reply"],
    getProfile: async () => null,
    now: () => new Date("2026-10-18T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) => reply.mock.calls[0]?.[1] ?? [];
const all = (reply: ReturnType<typeof setup>["reply"]) => JSON.stringify(sent(reply));
const flexes = (reply: ReturnType<typeof setup>["reply"]) =>
  sent(reply).filter((m) => m.type === "flex");

beforeEach(() => {
  process.env.NEXT_PUBLIC_LIFF_ID = "liff1";
  style = "full";
  budgets = [];
  spent = 0;
  nextId = 0;
  mode = "overall";
});

describe("several entries in one message", () => {
  it("come back as one card with a row, an edit and a delete button for each", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50, น้ำ 10"), deps);
    expect(flexes(reply)).toHaveLength(1);
    const json = all(reply);
    expect(json).toContain("จดสำเร็จ 2 รายการ");
    for (const id of ["t1", "t2"]) {
      expect(json).toContain(`a=del&id=${id}`);
      expect(json).toContain(`transactions?edit=${id}`);
    }
  });

  it("stay one card past three entries instead of turning into plain text", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50, น้ำ 10, ขนม 20, กาแฟ 45, ส้ม 15"), deps);
    expect(flexes(reply)).toHaveLength(1);
    expect(all(reply)).toContain("จดสำเร็จ 5 รายการ");
    expect(sent(reply).filter((m) => m.type === "text")).toHaveLength(0);
  });

  it("show the category emoji and total", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ทราย 50, น้ำ 10"), deps);
    const json = all(reply);
    expect(json).toContain("🐱");
    expect(json).toContain("-฿60");
  });

  it("show where the overall budget stands, once", async () => {
    budgets = [{ category_id: null, amount: 15000 }];
    spent = 1_019_600;
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50, น้ำ 10"), deps);
    const json = all(reply);
    expect(json).toContain("งบเดือนนี้ ฿15,000");
    expect(json).toContain("68%");
    expect(json.split("งบเดือนนี้ ฿15,000").length - 1).toBe(1);
  });

  it("with the short style are still plain text", async () => {
    style = "short";
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50, น้ำ 10"), deps);
    expect(flexes(reply)).toHaveLength(0);
  });

  it("a single entry keeps the usual card", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50"), deps);
    const json = all(reply);
    expect(json).toContain("จดสำเร็จ ✅");
    expect(json).not.toContain("รายการ ✅");
  });

  it("warn once, on the card, and never again as separate messages", async () => {
    budgets = [{ category_id: null, amount: 15000 }];
    spent = 1_510_000; // ฿15,100 after the two entries
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 150, น้ำ 150"), deps);
    expect(flexes(reply)).toHaveLength(1);
    expect(all(reply)).toContain("🚨");
    expect(sent(reply).filter((m) => m.type === "text")).toHaveLength(0);
  });

  it("with category budgets show the one that has a budget, even as the fourth category", async () => {
    mode = "category";
    budgets = [{ category_id: "ride", amount: 100 }];
    spent = 9_000;
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 50, ทราย 20, ขนม 30, รถ 40"), deps);
    expect(flexes(reply)).toHaveLength(1);
    expect(all(reply)).toContain("งบค่ารถ");
  });
});
