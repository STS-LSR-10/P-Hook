import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "@/lib/wallet";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

let wallets: Wallet[] = [];
let plan = "plus";
let fxAnswer: { rate: number; sourceDay: string; stale: boolean } | null = null;
const fxAsked: string[] = [];
let debtList: import("@/lib/debt").DebtDto[] = [];
const newDebts: Record<string, unknown>[] = [];
const payments: Record<string, unknown>[] = [];
const removedDebts: string[] = [];
const removedPayments: string[] = [];
const transfers: Record<string, unknown>[] = [];
const cancelled: string[] = [];
const inserted: Record<string, unknown>[] = [];
const moved: { txId: string; walletId: string | null }[] = [];

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

vi.mock("@/lib/card-repo", async () => {
  const { cardStatus } = await import("@/lib/card");
  return {
    loadCardStatuses: async (_db: unknown, _u: string, list: Wallet[], now: Date) =>
      new Map(
        list
          .filter((w) => w.kind === "card" && (w.creditLimitSatang !== null || w.statementDay))
          .map((w) => [w.id, cardStatus(w, { cycle: 12_000, previous: 8_000 }, now)]),
      ),
  };
});
vi.mock("@/lib/debt-repo", async () => {
  const { openDebtsOf } =
    await vi.importActual<typeof import("@/lib/debt-repo")>("@/lib/debt-repo");
  return {
    openDebtsOf,
    listDebts: async () => debtList,
    createDebt: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
      newDebts.push(input);
      return "d-new";
    },
    addPayments: async (
      _db: unknown,
      _u: string,
      parts: unknown[],
      input: Record<string, unknown>,
    ) => {
      payments.push({ parts, ...input });
      return ["p1", "p2"].slice(0, parts.length);
    },
    deleteDebt: async (_db: unknown, _u: string, id: string) => {
      removedDebts.push(id);
      return id === "d-new";
    },
    deletePayments: async (_db: unknown, _u: string, ids: string[]) => {
      removedPayments.push(...ids);
      return ids.length;
    },
  };
});
vi.mock("@/lib/fx-repo", () => ({
  // the price in the person's currency (the baht here)
  getHomeRate: async (_db: unknown, currency: string, day: string) => {
    fxAsked.push(`${currency}:${day}`);
    return fxAnswer;
  },
}));
vi.mock("@/lib/transfer-repo", () => ({
  createTransfer: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    transfers.push(input);
    return "tr1";
  },
  deleteTransfer: async (_db: unknown, _u: string, id: string) => {
    cancelled.push(id);
    return id === "tr1";
  },
}));
vi.mock("@/lib/wallet-repo", () => ({
  listWallets: async () => wallets,
  ensureWallets: async () => wallets,
  setEntryWallet: async (_db: unknown, _u: string, txId: string, walletId: string | null) => {
    moved.push({ txId, walletId });
    return true;
  },
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
  getTransaction: async () => ({
    id: "t1",
    status: "confirmed",
    type: "expense",
    title: "กาแฟ",
    amount: "45.00",
    occurred_at: "2026-10-17T08:00:00Z",
    category_id: null,
    slip_id: null,
  }),
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => {
    inserted.push(input);
    return {
      id: "t1",
      status: input.status,
      type: input.type,
      title: input.title,
      amount: "45.00",
      occurred_at: "2026-10-17T08:00:00Z",
      category_id: null,
      slip_id: null,
    };
  },
  categoryTotalSatang: async () => 0,
}));

