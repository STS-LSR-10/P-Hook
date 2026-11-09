import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightWriter } from "@/lib/ai/insight-writer";
import { buildInsightFacts, type InsightFacts } from "@/lib/insight";
import { runSummaries } from "./summary-run";

let facts: InsightFacts | Error;
const loadFacts = vi.fn(async () => {
  if (facts instanceof Error) throw facts;
  return facts;
});

vi.mock("@/lib/summary-load", () => ({
  loadSummaryTransactions: async () => [
    // inside last month, and inside last week (26 Oct - 1 Nov)
    ...["2026-10-10T05:00:00Z", "2026-10-28T05:00:00Z"].map((at) => ({
      occurredAt: new Date(at),
      type: "expense",
      amountSatang: 50_000,
      categoryName: "อาหาร",
    })),
  ],
  loadInsightFacts: (...a: unknown[]) =>
    (loadFacts as unknown as (...x: unknown[]) => unknown)(...a),
}));

const b = (n: number) => n * 100;
const goodFacts = (expense = 10_000) =>
  buildInsightFacts({
    periodLabel: "1 ต.ค. – 31 ต.ค.",
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

// 09:30 on 1 November 2026 in Bangkok: the monthly summary of a cycle that starts on the 1st is due
const NOW = new Date("2026-11-01T02:30:00Z");
const MONDAY_NOW = new Date("2026-11-02T02:30:00Z"); // a Monday, 09:30 Bangkok

function fakeDb(plan: string, settings: Record<string, unknown> = {}) {
  const row = {
    user_id: "u1",
    budget_cycle: "monthly",
    cycle_start_day: 1,
    weekly_summary_enabled: false,
    monthly_summary_enabled: true,
    last_weekly_summary_on: null,
    last_monthly_summary_on: null,
    ...settings,
  };
  const from = (table: string) => {
    if (table === "user_settings") {
      return {
        select: () => ({ or: () => ({ limit: async () => ({ data: [row], error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    return {
      select: () => ({
        in: async () => ({
          data: [{ id: "u1", line_user_id: "U1", plan, plan_expires_at: null }],
          error: null,
        }),
      }),
    };
  };
  return { from } as unknown as SupabaseClient;
}

const push = vi.fn<(to: string, messages: unknown[]) => Promise<void>>(async () => undefined);
const write = vi.fn(async () => ({
  insights: ["รายจ่ายรวม ฿10,000 เพิ่มขึ้น 25% จากเดือนก่อน", "หมวดอาหารเพิ่มขึ้น 40% เป็น ฿4,200"],
  tip: null,
}));
const writer: InsightWriter = { name: "t", write };
const sentMessages = () => (push.mock.calls[0]?.[1] ?? []) as { altText?: string }[];

beforeEach(() => {
  facts = goodFacts();
  loadFacts.mockClear();
  push.mockClear();
  write.mockClear();
});

describe("runSummaries and the AI Insight", () => {
  it("Elite gets the AI Insight on the end of the monthly summary, in the same push", async () => {
    const result = await runSummaries(fakeDb("ultimate"), push, NOW, undefined, {
      insightWriter: writer,
    });
    expect(result.sent).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(sentMessages()).toHaveLength(2);
    expect(sentMessages()[0]?.altText).toContain("สรุปรายเดือน");
    expect(sentMessages()[1]?.altText).toContain("AI Insight");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("Starter gets the summary only, and no AI is called", async () => {
    await runSummaries(fakeDb("starter"), push, NOW, undefined, { insightWriter: writer });
    expect(sentMessages()).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it("Pro gets the AI Insight too (it is a Pro feature now)", async () => {
    await runSummaries(fakeDb("plus"), push, NOW, undefined, { insightWriter: writer });
    expect(sentMessages()).toHaveLength(2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("without an AI configured Elite still gets observations written by plain code", async () => {
    await runSummaries(fakeDb("ultimate"), push, NOW);
    expect(sentMessages()).toHaveLength(2);
    expect(JSON.stringify(sentMessages()[1])).toContain("สรุปจากตัวเลขของคุณ");
  });

  it("when the AI fails the plain-code observations are sent instead", async () => {
    write.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    await runSummaries(fakeDb("ultimate"), push, NOW, undefined, { insightWriter: writer });
    expect(sentMessages()).toHaveLength(2);
    expect(JSON.stringify(sentMessages()[1])).toContain("สรุปจากตัวเลขของคุณ");
  });

  it("when the facts cannot be loaded the summary still goes out alone", async () => {
    facts = new Error("db down");
    const result = await runSummaries(fakeDb("ultimate"), push, NOW, undefined, {
      insightWriter: writer,
    });
    expect(result).toMatchObject({ sent: 1, errors: 0 });
    expect(sentMessages()).toHaveLength(1);
  });

  it("a period with no spending has nothing to analyse: the summary goes out alone", async () => {
    facts = goodFacts(0);
    await runSummaries(fakeDb("ultimate"), push, NOW, undefined, { insightWriter: writer });
    expect(sentMessages()).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("the weekly summary never carries an Insight", async () => {
    await runSummaries(
      fakeDb("ultimate", { weekly_summary_enabled: true, monthly_summary_enabled: false }),
      push,
      MONDAY_NOW,
      undefined,
      { insightWriter: writer },
    );
    expect(sentMessages()).toHaveLength(1);
    expect(loadFacts).not.toHaveBeenCalled();
  });
});

describe("the summaries in the person's own zone", () => {
  it("Monday 09:00 is their Monday morning: not yet in Los Angeles at Bangkok's 09:30", async () => {
    const weekly = { weekly_summary_enabled: true, monthly_summary_enabled: false };
    const la = fakeDb("plus", { ...weekly, users: { timezone: "America/Los_Angeles" } });
    expect((await runSummaries(la, push, MONDAY_NOW)).candidates).toBe(0);
    // 09:30 Monday in Los Angeles (PST, UTC-8)
    const laMorning = new Date("2026-11-02T17:30:00Z");
    expect((await runSummaries(la, push, laMorning)).candidates).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
