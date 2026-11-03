import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/lib/wallet";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let plan = "plus";
let confirmStyle = "full";
let budgetSpent = 1_557_400; // satang this cycle, the new entry included
let todaySpent = 20_000;
let dailyBudget: string | null = null;
let wallets: Wallet[] = [];

const wallet = (over: Partial<Wallet>): Wallet => ({
  id: "w-cash",
  name: "เงินสด",
  kind: "cash",
  isDefault: true,
  openingSatang: 0,
  incomeSatang: 0,
  expenseSatang: 0,
  transferInSatang: 0,
  transferOutSatang: 0,
  debtInSatang: 0,
  debtOutSatang: 0,
  creditLimitSatang: null,
  statementDay: null,
  dueDay: null,
  entryCount: 0,
  ...over,
});

vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/wallet-repo", async (original) => ({
  ...(await original<typeof import("@/lib/wallet-repo")>()),
  listWallets: async () => wallets,
  ensureWallets: async () => wallets,
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
    confirm_style: confirmStyle,
    budget_cycle: "monthly",
    cycle_start_day: 1,
    daily_budget: dailyBudget,
    photo_prompt: false,
  }),
  getBudgetMode: async () => "overall",
  loadBudgets: async () => [{ category_id: null, amount: "15000.00" }],
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  // the cycle total and today's total are asked for with different ranges
  expenseTotalSatang: async (_db: unknown, q: { from: Date; to: Date }) =>
    q.to.getTime() - q.from.getTime() < 2 * 86_400_000 ? todaySpent : budgetSpent,
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => ({
    id: `t${Math.random()}`.replace(".", ""),
    status: input.status,
    type: input.type,
    title: input.title,
    amount: String((input.amountSatang as number) / 100),
    occurred_at: (input.occurredAt as Date).toISOString(),
    category_id: null,
    slip_id: null,
  }),
  categoryTotalSatang: async () => 0,
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
    now: () => new Date("2026-10-18T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? []) as { type: string; text?: string }[];
const cardOf = (reply: ReturnType<typeof setup>["reply"]) => JSON.stringify(sent(reply)[0]);
const restOf = (reply: ReturnType<typeof setup>["reply"]) => JSON.stringify(sent(reply).slice(1));

beforeEach(() => {
  plan = "plus";
  confirmStyle = "full";
  budgetSpent = 1_557_400;
  todaySpent = 20_000;
  dailyBudget = null;
  wallets = [wallet({})];
});

describe("budget on the entry card", () => {
  it("shows spent / budget and the over-budget warning on the card, and sends no warning message", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ช้อปปิ้ง 600"), deps); // was ฿14,974, now ฿15,574 of ฿15,000
    expect(sent(reply)[0]?.type).toBe("flex");
    expect(cardOf(reply)).toContain("฿15,574");
    expect(cardOf(reply)).toContain(" / ฿15,000");
    expect(cardOf(reply)).toContain("🚨");
    expect(cardOf(reply)).toContain("เกินงบ");
    expect(restOf(reply)).not.toContain("เกินงบ");
    expect(restOf(reply)).not.toContain("จาก ฿15,000");
  });

  it("under the budget: the figures show, with no warning", async () => {
    budgetSpent = 400_000;
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    expect(cardOf(reply)).toContain("฿4,000");
    expect(cardOf(reply)).toContain("เหลือ ฿11,000");
    expect(cardOf(reply)).not.toContain("🚨");
    expect(cardOf(reply)).not.toContain("⚠️");
  });

  it("Free sees the figures, and the card has no warning text", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(say("ช้อปปิ้ง 600"), deps);
    expect(cardOf(reply)).toContain(" / ฿15,000");
    expect(cardOf(reply)).not.toContain("🚨");
  });

  it("an income entry has no budget block", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("+300 ขายของ"), deps);
    expect(cardOf(reply)).not.toContain("งบรวม");
  });

  it("the short style has no card, so the warning is still a message", async () => {
    confirmStyle = "short";
    const { deps, reply } = setup();
    await handleEvent(say("ช้อปปิ้ง 600"), deps);
    expect(sent(reply)[0]?.type).toBe("text");
    expect(restOf(reply)).toContain("เกินงบ");
  });

  it("two entries against one budget: both cards show the figures, only the last warns", async () => {
    budgetSpent = 1_510_000; // ฿14,800 before the two entries, ฿15,100 after
    const { deps, reply } = setup();
    await handleEvent(say("ข้าว 150, ช้อปปิ้ง 150"), deps);
    const cards = sent(reply)
      .filter((m) => m.type === "flex")
      .map((m) => JSON.stringify(m));
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.includes(" / ฿15,000"))).toBe(true);
    expect(cards.filter((c) => c.includes("🚨"))).toHaveLength(1);
    expect(cards[1]).toContain("🚨");
  });
});

