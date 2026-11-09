import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

type Row = {
  occurred_at: string;
  type: string;
  amount: string;
  categories: { name: string } | null;
};
let rows: Row[] = [];
let lastRange: { from: string; to: string } | null = null;

let plan = "free";
let rangeCalls: { from: string; to: string; prevFrom: string; prevTo: string }[] = [];
let rangeCount = 4;

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
vi.mock("@/lib/summary-load", () => ({
  loadSummaryData: async (
    _db: unknown,
    _user: string,
    range: { from: Date; to: Date },
    previous: { from: Date; to: Date },
  ) => {
    rangeCalls.push({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      prevFrom: previous.from.toISOString(),
      prevTo: previous.to.toISOString(),
    });
    return {
      current: { income: 100_000, expense: 40_000, count: rangeCount },
      previous: { income: 0, expense: 20_000, count: 2 },
      topExpenses: [{ name: "อาหาร", amountSatang: 20_000, percent: 50 }],
    };
  },
  loadSummaryTransactions: async (_db: unknown, _user: string, from: Date, to: Date) => {
    lastRange = { from: from.toISOString(), to: to.toISOString() };
    return rows
      .filter((r) => r.occurred_at >= lastRange!.from && r.occurred_at < lastRange!.to)
      .map((r) => ({
        occurredAt: new Date(r.occurred_at),
        type: r.type as "income" | "expense",
        amountSatang: Math.round(Number(r.amount) * 100),
        categoryName: r.categories?.name ?? null,
      }));
  },
}));

const NOW = new Date("2026-10-17T08:00:00Z"); // 15:00 on 17 Oct in Bangkok
const row = (at: string, type: string, amount: string, cat: string | null): Row => ({
  occurred_at: at,
  type,
  amount,
  categories: cat ? { name: cat } : null,
});

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
    now: () => NOW,
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? []) as { type: string; text?: string }[];

beforeEach(() => {
  plan = "free";
  rangeCalls = [];
  rangeCount = 4;
  rows = [];
  lastRange = null;
  delete process.env.APP_BASE_URL;
});

describe("สรุปวันนี้", () => {
  it("is a flex card with today's totals and top categories", async () => {
    rows = [
      row("2026-10-17T02:00:00Z", "expense", "120.00", "อาหาร"),
      row("2026-10-17T05:00:00Z", "expense", "60.00", "เดินทาง"),
      row("2026-10-17T03:00:00Z", "income", "500.00", null),
      row("2026-10-16T05:00:00Z", "expense", "999.00", "อาหาร"), // yesterday: not counted
    ];
    const { deps, reply } = setup();
    await handleEvent(say("สรุปวันนี้"), deps);
    const msg = sent(reply)[0]!;
    const json = JSON.stringify(msg);
    expect(msg.type).toBe("flex");
    expect(json).toContain("สรุปวันนี้");
    expect(json).toContain("17 ต.ค. 2569");
    expect(json).toContain("+฿500");
    expect(json).toContain("-฿180");
    expect(json).toContain("฿320"); // net
    expect(json).toContain("อาหาร");
    expect(json).toContain("จดไว้ 3 รายการ");
  });

  it("does not compare a single day with yesterday", async () => {
    rows = [row("2026-10-17T02:00:00Z", "expense", "120.00", "อาหาร")];
    const { deps, reply } = setup();
    await handleEvent(say("สรุปวันนี้"), deps);
    expect(JSON.stringify(sent(reply)[0])).not.toMatch(/เพิ่มขึ้น|ลดลง/);
  });

  it("says so in plain text when nothing was recorded", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("สรุปวันนี้"), deps);
    const msg = sent(reply)[0]!;
    expect(msg.type).toBe("text");
    expect(msg.text).toContain("ยังไม่มีรายการเลย");
  });
});

