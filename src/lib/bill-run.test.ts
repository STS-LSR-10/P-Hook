import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillDto } from "./bill";
import type { Wallet } from "./wallet";

let users: {
  id: string;
  line_user_id: string;
  plan: string;
  plan_expires_at: string | null;
  timezone?: string;
}[] = [];
let bills: Record<string, BillDto[]> = {};
let sent: Record<string, Set<string>> = {};
let wallets: Wallet[] = [];
const claimed: string[] = [];
let pruned = 0;

vi.mock("@/lib/bill-repo", () => ({
  listBillsForUsers: async (_db: unknown, ids: string[]) =>
    new Map(ids.filter((i) => bills[i]).map((i) => [i, bills[i] as BillDto[]])),
  sentKeysForUsers: async () => new Map(Object.entries(sent)),
  claimReminder: async (_db: unknown, userId: string, key: string) => {
    const k = `${userId}|${key}`;
    if (claimed.includes(k)) return false;
    claimed.push(k);
    return true;
  },
  pruneReminders: async () => {
    pruned += 1;
  },
}));
vi.mock("@/lib/wallet-repo", () => ({ listWallets: async () => wallets }));

import { billReminderMessage, runBillReminders } from "./bill-run";

const db = {
  from: () => ({
    select: () => ({
      in: () => ({ limit: async () => ({ data: users, error: null }) }),
    }),
  }),
} as unknown as SupabaseClient;

// 2026-10-18 09:30 in Bangkok
const NOW = new Date("2026-10-18T02:30:00Z");
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
  users = [{ id: "u1", line_user_id: "U1", plan: "ultimate", plan_expires_at: null }];
  bills = { u1: [bill()] };
  sent = {};
  wallets = [];
  claimed.length = 0;
  pruned = 0;
});

describe("runBillReminders", () => {
  it("pushes the reminder that is due, with the buttons to answer it", async () => {
    const push = vi.fn(async () => undefined);
    const summary = await runBillReminders(db, push, NOW);
    expect(summary).toMatchObject({ users: 1, sent: 1, errors: 0 });
    expect(push).toHaveBeenCalledTimes(1);
    const [to, messages] = push.mock.calls[0] as unknown as [
      string,
      { text: string; quickReply: unknown }[],
    ];
    expect(to).toBe("U1");
    expect(messages[0]?.text).toContain("พรุ่งนี้ครบกำหนดจ่ายค่าไฟ");
    const data = JSON.stringify(messages[0]?.quickReply);
    expect(data).toContain("a=bp&id=b1&d=2026-10-19");
    expect(data).toContain("a=bz&id=b1");
    expect(data).toContain("a=bk&id=b1&d=2026-10-19");
  });

  it("reminds at the bill's hour in the person's own zone", async () => {
    // 09:30 in Bangkok is 03:30 in Paris: not yet 09:00 there
    users = [{ ...users[0]!, timezone: "Europe/Paris" }];
    const push = vi.fn(async () => undefined);
    expect(await runBillReminders(db, push, NOW)).toMatchObject({ sent: 0 });
    // 09:30 in Paris (CEST, UTC+2) on the same day
    expect(await runBillReminders(db, push, new Date("2026-10-18T07:30:00Z"))).toMatchObject({
      sent: 1,
    });
  });

  it("an hourly job running again does not send it twice", async () => {
    const push = vi.fn(async () => undefined);
    await runBillReminders(db, push, NOW);
    await runBillReminders(db, push, NOW);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("a reminder already sent is skipped", async () => {
    sent = { u1: new Set(["b1:2026-10-19:1"]) };
    const push = vi.fn(async () => undefined);
    expect((await runBillReminders(db, push, NOW)).sent).toBe(0);
  });

  it("only Elite: a lapsed plan gets nothing", async () => {
    users = [
      { id: "u1", line_user_id: "U1", plan: "ultimate", plan_expires_at: "2026-01-01T00:00:00Z" },
    ];
    const push = vi.fn(async () => undefined);
    expect(await runBillReminders(db, push, NOW)).toMatchObject({ users: 0, sent: 0 });
    expect(push).not.toHaveBeenCalled();
  });

  it("a failing push is counted, not retried, and does not stop the others", async () => {
    users = [
      { id: "u1", line_user_id: "U1", plan: "ultimate", plan_expires_at: null },
      { id: "u2", line_user_id: "U2", plan: "ultimate", plan_expires_at: null },
    ];
    bills = { u1: [bill()], u2: [bill({ id: "b2" })] };
    const push = vi.fn(async (to: string) => {
      if (to === "U1") throw new Error("blocked");
    });
    const summary = await runBillReminders(db, push, NOW);
    expect(summary).toMatchObject({ sent: 1, errors: 1 });
    expect(await runBillReminders(db, push, NOW)).toMatchObject({ sent: 0 });
  });

  it("a credit card's due day reminds 3 days and 1 day before, as plain text with no buttons", async () => {
    bills = {};
    wallets = [
      {
        id: "c1",
        name: "KBank",
        kind: "card",
        isDefault: false,
        openingSatang: 0,
        incomeSatang: 0,
        expenseSatang: 450_000,
        transferInSatang: 0,
        transferOutSatang: 0,
        debtInSatang: 0,
        debtOutSatang: 0,
        entryCount: 0,
        creditLimitSatang: null,
        statementDay: null,
        dueDay: 21,
      },
    ];
    const push = vi.fn(async () => undefined);
    const summary = await runBillReminders(db, push, NOW); // 18 Oct: 3 days before the 21st
    expect(summary.sent).toBe(1);
    const messages = (push.mock.calls[0] as unknown as [string, Record<string, unknown>[]])[1];
    expect(messages[0]?.text).toContain("บัตร KBank");
    expect(messages[0]?.text).toContain("฿4,500");
    expect(messages[0]).not.toHaveProperty("quickReply");
  });

  it("cleans old sent-reminder rows", async () => {
    await runBillReminders(
      db,
      vi.fn(async () => undefined),
      NOW,
    );
    expect(pruned).toBe(1);
  });
});

describe("billReminderMessage", () => {
  it("a real bill has three buttons", () => {
    const m = billReminderMessage({
      key: "k",
      bill: bill(),
      kind: "before",
      daysBefore: 1,
    }) as unknown as {
      quickReply: { items: unknown[] };
    };
    expect(m.quickReply.items).toHaveLength(3);
  });
});