describe("the daily limit and the card limit on the card", () => {
  it("the daily scold rides on the card", async () => {
    dailyBudget = "500.00";
    todaySpent = 62_000;
    budgetSpent = 400_000;
    const { deps, reply } = setup();
    await handleEvent(say("ช้อปปิ้ง 300"), deps);
    expect(cardOf(reply)).toContain("⚠️");
    expect(cardOf(reply)).toContain("฿120");
    expect(restOf(reply)).not.toContain("฿120");
  });

  it("a credit card crossing 80% of its limit says so on the card", async () => {
    budgetSpent = 400_000;
    wallets = [
      wallet({
        id: "w-ktc",
        name: "KTC",
        kind: "card",
        creditLimitSatang: 1_000_000,
        expenseSatang: 810_000,
      }),
    ];
    const { deps, reply } = setup();
    await handleEvent(say("ช้อปปิ้ง 200"), deps); // owed was ฿7,900, now ฿8,100 of ฿10,000
    expect(cardOf(reply)).toContain("บัตร KTC");
    expect(cardOf(reply)).toContain("80%");
    expect(restOf(reply)).not.toContain("บัตร KTC");
  });
});

describe("choosing how it was paid", () => {
  it("with two wallets the card has a จ่ายด้วย row that moves the entry", async () => {
    budgetSpent = 400_000;
    wallets = [wallet({}), wallet({ id: "w-ktc", name: "KTC", kind: "card", isDefault: false })];
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    expect(cardOf(reply)).toContain("จ่ายด้วย");
    expect(cardOf(reply)).toMatch(/a=wm&id=[0-9a-z]+&w=w-ktc/);
    expect(cardOf(reply)).not.toContain("a=wl");
  });

  it("up to three wallets are all shown; with more, two and อื่น ๆ for the rest", async () => {
    budgetSpent = 400_000;
    const three = [
      wallet({}),
      wallet({ id: "w2", name: "KTC", kind: "card", isDefault: false }),
      wallet({ id: "w3", name: "ออมสิน", kind: "bank", isDefault: false }),
    ];
    wallets = three;
    const a = setup();
    await handleEvent(say("กาแฟ 50"), a.deps);
    expect(cardOf(a.reply)).toContain("&w=w3");
    expect(cardOf(a.reply)).not.toContain("a=wl");

    wallets = [
      ...three,
      wallet({ id: "w4", name: "ทรูมันนี่", kind: "ewallet", isDefault: false }),
    ];
    const b = setup();
    await handleEvent(say("กาแฟ 50"), b.deps);
    expect(cardOf(b.reply)).toContain("a=wl");
    expect(cardOf(b.reply)).toContain("อื่น ๆ");
    expect(cardOf(b.reply)).not.toContain("&w=w3");
    expect(cardOf(b.reply)).not.toContain("&w=w4");
  });

  it("Pro with only the cash wallet sees it chosen and a way to add a channel", async () => {
    budgetSpent = 400_000;
    process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    expect(cardOf(reply)).toContain("จ่ายด้วย");
    expect(cardOf(reply)).toContain("✓ 💵 เงินสด");
    expect(cardOf(reply)).toContain("＋ เพิ่มช่องทาง");
    expect(cardOf(reply)).toContain('"uri":"https://liff.line.me/1234-abcd/wallets"');
  });

  it("choosing how it was paid is for Pro and above: Free has no row, even with several wallets", async () => {
    budgetSpent = 400_000;
    plan = "free";
    wallets = [wallet({}), wallet({ id: "w-ktc", name: "KTC", kind: "card", isDefault: false })];
    const { deps, reply } = setup();
    await handleEvent(say("กาแฟ 50"), deps);
    expect(cardOf(reply)).not.toContain("จ่ายด้วย");
    expect(cardOf(reply)).not.toContain("a=wm");
  });
});
