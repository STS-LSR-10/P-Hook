import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_PLUS_HINT_TEXT, NOT_FOUND_TEXT, SLIP_ASK_SKIPPED_TEXT } from "@/lib/line/messages";
import type { UserRow } from "@/lib/repo";
import { answerSlipAsk, isSkipWord, looksLikeSlipAnswer } from "./slip-ask";

let plan = "plus";
let tx: { id: string; title: string; type: string; status: string; slip_id: string | null } | null;
const updates: Record<string, unknown>[] = [];
const learned: unknown[] = [];
const cleared: number[] = [];

const cat = (id: string, name: string, keywords: string[] = []) => ({
  id,
  name,
  type: "expense",
  is_hidden: false,
  sort_order: 1,
  icon: null,
  keywords,
  user_id: null,
});
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  getTransaction: async () => tx,
  loadCategories: async () => [
    cat("c-food", "อาหาร", ["ข้าว"]),
    cat("c-trip", "เดินทาง"),
    cat("c-other", "อื่นๆ"),
  ],
  loadMemoryFor: async () => [],
  updateTransaction: async (
    _d: unknown,
    _u: string,
    _id: string,
    patch: Record<string, unknown>,
  ) => {
    updates.push(patch);
    return { id: "t1" };
  },
}));
vi.mock("@/lib/slip-repo", () => ({
  getSlip: async () => ({ payee: "นาย สมชาย ใจดี" }),
  learnMerchant: async (_d: unknown, input: unknown) => {
    learned.push(input);
  },
}));
vi.mock("@/lib/slip-ask-repo", () => ({
  clearSlipAsk: async () => {
    cleared.push(1);
  },
}));

const deps = { db: {} as SupabaseClient, now: () => new Date("2026-10-17T08:00:00Z") };
const user = () => ({ id: "u1", plan, plan_expires_at: null }) as unknown as UserRow;
const said = (out: unknown[] | null) =>
  (out ?? []).map((m) => (m as { text: string }).text).join("\n");

beforeEach(() => {
  plan = "plus";
  tx = { id: "t1", title: "นาย สมชาย ใจดี", type: "expense", status: "confirmed", slip_id: "s1" };
  updates.length = 0;
  learned.length = 0;
  cleared.length = 0;
});

describe("answering what a transfer was for", () => {
  it("a tap files the entry in that category, keeps its title, and remembers the recipient (Pro)", async () => {
    const out = await answerSlipAsk(deps, user(), "t1", { categoryId: "c-food" });
    expect(updates).toEqual([{ categoryId: "c-food" }]);
    expect(learned).toEqual([{ userId: "u1", payee: "นาย สมชาย ใจดี", categoryId: "c-food" }]);
    expect(said(out)).toContain("หมวด อาหาร");
    expect(cleared).toHaveLength(1);
  });

  it("Free is told about memory instead of getting it", async () => {
    plan = "free";
    const out = await answerSlipAsk(deps, user(), "t1", { categoryId: "c-trip" });
    expect(learned).toHaveLength(0);
    expect(said(out)).toContain(MEMORY_PLUS_HINT_TEXT);
  });

  it("typed words the rules know become the title and sort the entry", async () => {
    await answerSlipAsk(deps, user(), "t1", { typed: "ค่าข้าว" });
    expect(updates).toEqual([{ categoryId: "c-food", title: "ค่าข้าว" }]);
    expect(learned).toHaveLength(1);
  });

  it("typed words that start with a category name use it, the rest is the title", async () => {
    await answerSlipAsk(deps, user(), "t1", { typed: "เดินทาง วิน" });
    expect(updates).toEqual([{ categoryId: "c-trip", title: "วิน" }]);
  });

  it("typed words that say 'ค่า…' but name nothing known keep the catch-all and learn nothing", async () => {
    await answerSlipAsk(deps, user(), "t1", { typed: "ค่าแรงช่าง" });
    expect(updates).toEqual([{ categoryId: "c-other", title: "ค่าแรงช่าง" }]);
    expect(learned).toHaveLength(0);
  });

  it("ordinary chat is not an answer: nothing changes and the question stays open", async () => {
    for (const chat of ["โอเค", "ทำไมเดือนนี้ใช้เยอะ", "ให้ยืม"]) {
      expect(await answerSlipAsk(deps, user(), "t1", { typed: chat })).toBeNull();
    }
    expect(updates).toHaveLength(0);
    expect(cleared).toHaveLength(0);
  });

  it("typed words for an entry that is gone go on as ordinary chat", async () => {
    tx = null;
    expect(await answerSlipAsk(deps, user(), "t1", { typed: "ค่าข้าว" })).toBeNull();
    expect(cleared).toHaveLength(1);
  });

  it("skipping changes nothing and closes the question", async () => {
    const out = await answerSlipAsk(deps, user(), "t1", { skip: true });
    expect(updates).toHaveLength(0);
    expect(said(out)).toBe(SLIP_ASK_SKIPPED_TEXT);
    expect(cleared).toHaveLength(1);
  });

  it("an entry that is gone, or a category that is not theirs, is not found", async () => {
    expect(said(await answerSlipAsk(deps, user(), "t1", { categoryId: "nope" }))).toBe(
      NOT_FOUND_TEXT,
    );
    tx = null;
    expect(said(await answerSlipAsk(deps, user(), "t1", { categoryId: "c-food" }))).toBe(
      NOT_FOUND_TEXT,
    );
  });
});

describe("what counts as a typed answer", () => {
  it.each(["ค่าข้าว", "ให้ยืมเพื่อน", "เดินทาง วิน"])("%s is an answer", (s) =>
    expect(looksLikeSlipAnswer(s)).toBe(true),
  );
  it.each(["กาแฟ 50", "โอน 500 ไปแม่", "https://x.co", "", "ก".repeat(41)])("%s is not", (s) =>
    expect(looksLikeSlipAnswer(s)).toBe(false),
  );
  it("knows the words for leaving it", () => {
    expect(["ข้าม", "ไม่รู้", " ช่างมัน "].every(isSkipWord)).toBe(true);
    expect(isSkipWord("ค่าข้าว")).toBe(false);
  });
});
