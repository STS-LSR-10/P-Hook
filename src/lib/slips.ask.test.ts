import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "@/lib/repo";
import { handleSlipImage, type SlipDeps } from "./slips";

let memory: { match_text: string; category_id: string }[] = [];
const asks: unknown[][] = [];
const cleared: number[] = [];

vi.mock("@/lib/slip-ask-repo", () => ({
  startSlipAsk: async (...a: unknown[]) => {
    asks.push(a);
    return true;
  },
  clearSlipAsk: async () => {
    cleared.push(1);
  },
}));
vi.mock("@/lib/slip-repo", async (original) => ({
  ...(await original<typeof import("@/lib/slip-repo")>()),
  getUserPlanRow: async () => ({ plan: "plus", plan_expires_at: null }),
  countSlipsThisMonth: async () => 0,
  findSlipByHash: async () => null,
  findSlipByRef: async () => null,
  insertSlip: async () => ({ id: "s1" }),
}));
const cat = (id: string, name: string, order: number, keywords: string[] = []) => ({
  id,
  name,
  type: "expense",
  is_hidden: false,
  sort_order: order,
  icon: null,
  keywords,
  user_id: null,
});
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  loadCategories: async () => [
    cat("c-food", "อาหาร", 1, ["ข้าว"]),
    cat("c-trip", "เดินทาง", 2),
    cat("c-other", "อื่นๆ", 99),
  ],
  loadMemoryFor: async () => memory,
  insertTransaction: async (_d: unknown, input: Record<string, unknown>) => ({
    id: "t1",
    category_id: input.categoryId,
  }),
  updateTransaction: async () => ({ id: "t1" }),
}));

const TRANSFER = {
  is_slip: true,
  kind: "transfer",
  amount: 500,
  paid_at: "2026-10-16T10:00:00+07:00",
  payee_name: "นาย สมชาย ใจดี",
};
const extract = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => TRANSFER);
const db = {
  storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
} as unknown as SupabaseClient;
const deps = {
  db,
  now: () => new Date("2026-10-17T08:00:00Z"),
  fetchImage: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }),
  ocr: { name: "t", extract },
} as unknown as SlipDeps;
const user = { id: "u1" } as UserRow;

beforeEach(() => {
  memory = [];
  asks.length = 0;
  cleared.length = 0;
  extract.mockImplementation(async () => TRANSFER);
});

describe("asking what a transfer was for", () => {
  it("a transfer the rules cannot sort is asked about, last, with a button per category and one to skip", async () => {
    const out = await handleSlipImage(deps, user, "m1");
    const last = out[out.length - 1] as unknown as {
      text: string;
      quickReply: { items: unknown[] };
    };
    expect(last.text).toContain("สมชาย");
    expect(last.text).toContain("คือค่าอะไร");
    const buttons = JSON.stringify(last.quickReply.items);
    expect(buttons).toContain("a=sq&id=t1&c=c-food");
    expect(buttons).toContain("a=sq&id=t1&c=c-trip");
    expect(buttons).not.toContain("c=c-other"); // "อื่นๆ" is what it already is
    expect(buttons).toContain("a=sqx&id=t1");
    expect(asks).toHaveLength(1);
    expect(asks[0]?.[2]).toBe("t1");
  });

  it("a transfer the rules can sort (a note that says what it is) is not asked about", async () => {
    extract.mockImplementation(async () => ({ ...TRANSFER, memo: "ค่าข้าว" }));
    const out = await handleSlipImage(deps, user, "m1");
    expect(JSON.stringify(out)).not.toContain("คือค่าอะไร");
    expect(asks).toHaveLength(0);
  });

  it("a slip that is not asked about closes an older open question", async () => {
    extract.mockImplementation(async () => ({ ...TRANSFER, memo: "ค่าข้าว" }));
    await handleSlipImage(deps, user, "m1");
    expect(cleared).toHaveLength(1);
  });

  it("a recipient the bot has learned is not asked about", async () => {
    memory = [{ match_text: "สมชาย", category_id: "c-food" }];
    const out = await handleSlipImage(deps, user, "m1");
    expect(JSON.stringify(out)).not.toContain("คือค่าอะไร");
    expect(asks).toHaveLength(0);
  });

  it("a receipt is not asked about: it names its shop", async () => {
    extract.mockImplementation(async () => ({
      ...TRANSFER,
      kind: "receipt",
      payee_name: "ร้านอะไรสักอย่าง",
    }));
    const out = await handleSlipImage(deps, user, "m1");
    expect(JSON.stringify(out)).not.toContain("คือค่าอะไร");
    expect(asks).toHaveLength(0);
  });
});
