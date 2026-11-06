import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

const learn = vi.fn(async () => undefined);
vi.mock("@/lib/style-repo", () => ({
  learnStyle: (...a: unknown[]) => learn(...(a as [])),
  loadStyleHints: async () => [],
}));

const style = "short";
const CATEGORIES = [
  {
    id: "cat",
    user_id: "u1",
    type: "expense",
    name: "ค่าอาหารแมว",
    icon: "🐱",
    color: "#7C3AED",
    keywords: ["ทราย"],
    sort_order: 1,
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
  }),
  loadCategories: async () => CATEGORIES,
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => ({
    id: "t1",
    status: input.status,
    type: input.type,
    title: input.title,
    amount: "50.00",
    occurred_at: "2026-10-17T08:00:00Z",
    category_id: input.categoryId,
    slip_id: null,
  }),
  categoryTotalSatang: async () => 5000,
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
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}

beforeEach(() => learn.mockClear());

describe("learning how a person types", () => {
  it("learns from an entry the rules read themselves", async () => {
    const { deps } = setup();
    await handleEvent(say("50 ข้าว"), deps);
    expect(learn).toHaveBeenCalledWith(deps.db, "u1", "50 ข้าว");
  });

  it("learns nothing from a message that is not one entry", async () => {
    const { deps } = setup();
    await handleEvent(say("ข้าว 50 ทราย 40"), deps);
    await handleEvent(say("สวัสดี"), deps);
    expect(learn).not.toHaveBeenCalled();
  });
});
