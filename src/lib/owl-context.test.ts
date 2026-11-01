import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillDto } from "./bill";
import type { DebtDto } from "./debt";
import type { GoalDto } from "./goal";
import type { NoteDto } from "./note";
import type { RuleRow } from "./recurring-repo";

let notes: NoteDto[] = [];
const noteQueries: (string | undefined)[] = [];
let failMonth = false;
let failDebts = false;
let debts: DebtDto[] = [];
let goals: GoalDto[] = [];
let bills: BillDto[] = [];
let rules: RuleRow[] = [];
const NOW = new Date("2026-10-30T05:00:00Z");

vi.mock("@/lib/note-repo", () => ({
  listNotes: async (_db: unknown, _u: string, o: { q?: string; limit?: number }) => {
    noteQueries.push(o.q);
    const items = o.q ? notes.filter((n) => n.body.includes(o.q ?? "")) : notes;
    return { items: items.slice(0, o.limit ?? 30), hasMore: false };
  },
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  listReminders: async () => [
    { id: "r1", body: "จ่ายค่าไฟ", remindAt: "2026-10-31T02:00:00Z", repeat: null },
  ],
}));
vi.mock("@/lib/summary-load", () => ({
  loadCategorySpend: async () => [
    { name: "อาหาร", amountSatang: 300_000, icon: null },
    { name: "เดินทาง", amountSatang: 100_000, icon: null },
  ],
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  periodSummary: async (_db: unknown, q: { from: Date }) => {
    if (failMonth) throw new Error("db down");
    // this year, then a month: told apart by the start of the range
    return q.from.getUTCMonth() === 11
      ? { incomeSatang: 90_000_00, expenseSatang: 50_000_00, count: 400 }
      : { incomeSatang: 3_000_000, expenseSatang: 400_000, count: 12 };
  },
  getSettings: async () => ({ budget_cycle: "monthly", cycle_start_day: 1 }),
  getBudgetMode: async () => "overall",
  loadBudgets: async () => [{ id: "b1", category_id: null, amount: "5000.00" }],
  loadCategories: async () => [],
  expenseTotalSatang: async () => 400_000,
}));

vi.mock("@/lib/debt-repo", () => ({
  listDebts: async () => {
    if (failDebts) throw new Error("db down");
    return debts;
  },
}));
vi.mock("@/lib/goal-repo", () => ({ listGoals: async () => goals }));
vi.mock("@/lib/bill-repo", () => ({ listBills: async () => bills }));
vi.mock("@/lib/recurring-repo", () => ({ listRules: async () => rules }));

import { asksAboutNotes, loadOwlFacts, noteSearchWords, renderOwlContext } from "./owl-context";

