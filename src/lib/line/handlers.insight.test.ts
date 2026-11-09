import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightWriter } from "@/lib/ai/insight-writer";
import { buildInsightFacts, type InsightFacts } from "@/lib/insight";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "free";
let facts: InsightFacts;
const factCalls: { current: [string, string]; previous: [string, string] }[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
  getSettings: async () => ({ budget_cycle: "monthly", cycle_start_day: 1 }),
}));
vi.mock("@/lib/summary-load", async (original) => ({
  ...(await original<typeof import("@/lib/summary-load")>()),
  loadInsightFacts: async (
    _db: unknown,
    _user: string,
    c: { from: Date; to: Date },
    p: { from: Date; to: Date },
  ) => {
    factCalls.push({
      current: [c.from.toISOString(), c.to.toISOString()],
      previous: [p.from.toISOString(), p.to.toISOString()],
    });
    return facts;
  },
}));

const b = (n: number) => n * 100;
const makeFacts = (expense = 10_000) =>
  buildInsightFacts({
    periodLabel: "1 ต.ค. – 17 ต.ค.",
    previousLabel: "เดือนก่อน",
    expenseSatang: b(expense),
    previousExpenseSatang: b(8000),
    incomeSatang: b(30_000),
    categories: [
      {
        name: "อาหาร",
        currentSatang: b(4200),
        previousSatang: b(3000),
        changePercent: 40,
        kind: "up",
      },
    ],
    titles: [],
  });

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});

const write = vi.fn(async () => ({
  insights: ["รายจ่ายรวม ฿10,000 เพิ่มขึ้น 25% จากเดือนก่อน", "หมวดอาหารเพิ่มขึ้น 40% เป็น ฿4,200"],
  tip: null,
}));
const writer: InsightWriter = { name: "t", write };

function setup(opts: { withWriter?: boolean; allowed?: boolean } = {}) {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: async (bucket) => ({
      allowed: bucket !== "insight_day" || opts.allowed !== false,
      hits: 1,
      limit: 5,
    }),
    ...(opts.withWriter === false ? {} : { insightWriter: writer }),
  };
  return { deps, reply };
}
const first = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1][0] ?? {}) as { type?: string; text?: string };

beforeEach(() => {
  plan = "free";
  facts = makeFacts();
  factCalls.length = 0;
  write.mockClear();
});

describe("วิเคราะห์", () => {
  it.each(["free", "starter"])(
    "is for Pro and above: %s gets the upsell and nothing is loaded",
    async (p) => {
      plan = p;
      const { deps, reply } = setup();
      await handleEvent(say("วิเคราะห์"), deps);
      expect(first(reply).text).toContain("Pro");
      expect(factCalls).toHaveLength(0);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("Elite gets an AI Insight card comparing the same days of the cycle before", async () => {
    plan = "ultimate";
    const { deps, reply } = setup();
    await handleEvent(say("วิเคราะห์"), deps);
    const json = JSON.stringify(first(reply));
    expect(first(reply).type).toBe("flex");
    expect(json).toContain("AI Insight");
    expect(json).toContain("สร้างโดย AI");
    expect(factCalls[0]).toEqual({
      current: ["2026-09-30T17:00:00.000Z", "2026-10-17T17:00:00.000Z"],
      previous: ["2026-08-31T17:00:00.000Z", "2026-09-17T17:00:00.000Z"],
    });
  });

  it("works without an AI configured: plain-code observations, no AI claim", async () => {
    plan = "ultimate";
    const { deps, reply } = setup({ withWriter: false });
    await handleEvent(say("วิเคราะห์การใช้จ่าย"), deps);
    const json = JSON.stringify(first(reply));
    expect(first(reply).type).toBe("flex");
    expect(json).not.toContain("สร้างโดย AI");
    expect(json).toContain("สรุปจากตัวเลขของคุณ");
  });

  it("stops at the daily limit before loading or calling anything", async () => {
    plan = "ultimate";
    const { deps, reply } = setup({ allowed: false });
    await handleEvent(say("วิเคราะห์"), deps);
    expect(first(reply).text).toContain("ครบจำนวนแล้ว");
    expect(factCalls).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("a cycle with no spending says there is nothing to analyse", async () => {
    plan = "ultimate";
    facts = makeFacts(0);
    const { deps, reply } = setup();
    await handleEvent(say("วิเคราะห์"), deps);
    expect(first(reply).type).toBe("text");
    expect(first(reply).text).toContain("ยังไม่มีรายจ่าย");
    expect(write).not.toHaveBeenCalled();
  });
});