const text = (t: string): LineEvent => ({
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
    now: () => new Date("2026-10-17T08:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) => JSON.stringify(reply.mock.calls[0]?.[1]);

beforeEach(() => {
  wallets = [
    wallet({}),
    wallet({ id: "w-ktc", name: "KTC", kind: "card", isDefault: false }),
    wallet({ id: "w-kbank", name: "กสิกร", kind: "bank", isDefault: false }),
  ];
  inserted.length = 0;
  moved.length = 0;
  transfers.length = 0;
  cancelled.length = 0;
  fxAnswer = { rate: 0.2335, sourceDay: "2026-10-16", stale: false };
  fxAsked.length = 0;
  debtList = [];
  newDebts.length = 0;
  payments.length = 0;
  removedDebts.length = 0;
  removedPayments.length = 0;
  plan = "plus";
});

describe("recording with @wallet", () => {
  it("saves into the named wallet and names it on the card", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("กาแฟ 45 @ktc"), deps);
    expect(inserted[0]).toMatchObject({ title: "กาแฟ", accountId: "w-ktc" });
    expect(sent(reply)).toContain("💳 KTC");
  });

  it("without @ nothing is pinned (the main wallet) and the card offers to move it", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("กาแฟ 45"), deps);
    expect(inserted[0]?.accountId).toBeNull();
    expect(sent(reply)).toContain("a=wl&id=t1");
  });

  it("an unknown wallet records nothing and lists the wallets", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("กาแฟ 45 @xyz"), deps);
    expect(inserted).toHaveLength(0);
    expect(sent(reply)).toContain("ไม่พบกระเป๋า");
    expect(sent(reply)).toContain("KTC");
  });

  it("a word that fits several wallets records nothing", async () => {
    wallets = [
      ...wallets,
      wallet({ id: "w-kbank2", name: "กสิกร2", kind: "bank", isDefault: false }),
    ];
    const { deps, reply } = setup();
    await handleEvent(text("กาแฟ 45 @กสิ"), deps);
    expect(inserted).toHaveLength(0);
    expect(sent(reply)).toContain("ตรงกับหลายกระเป๋า");
  });

  it("with a single wallet there is no wallet line and no move button", async () => {
    wallets = [wallet({})];
    const { deps, reply } = setup();
    await handleEvent(text("กาแฟ 45"), deps);
    expect(sent(reply)).not.toContain("a=wl");
    expect(sent(reply)).not.toContain("เงินสด");
  });
});

describe("moving an entry", () => {
  it("a=wl lists the wallets to move to", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=wl&id=t1"), deps);
    expect(sent(reply)).toContain("a=wm&id=t1&w=w-ktc");
  });

  it("a=wm moves it; the main wallet means no wallet id", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=wm&id=t1&w=w-ktc"), deps);
    await handleEvent(postback("a=wm&id=t1&w=w-cash"), deps);
    expect(moved).toEqual([
      { txId: "t1", walletId: "w-ktc" },
      { txId: "t1", walletId: null },
    ]);
    expect(JSON.stringify(reply.mock.calls[0]?.[1])).toContain("KTC");
  });

  it("a wallet that is not theirs is refused", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=wm&id=t1&w=someone-elses"), deps);
    expect(moved).toHaveLength(0);
    expect(sent(reply)).toContain("ไม่พบ");
  });
});

describe("the กระเป๋า command", () => {
  it("shows every wallet in a card", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("กระเป๋า"), deps);
    const json = sent(reply);
    expect(json).toContain("กระเป๋าเงิน");
    expect(json).toContain("💳 KTC");
  });
});

describe("transfers between wallets", () => {
  it("moves money, says both balances and that it is not income or expense", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("โอน 500 เงินสด>ktc"), deps);
    expect(transfers[0]).toMatchObject({ fromId: "w-cash", toId: "w-ktc", amountSatang: 50000 });
    expect(inserted).toHaveLength(0);
    const json = sent(reply);
    expect(json).toContain("โอนแล้ว ฿500");
    expect(json).toContain("ไม่นับเป็นรายรับ/รายจ่าย");
    expect(json).toContain("a=tc&id=tr1");
  });

  it("Free is told it needs Pro and nothing is moved", async () => {
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(text("โอน 500 เงินสด>ktc"), deps);
    expect(transfers).toHaveLength(0);
    expect(sent(reply)).toContain("Pro");
  });

  it("the same wallet on both sides is refused", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("โอน 500 เงินสด>เงินสด"), deps);
    expect(transfers).toHaveLength(0);
    expect(sent(reply)).toContain("เดียวกัน");
  });

  it("one unknown wallet name moves nothing and lists the wallets", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("โอน 500 เงินสด>xyz"), deps);
    expect(transfers).toHaveLength(0);
    expect(sent(reply)).toContain("ไม่พบกระเป๋า");
  });

  it("names no wallet at all: it is an ordinary entry, not a transfer", async () => {
    const { deps } = setup();
    await handleEvent(text("โอนให้แม่ 500 ค่าขนม > ต่างจังหวัด"), deps);
    expect(transfers).toHaveLength(0);
  });

  it("the undo button removes the transfer", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=tc&id=tr1"), deps);
    expect(cancelled).toEqual(["tr1"]);
    expect(sent(reply)).toContain("ยกเลิกการโอนแล้ว");
  });

  it("an unknown transfer id says not found", async () => {
    const { deps, reply } = setup();
    await handleEvent(postback("a=tc&id=nope"), deps);
    expect(sent(reply)).toContain("ไม่พบ");
  });
});