const db = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [
                {
                  occurred_at: "2026-10-30T04:00:00Z",
                  type: "expense",
                  title: "กาแฟ",
                  amount: "45.00",
                  categories: { name: "อาหาร" },
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
} as unknown as SupabaseClient;

const note = (id: string, body: string): NoteDto => ({
  id,
  body,
  createdAt: "2026-10-20T05:00:00Z",
  updatedAt: "2026-10-20T05:00:00Z",
});

beforeEach(() => {
  notes = [note("n1", "รหัสไวไฟ 1234"), note("n2", "ซื้อนม")];
  noteQueries.length = 0;
  failMonth = false;
  failDebts = false;
  debts = [];
  goals = [];
  bills = [];
  rules = [];
});

describe("renderOwlContext", () => {
  it("lists the numbers, the budget, the latest entries and the reminders, one fact a line", async () => {
    const text = renderOwlContext(await loadOwlFacts(db, "u1", "เดือนนี้ใช้ไปเท่าไร", NOW));
    expect(text).toContain("วันนี้: 30 ต.ค. 2569 (เวลาไทย)");
    expect(text).toContain(
      "เดือนนี้ (ต.ค.): รายรับ ฿30,000 · รายจ่าย ฿4,000 · คงเหลือ ฿26,000 · 12 รายการ",
    );
    expect(text).toContain("เดือนก่อน (ก.ย.)");
    // for analysis: last month's categories, the daily average (30 days so far: ฿4,000 / 30) and 6 months
    expect(text).toContain("หมวดรายจ่ายเดือนก่อน (มากไปน้อย): อาหาร ฿3,000 · เดินทาง ฿1,000");
    expect(text).toContain("รายจ่ายเฉลี่ยต่อวันเดือนนี้ (30 วันที่ผ่านมา): ฿133.33");
    expect(text).toContain("ย้อนหลัง 6 เดือน (รายรับ/รายจ่าย): พ. giữ".replace("พ. giữ", "พ.ค."));
    expect(text).toContain("ปีนี้ (2569)");
    expect(text).toContain("หมวดรายจ่ายเดือนนี้ (มากไปน้อย): อาหาร ฿3,000 · เดินทาง ฿1,000");
    expect(text).toContain("งบ (รอบรายเดือน วันที่ 1): งบรวม ใช้ไป ฿4,000 จาก ฿5,000 (80%)");
    expect(text).toContain("| รายจ่าย | กาแฟ | ฿45 | อาหาร");
    expect(text).toContain("31 ต.ค. 2569 09:00 | จ่ายค่าไฟ");
  });

  it("leaves a part out when it has nothing, and never prints an empty heading", () => {
    const text = renderOwlContext({
      now: NOW,
      month: null,
      previousMonth: null,
      year: null,
      topCategories: [],
      previousCategories: [],
      monthly: [],
      budgets: [],
      cycleLabel: null,
      recent: [],
      reminders: [],
      notes: [],
      debts: [],
      goals: [],
      bills: [],
      recurring: [],
    });
    expect(text).toBe("วันนี้: 30 ต.ค. 2569 (เวลาไทย)");
  });
});

describe("notes are shared only when the question points at them", () => {
  it("not at all for an ordinary money question", async () => {
    const facts = await loadOwlFacts(db, "u1", "เดือนนี้ใช้ไปเท่าไร", NOW);
    expect(facts.notes).toEqual([]);
  });

  it("the latest ones when the question says โน้ต", async () => {
    const facts = await loadOwlFacts(db, "u1", "ในโน้ตมีอะไรบ้าง", NOW);
    expect(facts.notes.map((n) => n.body)).toEqual(["ซื้อนม"]);
    expect(noteQueries).toEqual([undefined]);
  });

  it("only those that contain a word of the question otherwise", async () => {
    const facts = await loadOwlFacts(db, "u1", "รหัส ไวไฟ คืออะไร", NOW);
    expect(facts.notes).toEqual([]);
    expect(noteQueries).toEqual(["รหัส", "ไวไฟ", "คืออะไร"]);
  });

  it("helpers: words need a space (Thai has none), at most 3, and the trigger words", () => {
    expect(noteSearchWords("a b,c? ddd eeee")).toEqual(["ddd", "eeee"]);
    expect(noteSearchWords("รหัส ไวไฟ คืออะไร และ อื่น").length).toBe(3);
    expect(noteSearchWords("x")).toEqual([]);
    expect(asksAboutNotes("ดูโน้ตให้หน่อย")).toBe(true);
    expect(asksAboutNotes("ใช้ไปเท่าไร")).toBe(false);
  });
});

describe("a failing part does not fail the answer", () => {
  it("is left out and the rest is still there", async () => {
    failMonth = true;
    const facts = await loadOwlFacts(db, "u1", "x", NOW);
    expect(facts.month).toBeNull();
    expect(facts.topCategories).toHaveLength(2);
    expect(renderOwlContext(facts)).not.toContain("เดือนนี้ (ต.ค.)");
  });
});

const debt = (over: Partial<DebtDto>): DebtDto => ({
  id: "d",
  direction: "borrowed",
  person: "สมชาย",
  amountSatang: 1_000_000,
  paidSatang: 0,
  remainingSatang: 1_000_000,
  accountId: null,
  accountName: "เงินสด",
  occurredAt: "2026-09-01T05:00:00Z",
  dueAt: null,
  note: "รหัส 1234 ห้ามส่ง",
  ...over,
});
const goal = (over: Partial<GoalDto>): GoalDto => ({
  id: "g",
  name: "ทริปญี่ปุ่น",
  emoji: null,
  targetSatang: 6_000_000,
  savedSatang: 1_500_000,
  dueOn: "2027-04-30",
  archived: false,
  percent: 25,
  remainingSatang: 4_500_000,
  done: false,
  monthlyNeededSatang: 750_000,
  overdue: false,
  ...over,
});
const bill = (over: Partial<BillDto>): BillDto => ({
  id: "b",
  name: "ค่าเน็ต",
  amountSatang: 59_900,
  cadence: "monthly",
  dayOfMonth: 5,
  monthOfYear: null,
  nextDueOn: "2026-11-05",
  remindDays: [1],
  remindHour: 9,
  snoozedOn: null,
  note: null,
  isActive: true,
  ...over,
});
const rule = (over: Partial<RuleRow>): RuleRow => ({
  id: "r",
  type: "income",
  amount: "25000.00",
  title: "เงินเดือน",
  category_id: null,
  cadence: "monthly",
  day_of_period: 25,
  next_run_at: "2026-11-24T17:00:00Z",
  is_active: true,
  ...over,
});
const context = async () =>
  renderOwlContext(await loadOwlFacts(db, "u1", "ผ่อนก้อนไหนก่อนดี", NOW));

describe("what a money plan needs", () => {
  it("adds up the debts on both sides, and leaves out their notes", async () => {
    debts = [
      debt({ remainingSatang: 1_000_000 }),
      debt({ person: "แม่", remainingSatang: 500_000, dueAt: "2026-12-01T05:00:00Z" }),
      debt({ direction: "lent", person: "น้อย", remainingSatang: 200_000 }),
      debt({ person: "จ่ายหมดแล้ว", remainingSatang: 0 }),
    ];
    const out = await context();
    expect(out).toContain("หนี้ที่ยืมมาคงเหลือรวม ฿15,000");
    expect(out).toContain("เงินที่ให้ยืมคงเหลือรวม ฿2,000");
    expect(out).toContain("แม่");
    expect(out).not.toContain("จ่ายหมดแล้ว");
    expect(out).not.toContain("1234");
  });

  it("totals every debt even when only some are listed", async () => {
    debts = Array.from({ length: 12 }, (_, i) => debt({ person: `คน${i}` }));
    const out = await context();
    expect(out).toContain("หนี้ที่ยืมมาคงเหลือรวม ฿120,000");
    expect(out).not.toContain("คน11");
  });

  it("shows open goals with what each month needs", async () => {
    goals = [
      goal({}),
      goal({ name: "เก็บครบแล้ว", done: true }),
      goal({ name: "เลิกแล้ว", archived: true }),
    ];
    const out = await context();
    expect(out).toContain("ทริปญี่ปุ่น");
    expect(out).toContain("฿15,000 จาก ฿60,000");
    expect(out).toContain("ต้องเก็บเดือนละ ฿7,500");
    expect(out).not.toContain("เก็บครบแล้ว");
    expect(out).not.toContain("เลิกแล้ว");
  });

  it("shows bills, with no amount when none was set", async () => {
    bills = [bill({}), bill({ name: "ค่าไฟ", amountSatang: null, nextDueOn: "2026-11-09" })];
    const out = await context();
    expect(out).toContain("ค่าเน็ต ฿599");
    expect(out).toContain("ค่าไฟ ยังไม่ระบุยอด");
  });

  it("shows live recurring entries only", async () => {
    rules = [
      rule({}),
      rule({ title: "ฟิตเนส", type: "expense", amount: "990.00", cadence: "weekly" }),
      rule({ title: "ยกเลิกแล้ว", is_active: false }),
    ];
    const out = await context();
    expect(out).toContain("รายรับ เงินเดือน ฿25,000 รายเดือน");
    expect(out).toContain("รายจ่าย ฟิตเนส ฿990 รายสัปดาห์");
    expect(out).not.toContain("ยกเลิกแล้ว");
  });

  it("says when not everything is listed, and how often a bill comes", async () => {
    bills = Array.from({ length: 10 }, (_, i) =>
      bill({ name: `บิล${i}`, cadence: i === 0 ? "yearly" : "monthly" }),
    );
    rules = Array.from({ length: 9 }, (_, i) => rule({ title: `ประจำ${i}` }));
    const out = await context();
    expect(out).toContain("บิลที่ต้องจ่าย (แสดง 8 จาก 10):");
    expect(out).toContain("บิล0 ฿599 รายปี");
    expect(out).toContain("รายการประจำ (แสดง 8 จาก 9):");
  });

  it("leaves out what looks like a password, wherever it was typed", async () => {
    debts = [debt({ person: "รหัสแม่ 1234" })];
    goals = [goal({ name: "password ทริป" })];
    bills = [bill({ name: "otp ค่าเน็ต" })];
    rules = [rule({ title: "รหัสบัตร" })];
    const out = await context();
    expect(out).not.toContain("รหัส");
    expect(out).not.toContain("password");
    expect(out).not.toContain("otp");
  });

  it("a failing part leaves the rest of the plan", async () => {
    failDebts = true;
    goals = [goal({})];
    const out = await context();
    expect(out).toContain("ทริปญี่ปุ่น");
    expect(out).not.toContain("หนี้ที่ยืมมา");
  });
});
