import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "free";
let compareResult = {
  rows: [
    {
      name: "อาหาร",
      currentSatang: 15_000,
      previousSatang: 10_000,
      changePercent: 50,
      kind: "up" as const,
    },
  ],
  currentSatang: 15_000,
  previousSatang: 10_000,
};
let yearCount = 6;
let compareSpans: { c: [string, string]; p: [string, string] } | null = null;
let yearRange: { from: string; to: string } | null = null;

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
  loadCategoryCompare: async (
    _db: unknown,
    _user: string,
    c: { from: Date; to: Date },
    p: { from: Date; to: Date },
  ) => {
    compareSpans = {
      c: [c.from.toISOString(), c.to.toISOString()],
      p: [p.from.toISOString(), p.to.toISOString()],
    };
    return compareResult;
  },
  loadYearData: async (_db: unknown, _user: string, year: { range: { from: Date; to: Date } }) => {
    yearRange = { from: year.range.from.toISOString(), to: year.range.to.toISOString() };
    return {
      summary: {
        current: { income: 100_000, expense: 60_000, count: yearCount },
        previous: { income: 0, expense: 48_000, count: 3 },
        topExpenses: [{ name: "อาหาร", amountSatang: 30_000, percent: 50 }],
      },
      months: [
        { month: new Date("2025-12-31T17:00:00Z"), incomeSatang: 100_000, expenseSatang: 40_000 },
        { month: new Date("2026-01-31T17:00:00Z"), incomeSatang: 0, expenseSatang: 20_000 },
      ],
    };
  },
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
    now: () => new Date("2026-10-17T08:00:00Z"), // 17 Oct 2026 in Bangkok
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const first = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1][0] ?? {}) as { type?: string; text?: string };

beforeEach(() => {
  plan = "free";
  yearCount = 6;
  compareSpans = null;
  yearRange = null;
  compareResult = { ...compareResult, currentSatang: 15_000, previousSatang: 10_000 };
});

describe("เทียบเดือน", () => {
  it.each(["free", "starter"])(
    "is for Pro and above: %s gets the upsell and nothing is loaded",
    async (p) => {
      plan = p;
      const { deps, reply } = setup();
      await handleEvent(say("เทียบเดือน"), deps);
      expect(first(reply).text).toContain("Pro ขึ้นไป");
      expect(compareSpans).toBeNull();
    },
  );

  it.each(["plus", "ultimate"])("%s gets a card that compares the same days", async (p) => {
    plan = p;
    const { deps, reply } = setup();
    await handleEvent(say("เทียบเดือน"), deps);
    const json = JSON.stringify(first(reply));
    expect(first(reply).type).toBe("flex");
    expect(json).toContain("1 ต.ค. – 17 ต.ค.");
    expect(json).toContain("1 ก.ย. – 17 ก.ย.");
    expect(json).toContain("▲ 50%");
    expect(compareSpans).toEqual({
      c: ["2026-09-30T17:00:00.000Z", "2026-10-17T17:00:00.000Z"],
      p: ["2026-08-31T17:00:00.000Z", "2026-09-17T17:00:00.000Z"],
    });
  });

  it("says so when there is nothing to compare", async () => {
    plan = "plus";
    compareResult = { rows: [], currentSatang: 0, previousSatang: 0 };
    const { deps, reply } = setup();
    await handleEvent(say("เทียบเดือนก่อน"), deps);
    expect(first(reply).type).toBe("text");
    expect(first(reply).text).toContain("ยังไม่มีรายจ่าย");
  });
});

describe("สรุปปี", () => {
  it("is for Starter and above: Free gets the upsell and nothing is loaded", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("สรุปปี"), deps);
    expect(first(reply).text).toContain("Starter ขึ้นไป");
    expect(yearRange).toBeNull();
  });

  it("this year runs from 1 January to today and is shown in the Buddhist year", async () => {
    plan = "plus";
    const { deps, reply } = setup();
    await handleEvent(say("สรุปปี"), deps);
    const json = JSON.stringify(first(reply));
    expect(first(reply).type).toBe("flex");
    expect(json).toContain("สรุปรายปี 2569");
    expect(json).toContain("1 ม.ค. 2569 – 17 ต.ค. 2569");
    expect(json).toContain("เพิ่มขึ้น 25% จากปีก่อน");
    expect(yearRange).toEqual({
      from: "2025-12-31T17:00:00.000Z",
      to: "2026-10-17T17:00:00.000Z",
    });
  });

  it("accepts a Buddhist or Gregorian year and 'last year'", async () => {
    plan = "plus";
    for (const [input, from, to] of [
      ["สรุปปี 2568", "2024-12-31T17:00:00.000Z", "2025-12-31T17:00:00.000Z"],
      ["สรุปปี 2025", "2024-12-31T17:00:00.000Z", "2025-12-31T17:00:00.000Z"],
      ["สรุปปีที่แล้ว", "2024-12-31T17:00:00.000Z", "2025-12-31T17:00:00.000Z"],
    ] as const) {
      const { deps } = setup();
      await handleEvent(say(input), deps);
      expect(yearRange).toEqual({ from, to });
    }
  });

  it("refuses a future or too-old year with a clear message and loads nothing", async () => {
    plan = "plus";
    for (const input of ["สรุปปี 2030", "สรุปปี 2010"]) {
      const { deps, reply } = setup();
      await handleEvent(say(input), deps);
      expect(first(reply).text).toContain("ระบุปีไม่ถูกต้อง");
    }
    expect(yearRange).toBeNull();
  });

  it("a year with no entries answers in text", async () => {
    plan = "plus";
    yearCount = 0;
    const { deps, reply } = setup();
    await handleEvent(say("สรุปปี 2567"), deps);
    expect(first(reply).type).toBe("text");
    expect(first(reply).text).toContain("ยังไม่มีรายการ");
  });
});
