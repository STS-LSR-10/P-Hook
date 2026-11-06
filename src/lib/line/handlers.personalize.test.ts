import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "plus";
let theme = "ocean";
let persona = "bestie";

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
  getSettings: async () => {
    return {
      confirm_style: "full",
      budget_cycle: "monthly",
      cycle_start_day: 1,
      daily_budget: null,
      card_theme: theme,
      bot_persona: persona,
    };
  },
  getBudgetMode: async () => "overall",
  loadBudgets: async () => [],
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  expenseTotalSatang: async () => 0,
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
    from: () => ({ upsert: async () => ({ error: null }) }),
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
  theme = "ocean";
  persona = "bestie";
});

describe("theme and manner in the chat", () => {
  it("a Pro user gets the chosen colours and a line in the chosen manner after saving", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    const text = everything(reply);
    expect(text).toContain("#E0F2FE"); // ocean header band
    expect(text).not.toContain("#CCFBF1"); // the mint band is gone
    expect(text).toMatch(/จดให้แล้วจ้า|เก็บเข้าสมุด|เรียบร้อย|ลงบัญชี|จำให้เอง/);
  });

  it("Free keeps the default look and tone", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    const text = everything(reply);
    expect(text).toContain("#CCFBF1");
    expect(text).not.toContain("#E0F2FE");
    expect(text).not.toMatch(/จดให้แล้วจ้า|เก็บเข้าสมุด|ลงบัญชีแล้ว ไม่หลุด|จำให้เอง/);
  });

  it("a free plan adds no extra line, whatever manner was saved", async () => {
    plan = "free";
    theme = "mint";
    persona = "bestie";
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    const sent = reply.mock.calls[0]?.[1] ?? [];
    expect(sent.length).toBeLessThanOrEqual(1);
  });
});
