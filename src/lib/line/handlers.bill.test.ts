import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillDto } from "@/lib/bill";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "ultimate";
let bills: BillDto[] = [];
let createResult = "new-id";
let claimOk = true;
const created: Record<string, unknown>[] = [];
const patched: Record<string, unknown>[] = [];
const settled: string[] = [];
const recorded: { name: string; amountSatang: number }[] = [];
const NOW = new Date("2026-10-18T02:30:00Z"); // 18 Oct 2026, 09:30 Bangkok

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
  categoryTotalSatang: async () => 0,
}));
vi.mock("@/lib/wallet-repo", () => ({
  listWallets: async () => [],
  ensureWallets: async () => [],
}));
vi.mock("@/lib/bill-repo", () => ({
  listBills: async () => bills.filter((b) => b.isActive),
  getBill: async (_db: unknown, _u: string, id: string) => bills.find((b) => b.id === id) ?? null,
  createBill: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return createResult;
  },
  updateBill: async (_db: unknown, _u: string, id: string, patch: Record<string, unknown>) => {
    patched.push({ id, ...patch });
    return "ok";
  },
  claimReminder: async () => claimOk,
}));
vi.mock("@/lib/bill-actions", () => ({
  settleBill: async (_db: unknown, _u: string, bill: BillDto) => {
    settled.push(bill.id);
    return { nextDueOn: bill.cadence === "once" ? null : "2026-12-15" };
  },
  recordBillExpense: async (_db: unknown, _u: unknown, bill: BillDto, amountSatang: number) => {
    recorded.push({ name: bill.name, amountSatang });
    return {
      tx: {
        id: "t1",
        type: "expense",
        title: bill.name,
        amount: String(amountSatang / 100),
        occurred_at: NOW.toISOString(),
        category_id: null,
        status: "confirmed",
        slip_id: null,
      },
      categoryId: null,
    };
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

const bill = (over: Partial<BillDto> = {}): BillDto => ({
  id: "b1",
  name: "ค่าไฟ",
  amountSatang: 125_000,
  cadence: "monthly",
  dayOfMonth: 19,
  monthOfYear: null,
  nextDueOn: "2026-10-19",
  remindDays: [1],
  remindHour: 9,
  snoozedOn: null,
  note: null,
  isActive: true,
  ...over,
});

beforeEach(() => {
  plan = "ultimate";
  bills = [bill()];
  createResult = "new-id";
  claimOk = true;
  created.length = 0;
  patched.length = 0;
  settled.length = 0;
  recorded.length = 0;
});

describe("บิล ใหม่", () => {
  it("creates a bill and says when it is next due and when it will remind", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("บิล ใหม่ ค่าน้ำ 300 ทุกวันที่ 25 เตือนก่อน 2 วัน เวลา 20:00"), deps);
    expect(created[0]).toMatchObject({
      name: "ค่าน้ำ",
      amountSatang: 30_000,
      cadence: "monthly",
      dayOfMonth: 25,
      remindDays: [2],
      remindHour: 20,
      nextDueOn: "2026-10-25",
    });
    const text = sent(reply);
    expect(text).toContain("ตั้งเตือนบิลแล้ว: ค่าน้ำ");
    expect(text).toContain("25/10/2569");
    expect(text).toContain("เวลา 20:00");
  });

  it("explains the format when it cannot be read", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("บิล ใหม่ ค่าน้ำ 300"), deps);
    expect(created).toHaveLength(0);
    expect(sent(reply)).toContain("บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15");
  });

  it("Starter is told it is a Pro feature; a used name is refused", async () => {
    plan = "starter";
    let { deps, reply } = setup();
    await handleEvent(say("บิล ใหม่ ค่าน้ำ 300 ทุกวันที่ 25"), deps);
    expect(created).toHaveLength(0);
    expect(sent(reply)).toContain("Pro");

    plan = "ultimate";
    createResult = "duplicate";
    ({ deps, reply } = setup());
    await handleEvent(say("บิล ใหม่ ค่าไฟ 300 ทุกวันที่ 25"), deps);
    expect(sent(reply)).toContain("มีบิลชื่อนี้อยู่แล้ว");
  });
});