describe("สรุปเดือนนี้", () => {
  it("is a flex card for the budget cycle, compared with the month before", async () => {
    rows = [
      row("2026-10-05T05:00:00Z", "expense", "300.00", "อาหาร"),
      row("2026-10-06T05:00:00Z", "income", "1000.00", null),
      row("2026-09-10T05:00:00Z", "expense", "200.00", "อาหาร"), // previous month
    ];
    const { deps, reply } = setup();
    await handleEvent(say("สรุปเดือนนี้"), deps);
    const json = JSON.stringify(sent(reply)[0]);
    expect(json).toContain("สรุปเดือนนี้");
    expect(json).toContain("-฿300");
    expect(json).toContain("+฿1,000");
    expect(json).toContain("เพิ่มขึ้น 50% จากเดือนก่อน");
    // it loaded this month and the one before in one go
    expect(lastRange?.from).toBe("2026-08-31T17:00:00.000Z"); // 1 Sep, Bangkok
    expect(lastRange?.to).toBe("2026-10-31T17:00:00.000Z"); // 1 Nov, Bangkok
  });

  it("has a details button only when the app URL is https", async () => {
    rows = [row("2026-10-05T05:00:00Z", "expense", "300.00", "อาหาร")];
    process.env.APP_BASE_URL = "https://app.example.com/";
    const a = setup();
    await handleEvent(say("สรุปเดือนนี้"), a.deps);
    expect(JSON.stringify(sent(a.reply)[0])).toContain("https://app.example.com/summary");

    process.env.APP_BASE_URL = "http://localhost:3000";
    const b = setup();
    await handleEvent(say("สรุปเดือนนี้"), b.deps);
    expect(JSON.stringify(sent(b.reply)[0])).not.toContain("ดูรายละเอียด");
  });

  it("empty month is a plain text answer", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("สรุปเดือนนี้"), deps);
    expect(sent(reply)[0]?.text).toContain("ยังไม่มีรายการเลย");
  });
});

const tap = (data: string, params?: { date?: string }): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  postback: { data, ...(params ? { params } : {}) },
});
type Quick = { quickReply?: { items: { action: Record<string, string> }[] } };

describe("the ช่วงวันเอง shortcut under the summary cards", () => {
  it("is on both the day and the month card, for every plan", async () => {
    rows = [row("2026-10-17T02:00:00Z", "expense", "120.00", "อาหาร")];
    for (const t of ["สรุปวันนี้", "สรุปเดือนนี้"]) {
      const { deps, reply } = setup();
      await handleEvent(say(t), deps);
      const item = (sent(reply)[0] as unknown as Quick).quickReply?.items[0]?.action;
      expect(item?.data).toBe("a=sr");
    }
  });
});

describe("สรุป <วันเริ่ม> ถึง <วันจบ>", () => {
  it("is for Starter and above: Free gets the upsell and nothing is loaded", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("สรุป 1/10 ถึง 15/10"), deps);
    expect(sent(reply)[0]?.text).toContain("Starter ขึ้นไป");
    expect(rangeCalls).toHaveLength(0);
  });

  it.each(["plus", "ultimate"])("%s gets a card for exactly those days", async (p) => {
    plan = p;
    const { deps, reply } = setup();
    await handleEvent(say("สรุป 1/10 ถึง 15/10"), deps);
    const json = JSON.stringify(sent(reply)[0]);
    expect(json).toContain("สรุปช่วงที่เลือก");
    expect(json).toContain("15 วัน");
    expect(json).toContain("1 ต.ค. 2569 – 15 ต.ค. 2569");
    expect(json).toContain("จากช่วงก่อนหน้า");
    expect(rangeCalls[0]).toEqual({
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-15T17:00:00.000Z",
      prevFrom: "2026-09-15T17:00:00.000Z",
      prevTo: "2026-09-30T17:00:00.000Z",
    });
  });

  it("an empty range says so in text", async () => {
    plan = "plus";
    rangeCount = 0;
    const { deps, reply } = setup();
    await handleEvent(say("สรุป 1/10 ถึง 15/10"), deps);
    expect(sent(reply)[0]?.type).toBe("text");
    expect(sent(reply)[0]?.text).toContain("ยังไม่มีรายการเลย");
  });

  it.each([
    ["สรุป 15/10/2026 ถึง 1/10/2026", "วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด"],
    ["สรุป 31/2 ถึง 1/3", "วันที่ไม่ถูกต้อง"],
    ["สรุป 1/1/2024 ถึง วันนี้", "ไม่เกิน 366 วัน"],
    ["สรุป 1/10", "ระบุช่วงวันที่ให้ครบ"],
  ])("%s -> a clear message and no loading", async (input, expected) => {
    plan = "plus";
    const { deps, reply } = setup();
    await handleEvent(say(input), deps);
    expect(sent(reply)[0]?.text).toContain(expected);
    expect(rangeCalls).toHaveLength(0);
  });
});

