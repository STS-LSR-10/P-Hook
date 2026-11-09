import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastInput } from "@/lib/forecast";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "free";
let loaded: ForecastInput | null = null;
let entryCount = 20;
let upcoming: ForecastInput["upcoming"] = [];
const loadCalls: { from: string; to: string }[] = [];

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
  loadForecastInput: async (
    _db: unknown,
    _user: string,
    now: Date,
    cycle: { from: Date; to: Date },
  ): Promise<ForecastInput> => {
    loadCalls.push({ from: cycle.from.toISOString(), to: cycle.to.toISOString() });
    loaded = {
      now,
      cycle,
      incomeSatang: 3_000_000,
      expenseSatang: 1_100_000,
      recurringExpenseSatang: 0,
      entryCount,
      last7VariableSatang: null,
      upcoming,
      budgetSatang: null,
    };
    return loaded;
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
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const first = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1][0] ?? {}) as { type?: string; text?: string };

beforeEach(() => {
  plan = "free";
  loaded = null;
  entryCount = 20;
  upcoming = [];
  loadCalls.length = 0;
});

describe("พยากรณ์", () => {
  it.each(["free", "starter"])(
    "is for Pro and above: %s gets the upsell and nothing is loaded",
    async (p) => {
      plan = p;
      const { deps, reply } = setup();
      await handleEvent(say("พยากรณ์"), deps);
      expect(first(reply).text).toContain("Pro");
      expect(loadCalls).toHaveLength(0);
    },
  );

  it("Elite gets a card for the current budget cycle", async () => {
    plan = "ultimate";
    const { deps, reply } = setup();
    await handleEvent(say("พยากรณ์ปลายเดือน"), deps);
    const json = JSON.stringify(first(reply));
    expect(first(reply).type).toBe("flex");
    expect(json).toContain("พยากรณ์เงินปลายรอบ");
    expect(json).toContain("1 ต.ค. 2569 – 31 ต.ค. 2569");
    expect(loadCalls[0]).toEqual({
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-31T17:00:00.000Z",
    });
  });

  it("with nothing recorded and nothing scheduled it says there is not enough to go on", async () => {
    plan = "ultimate";
    entryCount = 0;
    const { deps, reply } = setup();
    await handleEvent(say("พยากรณ์"), deps);
    expect(first(reply).type).toBe("text");
    expect(first(reply).text).toContain("ยังไม่มีข้อมูล");
  });

  it("a scheduled salary is enough to forecast even before the first entry", async () => {
    plan = "ultimate";
    entryCount = 0;
    upcoming = [
      {
        date: new Date("2026-10-24T17:00:00Z"),
        type: "income",
        amountSatang: 3_000_000,
        title: "เงินเดือน",
      },
    ];
    const { deps, reply } = setup();
    await handleEvent(say("พยากรณ์"), deps);
    expect(first(reply).type).toBe("flex");
  });
});