describe("บิล", () => {
  it("lists the bills with due dates", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("บิล"), deps);
    const text = sent(reply);
    expect(text).toContain("ค่าไฟ");
    expect(text).toContain("฿1,250");
  });

  it("says how to start when there are none, and that it is Pro and above for others", async () => {
    bills = [];
    let { deps, reply } = setup();
    await handleEvent(say("บิล"), deps);
    expect(sent(reply)).toContain("ยังไม่มีบิลที่ตั้งเตือนไว้");

    plan = "free";
    ({ deps, reply } = setup());
    await handleEvent(say("บิล"), deps);
    expect(sent(reply)).toContain("Pro");
  });
});

describe("จ่ายบิล", () => {
  it("moves the bill on and offers to record the expense", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("จ่ายบิล ค่าไฟ"), deps);
    expect(settled).toEqual(["b1"]);
    const text = sent(reply);
    expect(text).toContain("จ่ายค่าไฟแล้ว");
    expect(text).toContain("15/12/2569");
    expect(text).toContain("a=be&id=b1&d=2026-10-19");
    expect(recorded).toHaveLength(0); // it asks, it does not record by itself
  });

  it("a bill with no amount has nothing to record, so no such button", async () => {
    bills = [bill({ amountSatang: null })];
    const { deps, reply } = setup();
    await handleEvent(say("จ่ายบิล ค่าไฟ"), deps);
    expect(sent(reply)).not.toContain("a=be");
  });

  it("a one-off bill is closed after it", async () => {
    bills = [bill({ cadence: "once" })];
    const { deps, reply } = setup();
    await handleEvent(say("จ่ายบิล ค่าไฟ"), deps);
    expect(sent(reply)).toContain("ครั้งเดียว ปิดให้แล้ว");
  });

  it("a name that is none of their bills is an ordinary message", async () => {
    const { deps } = setup();
    await handleEvent(say("จ่ายบิล ค่าเน็ต"), deps);
    expect(settled).toHaveLength(0);
  });
});

describe("the buttons under a reminder", () => {
  it("✅ paid moves the bill on", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=bp&id=b1&d=2026-10-19"), deps);
    expect(settled).toEqual(["b1"]);
    expect(sent(reply)).toContain("จ่ายค่าไฟแล้ว");
  });

  it("skip moves it on without offering to record", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=bk&id=b1&d=2026-10-19"), deps);
    expect(settled).toEqual(["b1"]);
    expect(sent(reply)).toContain("ข้ามรอบนี้");
    expect(sent(reply)).not.toContain("a=be");
  });

  it("a stale button (the round was already settled) does nothing more", async () => {
    bills = [bill({ nextDueOn: "2026-11-19" })];
    const { deps, reply } = setup();
    await handleEvent(postback("a=bp&id=b1&d=2026-10-19"), deps);
    expect(settled).toHaveLength(0);
    expect(sent(reply)).toContain("ถูกจัดการไปแล้ว");
  });

  it("⏰ remind tomorrow sets the snooze day", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=bz&id=b1"), deps);
    expect(patched[0]).toMatchObject({ id: "b1", snoozedOn: "2026-10-19" });
    expect(sent(reply)).toContain("พรุ่งนี้จะเตือนอีกครั้ง");
  });

  it("📝 record the expense, once only", async () => {
    let { deps, reply } = setup();
    await handleEvent(postback("a=be&id=b1&d=2026-10-19"), deps);
    expect(recorded).toEqual([{ name: "ค่าไฟ", amountSatang: 125_000 }]);
    expect(sent(reply)).toContain("ค่าไฟ");

    claimOk = false;
    recorded.length = 0;
    ({ deps, reply } = setup());
    await handleEvent(postback("a=be&id=b1&d=2026-10-19"), deps);
    expect(recorded).toHaveLength(0);
    expect(sent(reply)).toContain("จดรายจ่ายของบิลรอบนี้ไปแล้ว");
  });

  it("a bill that is gone says so", async () => {
    bills = [];
    const { deps, reply } = setup();
    await handleEvent(postback("a=bp&id=b1&d=2026-10-19"), deps);
    expect(sent(reply)).toContain("ถูกจัดการไปแล้ว");
  });
});