describe("the บัตร command", () => {
  const withCard = () => {
    wallets = [
      wallet({}),
      wallet({
        id: "w-card",
        name: "KTC",
        kind: "card",
        isDefault: false,
        expenseSatang: 4_500_000,
        creditLimitSatang: 5_000_000,
        statementDay: 25,
        dueDay: 10,
      }),
    ];
  };

  it("shows each card with what is owed and the limit left", async () => {
    withCard();
    const { deps, reply } = setup();
    await handleEvent(text("บัตร"), deps);
    const json = sent(reply);
    expect(json).toContain("💳 KTC");
    expect(json).toContain("วงเงินคงเหลือ");
    expect(json).toContain("ยอดใช้รอบนี้");
  });

  it("a name picks that card", async () => {
    withCard();
    const { deps, reply } = setup();
    await handleEvent(text("บัตร ktc"), deps);
    expect(sent(reply)).toContain("💳 KTC");
  });

  it("Free is told it needs Pro", async () => {
    withCard();
    plan = "free";
    const { deps, reply } = setup();
    await handleEvent(text("บัตร"), deps);
    expect(sent(reply)).toContain("Pro");
  });

  it("without a card it explains how to add one", async () => {
    wallets = [wallet({})];
    const { deps, reply } = setup();
    await handleEvent(text("บัตร"), deps);
    expect(sent(reply)).toContain("ยังไม่มีกระเป๋าบัตรเครดิต");
  });

  it("a card with no limit or day has nothing to show beyond the balance", async () => {
    wallets = [wallet({}), wallet({ id: "w-card", name: "KTC", kind: "card", isDefault: false })];
    const { deps, reply } = setup();
    await handleEvent(text("บัตร"), deps);
    expect(sent(reply)).toContain("ยังไม่ได้ตั้งวงเงิน");
  });

  it("a name that is not one of their cards falls through to an ordinary message", async () => {
    withCard();
    const { deps, reply } = setup();
    await handleEvent(text("บัตร จอดรถ"), deps);
    expect(sent(reply)).not.toContain("วงเงินคงเหลือ");
  });
});

describe("card limit alerts after recording", () => {
  const cardAt = (expenseSatang: number) => {
    wallets = [
      wallet({}),
      wallet({
        id: "w-card",
        name: "KTC",
        kind: "card",
        isDefault: false,
        expenseSatang,
        creditLimitSatang: 1_000_000,
      }),
    ];
  };
  const allSent = (reply: ReturnType<typeof setup>["reply"]) =>
    JSON.stringify(reply.mock.calls.map((c) => c[1]));

  it("warns at 80% of the limit when an expense on the card crosses it", async () => {
    cardAt(850_000); // the balance already includes the entry being recorded (฿1,000)
    const { deps, reply } = setup();
    await handleEvent(text("ช้อปปิ้ง 1000 @ktc"), deps);
    expect(allSent(reply)).toContain("ใช้วงเงินไปแล้ว 80%");
  });

  it("says the card is full when it crosses 100%", async () => {
    cardAt(1_050_000);
    const { deps, reply } = setup();
    await handleEvent(text("ช้อปปิ้ง 3000 @ktc"), deps);
    expect(allSent(reply)).toContain("เต็มวงเงินแล้ว");
  });

  it("is quiet for a small expense, for income, and for a Free plan", async () => {
    cardAt(300_000);
    let { deps, reply } = setup();
    await handleEvent(text("กาแฟ 45 @ktc"), deps);
    expect(allSent(reply)).not.toContain("วงเงิน");

    cardAt(850_000);
    ({ deps, reply } = setup());
    await handleEvent(text("+1000 คืนเงิน @ktc"), deps);
    expect(allSent(reply)).not.toContain("วงเงิน");

    plan = "free";
    ({ deps, reply } = setup());
    await handleEvent(text("ช้อปปิ้ง 1000 @ktc"), deps);
    expect(allSent(reply)).not.toContain("วงเงิน");
  });
});

