import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteDto } from "./note";

let notes: NoteDto[] = [];
const noteQueries: (string | undefined)[] = [];
let failMonth = false;
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