describe("the two-step calendar (a=sr, a=sr1, a=sr2)", () => {
  const action = (reply: ReturnType<typeof setup>["reply"]) =>
    (sent(reply)[0] as unknown as Quick).quickReply?.items[0]?.action;

  it("Free is turned away at every step", async () => {
    for (const [data, params] of [
      ["a=sr", undefined],
      ["a=sr1", { date: "2026-10-01" }],
      ["a=sr2&f=2026-10-01", { date: "2026-10-15" }],
    ] as const) {
      const { deps, reply } = setup();
      await handleEvent(tap(data, params), deps);
      expect(sent(reply)[0]?.text).toContain("Starter ขึ้นไป");
      expect((sent(reply)[0] as unknown as Quick).quickReply).toBeUndefined();
    }
    expect(rangeCalls).toHaveLength(0);
  });

  it("step 1 offers the first-day calendar, step 2 the last-day calendar that keeps the first day", async () => {
    plan = "plus";
    const a = setup();
    await handleEvent(tap("a=sr"), a.deps);
    expect(action(a.reply)).toMatchObject({ type: "datetimepicker", data: "a=sr1", mode: "date" });

    const b = setup();
    await handleEvent(tap("a=sr1", { date: "2026-10-01" }), b.deps);
    expect(action(b.reply)).toMatchObject({
      type: "datetimepicker",
      data: "a=sr2&f=2026-10-01",
      min: "2026-10-01",
      max: "2026-10-17",
    });
    expect(sent(b.reply)[0]?.text).toContain("1 ต.ค. 2569");
  });

  it("step 3 gives the card for the two chosen days", async () => {
    plan = "plus";
    const { deps, reply } = setup();
    await handleEvent(tap("a=sr2&f=2026-10-01", { date: "2026-10-15" }), deps);
    expect(JSON.stringify(sent(reply)[0])).toContain("15 วัน");
    expect(rangeCalls[0]?.from).toBe("2026-09-30T17:00:00.000Z");
  });

  it("a missing or broken date is refused", async () => {
    plan = "plus";
    for (const [data, params] of [
      ["a=sr1", undefined],
      ["a=sr1", { date: "nope" }],
      ["a=sr2&f=2026-10-01", undefined],
      ["a=sr2&f=bad", { date: "2026-10-15" }],
      ["a=sr2", { date: "2026-10-15" }],
    ] as const) {
      const { deps, reply } = setup();
      await handleEvent(tap(data, params), deps);
      expect(sent(reply)[0]?.text).toContain("วันที่ไม่ถูกต้อง");
    }
    expect(rangeCalls).toHaveLength(0);
  });
});