describe("debts by chat (Elite)", () => {
  const owed = (over: Partial<import("@/lib/debt").DebtDto>): import("@/lib/debt").DebtDto => ({
    id: "d1",
    direction: "lent",
    person: "สมชาย",
    amountSatang: 50000,
    paidSatang: 0,
    remainingSatang: 50000,
    accountId: "w-cash",
    accountName: "เงินสด",
    occurredAt: "2026-10-01T05:00:00Z",
    dueAt: null,
    note: null,
    ...over,
  });

  beforeEach(() => {
    plan = "ultimate";
  });

  it("lending is saved against the chosen wallet and says what is left in it", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("ให้ยืม สมชาย 500 @ktc"), deps);
    expect(newDebts[0]).toMatchObject({
      direction: "lent",
      person: "สมชาย",
      amountSatang: 50000,
      accountId: "w-ktc",
    });
    expect(inserted).toHaveLength(0); // not an expense
    const json = sent(reply);
    expect(json).toContain("ให้ สมชาย ยืม ฿500");
    expect(json).toContain("KTC คงเหลือ");
    expect(json).toContain("a=dx&id=d-new");
  });

  it("no @ means the main wallet; a due date is kept", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("ยืม แม่ 2000 คืน 25/10"), deps);
    expect(newDebts[0]).toMatchObject({ direction: "borrowed", accountId: "w-cash" });
    expect(newDebts[0]?.dueAt).toBeInstanceOf(Date);
    expect(sent(reply)).toContain("กำหนดคืน");
  });

  it("not Elite: told it is an Elite feature, nothing saved", async () => {
    plan = "plus";
    const { deps, reply } = setup();
    await handleEvent(text("ให้ยืม สมชาย 500"), deps);
    expect(newDebts).toHaveLength(0);
    expect(sent(reply)).toContain("Elite");
  });

  it("an unknown wallet saves nothing", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("ให้ยืม สมชาย 500 @xyz"), deps);
    expect(newDebts).toHaveLength(0);
    expect(sent(reply)).toContain("ไม่พบกระเป๋า");
  });

  it("a repayment goes against the person's open debt and closes it when paid in full", async () => {
    debtList = [owed({})];
    const { deps, reply } = setup();
    await handleEvent(text("สมชายคืน 500"), deps);
    expect(payments[0]).toMatchObject({
      accountId: "w-cash",
      parts: [{ debtId: "d1", amountSatang: 50000 }],
    });
    const json = sent(reply);
    expect(json).toContain("รับคืนจาก สมชาย ฿500");
    expect(json).toContain("ปิดหนี้ครบแล้ว");
    expect(json).toContain("a=dpx&id=p1");
  });

  it("a part payment says what is still owed", async () => {
    debtList = [owed({})];
    const { deps, reply } = setup();
    await handleEvent(text("สมชายคืน 200"), deps);
    expect(sent(reply)).toContain("ยังเหลือ ฿300");
  });

  it("paying back more than is owed is refused", async () => {
    debtList = [owed({})];
    const { deps, reply } = setup();
    await handleEvent(text("สมชายคืน 900"), deps);
    expect(payments).toHaveLength(0);
    expect(sent(reply)).toContain("ชำระเกิน");
  });

  it("I pay back what I borrowed, out of the wallet I name", async () => {
    debtList = [owed({ direction: "borrowed", person: "แม่", id: "d2" })];
    const { deps, reply } = setup();
    await handleEvent(text("คืนแม่ 100 @ktc"), deps);
    expect(payments[0]).toMatchObject({ accountId: "w-ktc" });
    expect(sent(reply)).toContain("คืนเงิน แม่ ฿100");
  });

  it("a repayment for someone with no debt is just an ordinary message", async () => {
    const { deps } = setup();
    await handleEvent(text("คนแปลกหน้าคืน 100"), deps);
    expect(payments).toHaveLength(0);
  });

  it("the หนี้ command lists who owes whom", async () => {
    debtList = [
      owed({}),
      owed({ id: "d2", direction: "borrowed", person: "แม่", remainingSatang: 100000 }),
    ];
    const { deps, reply } = setup();
    await handleEvent(text("หนี้"), deps);
    const json = sent(reply);
    expect(json).toContain("คนที่ติดเรา");
    expect(json).toContain("เราติดใคร");
  });

  it("the หนี้ command is for Elite, and says so when there is nothing", async () => {
    plan = "plus";
    let { deps, reply } = setup();
    await handleEvent(text("หนี้"), deps);
    expect(sent(reply)).toContain("Elite");

    plan = "ultimate";
    ({ deps, reply } = setup());
    await handleEvent(text("หนี้"), deps);
    expect(sent(reply)).toContain("ยังไม่มีหนี้ค้าง");
  });

  it("the undo buttons remove the debt / the payments", async () => {
    let { deps, reply } = setup();
    await handleEvent(postback("a=dx&id=d-new"), deps);
    expect(removedDebts).toEqual(["d-new"]);
    expect(sent(reply)).toContain("ยกเลิกแล้ว");

    ({ deps, reply } = setup());
    await handleEvent(postback("a=dpx&id=p1,p2"), deps);
    expect(removedPayments).toEqual(["p1", "p2"]);
    expect(sent(reply)).toContain("ยกเลิกแล้ว");
  });
});

describe("foreign currency by chat (Elite)", () => {
  beforeEach(() => {
    plan = "ultimate";
  });

  it("converts to baht at the rate and keeps the original on the entry", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("ราเมน 1500 JPY"), deps);
    expect(inserted[0]).toMatchObject({
      title: "ราเมน",
      amountSatang: 35025,
      foreign: { currency: "JPY", minor: 150000, rate: 0.2335 },
    });
    expect(sent(reply)).toContain("1,500 JPY @ 0.2335");
  });

  it("asks for the rate of the entry's own day", async () => {
    const { deps } = setup();
    await handleEvent(text("เมื่อวาน ราเมน 1500 JPY"), deps);
    expect(fxAsked).toEqual(["JPY:2026-10-16"]);
  });

  it("two entries in the same currency and day ask once", async () => {
    const { deps } = setup();
    await handleEvent(text("ราเมน 1500 JPY, ชา 300 เยน"), deps);
    expect(fxAsked).toEqual(["JPY:2026-10-17"]);
    expect(inserted).toHaveLength(2);
  });

  it("goes into the chosen wallet like any entry", async () => {
    const { deps } = setup();
    await handleEvent(text("ราเมน 1500 JPY @ktc"), deps);
    expect(inserted[0]).toMatchObject({ accountId: "w-ktc" });
  });

  it("says when an older rate had to be used", async () => {
    fxAnswer = { rate: 0.23, sourceDay: "2026-10-14", stale: true };
    const { deps, reply } = setup();
    await handleEvent(text("ราเมน 1500 JPY"), deps);
    expect(sent(reply)).toContain("อัตราของวันที่ 14/10");
  });

  it("no rate at all: nothing is saved", async () => {
    fxAnswer = null;
    const { deps, reply } = setup();
    await handleEvent(text("ราเมน 1500 JPY"), deps);
    expect(inserted).toHaveLength(0);
    expect(sent(reply)).toContain("ดึงอัตราแลกเปลี่ยนไม่ได้");
  });

  it("VND and TWD are not supported and nothing is saved", async () => {
    const { deps, reply } = setup();
    await handleEvent(text("ข้าว 50000 VND"), deps);
    expect(inserted).toHaveLength(0);
    expect(fxAsked).toHaveLength(0);
    expect(sent(reply)).toContain("ยังไม่รองรับสกุล VND");
  });

  it("an amount that rounds to nothing is refused", async () => {
    fxAnswer = { rate: 0.00001, sourceDay: "2026-10-16", stale: false };
    const { deps, reply } = setup();
    await handleEvent(text("ลูกอม 1 KRW"), deps);
    expect(inserted).toHaveLength(0);
    expect(sent(reply)).toContain("น้อยกว่า 1 สตางค์");
  });

  it.each(["free", "plus"])("%s is told it is an Elite feature and nothing is saved", async (p) => {
    plan = p;
    const { deps, reply } = setup();
    await handleEvent(text("ราเมน 1500 JPY"), deps);
    expect(inserted).toHaveLength(0);
    expect(fxAsked).toHaveLength(0);
    expect(sent(reply)).toContain("Elite");
  });

  it("baht entries never touch the rate source", async () => {
    const { deps } = setup();
    await handleEvent(text("กาแฟ 45"), deps);
    expect(fxAsked).toHaveLength(0);
    expect(inserted[0]?.foreign).toBeNull();
  });
});