describe("สรุป alone, the ready-made summaries and more ways to type a range", () => {
  type Quick = {
    quickReply?: { items: { action: { type: string; text?: string; uri?: string } }[] };
  };

  it("สรุป asks which summary, with a button for each (and one that opens the page)", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
    const { deps, reply } = setup();
    await handleEvent(say("สรุป"), deps);
    const msg = sent(reply)[0] as unknown as { text: string } & Quick;
    expect(msg.text).toContain("อยากดูสรุปแบบไหน");
    const items = msg.quickReply?.items ?? [];
    const texts = items.filter((i) => i.action.type === "message").map((i) => i.action.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "สรุปวันนี้",
        "สรุปเมื่อวาน",
        "สรุปสัปดาห์นี้",
        "สรุปเดือนนี้",
        "สรุปเดือนที่แล้ว",
        "สรุปหมวด",
        "เทียบเดือน",
        "สรุปปีนี้",
        "สรุปช่วง",
      ]),
    );
    expect(items.length).toBeLessThanOrEqual(13); // LINE's limit
    expect(items.at(-1)?.action.uri).toBe("https://liff.line.me/1234-abcd/summary");
    expect(rangeCalls).toHaveLength(0); // asking loads nothing
  });

  it("every button's command is really understood", async () => {
    const { SUMMARY_MENU_ITEMS } = await import("./summary-menu");
    const { parseCommand } = await import("@/lib/commands");
    for (const item of SUMMARY_MENU_ITEMS) {
      expect(parseCommand(item.text), item.text).not.toBeNull();
      expect(item.label.length).toBeLessThanOrEqual(20);
    }
  });

  it.each([
    ["สรุปเมื่อวาน", "สรุปเมื่อวาน", "2026-10-15T17:00:00.000Z", "2026-10-16T17:00:00.000Z"],
    ["สรุปสัปดาห์นี้", "สรุปสัปดาห์นี้", "2026-10-11T17:00:00.000Z", "2026-10-17T17:00:00.000Z"],
    [
      "สรุปสัปดาห์ที่แล้ว",
      "สรุปสัปดาห์ที่แล้ว",
      "2026-10-04T17:00:00.000Z",
      "2026-10-11T17:00:00.000Z",
    ],
    [
      "สรุปเดือนที่แล้ว",
      "สรุปเดือนที่แล้ว",
      "2026-08-31T17:00:00.000Z",
      "2026-09-30T17:00:00.000Z",
    ],
  ])("Pro: %s is a card for exactly those days", async (input, title, from, to) => {
    plan = "plus";
    const { deps, reply } = setup();
    await handleEvent(say(input), deps);
    expect(JSON.stringify(sent(reply)[0])).toContain(title);
    expect(rangeCalls[0]).toMatchObject({ from, to });
  });

  it("Free is told these are for Pro and nothing is loaded", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("สรุปสัปดาห์นี้"), deps);
    expect(sent(reply)[0]?.text).toContain("Starter ขึ้นไป");
    expect(rangeCalls).toHaveLength(0);
  });

  it("สรุปช่วง opens the calendar for Pro, and turns Free away", async () => {
    const free = setup();
    await handleEvent(say("สรุปช่วง"), free.deps);
    expect(sent(free.reply)[0]?.text).toContain("Starter ขึ้นไป");
    plan = "plus";
    const pro = setup();
    await handleEvent(say("สรุปช่วง"), pro.deps);
    const item = (sent(pro.reply)[0] as unknown as Quick).quickReply?.items[0]?.action;
    expect(item?.type).toBe("datetimepicker");
  });

  it.each(["สรุป 1oct-15oct", "สรุป 1-15 ต.ค.", "สรุป 1.10-15.10", "สรุป 1 ตุลาคม ถึง 15 ตุลาคม"])(
    "Pro: %s gives the same days as 1/10 ถึง 15/10",
    async (input) => {
      plan = "plus";
      const { deps } = setup();
      await handleEvent(say(input), deps);
      expect(rangeCalls[0]).toMatchObject({
        from: "2026-09-30T17:00:00.000Z",
        to: "2026-10-15T17:00:00.000Z",
      });
    },
  );
});
