import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";
import {
  dueDebtsText,
  dueState,
  parseDebtText,
  planPayment,
  resolveDue,
  totalsByPerson,
  type DebtDto,
} from "./debt";

// 2026-10-18 12:00 in Bangkok
const NOW = new Date("2026-10-18T05:00:00Z");

describe("parseDebtText: new debts", () => {
  it.each([
    ["ให้ยืม สมชาย 500", "lent", "สมชาย", 50000],
    ["ให้ยืมเงิน สมชาย 1,200.50", "lent", "สมชาย", 120050],
    ["ให้ยืม สมชาย ใจดี 500 บาท", "lent", "สมชาย ใจดี", 50000],
    ["สมชายยืม 500", "lent", "สมชาย", 50000],
    ["ยืม แม่ 2000", "borrowed", "แม่", 200000],
    ["ยืมเงิน แม่ 2 พัน", "borrowed", "แม่", 200000],
    ["ขอยืม พี่ปอ 300", "borrowed", "พี่ปอ", 30000],
  ])("%s", (input, direction, person, amountSatang) => {
    expect(parseDebtText(input)).toMatchObject({
      kind: "debt-new",
      direction,
      person,
      amountSatang,
    });
  });

  it("reads a due date and a wallet", () => {
    expect(parseDebtText("ยืม แม่ 2000 คืน 25/10 @กสิกร")).toMatchObject({
      kind: "debt-new",
      person: "แม่",
      due: { kind: "dmy", day: 25, month: 10, year: null },
      walletHint: "กสิกร",
    });
    expect(parseDebtText("ให้ยืม สมชาย 500 ภายใน 7 วัน")).toMatchObject({
      due: { kind: "days", days: 7 },
    });
    expect(parseDebtText("ให้ยืม สมชาย 500 คืนพรุ่งนี้")).toMatchObject({
      due: { kind: "days", days: 1 },
    });
  });
});

describe("parseDebtText: owing in other words", () => {
  it("'<person>ติดเงิน 300' is a debt they owe me, 'ติดเงิน แม่ 500' one I owe", () => {
    expect(parseDebtText("สมชายติดเงิน 300")).toMatchObject({
      kind: "debt-new",
      direction: "lent",
      person: "สมชาย",
      amountSatang: 30000,
    });
    expect(parseDebtText("ติดเงิน แม่ 500")).toMatchObject({
      kind: "debt-new",
      direction: "borrowed",
      person: "แม่",
      amountSatang: 50000,
    });
    expect(parseDebtText("ติดหนี้ แม่ 500")).toMatchObject({ direction: "borrowed" });
    expect(parseDebtText("ผมติดเงินแม่ 500")).toMatchObject({
      kind: "debt-new",
      direction: "borrowed",
      person: "แม่",
      amountSatang: 50000,
    });
    expect(parseDebtText("ฉันติดหนี้เพื่อน 1,200")).toMatchObject({
      direction: "borrowed",
      person: "เพื่อน",
    });
  });

  it("is not a debt without a person or an amount", () => {
    expect(parseDebtText("ติดเงิน 300")).toBeNull();
    expect(parseDebtText("ค่าติดตั้ง 500")).toBeNull();
  });

  it("is not a person when it is a bill, a card, change or a shop", () => {
    for (const t of [
      "ติดเงินค่าห้อง 3000",
      "ติดหนี้บัตร 5000",
      "ติดเงินทอน 20",
      "ร้านติดหนี้ 500",
    ]) {
      expect(parseDebtText(t), t).toBeNull();
    }
  });
});

describe("parseDebtText: repayments", () => {
  it("they pay me back", () => {
    expect(parseDebtText("สมชายคืน 200")).toMatchObject({
      kind: "debt-pay",
      direction: "lent",
      person: "สมชาย",
      amountSatang: 20000,
    });
  });

  it.each(["คืนแม่ 1000", "คืน แม่ 1000", "คืนเงินแม่ 1000", "คืนเงิน แม่ 1000"])(
    "I pay them back: %s",
    (input) => {
      expect(parseDebtText(input)).toMatchObject({
        kind: "debt-pay",
        direction: "borrowed",
        person: "แม่",
        amountSatang: 100000,
      });
    },
  );

  it("takes a wallet for where the money went", () => {
    expect(parseDebtText("สมชายคืน 200 @กสิกร")).toMatchObject({ walletHint: "กสิกร" });
  });
});

describe("parseDebtText: not a debt", () => {
  it.each([
    "กาแฟ 50",
    "คืนเงิน 500", // no person
    "ยืม 500", // no person
    "ให้ยืม สมชาย", // no amount
    "ให้ยืม สมชาย 0",
    "ค่าเช่าหนังสือ ยืม 50", // a space before ยืม: not "<person>ยืม"
    "ขอบคุณ",
  ])("%s", (input) => {
    expect(parseDebtText(input)).toBeNull();
  });

  it("goes through parseCommand, keeping the case of names", () => {
    expect(parseCommand("ให้ยืม John 500")).toMatchObject({ kind: "debt-new", person: "John" });
    expect(parseCommand("หนี้")).toEqual({ kind: "debts" });
  });
});

describe("resolveDue", () => {
  it("a day/month is the next one coming, this year or next", () => {
    expect(resolveDue({ kind: "dmy", day: 25, month: 10, year: null }, NOW)?.toISOString()).toBe(
      "2026-10-25T05:00:00.000Z",
    );
    expect(resolveDue({ kind: "dmy", day: 5, month: 3, year: null }, NOW)?.toISOString()).toBe(
      "2027-03-05T05:00:00.000Z",
    );
  });

  it("understands years in the Buddhist era and rejects impossible days", () => {
    expect(resolveDue({ kind: "dmy", day: 1, month: 1, year: 2570 }, NOW)?.getUTCFullYear()).toBe(
      2027,
    );
    expect(resolveDue({ kind: "dmy", day: 31, month: 2, year: null }, NOW)).toBeNull();
  });

  it("days from today", () => {
    expect(resolveDue({ kind: "days", days: 7 }, NOW)?.toISOString()).toBe(
      "2026-10-25T05:00:00.000Z",
    );
  });
});

describe("planPayment", () => {
  const debts = [
    { id: "old", remainingSatang: 30000 },
    { id: "new", remainingSatang: 50000 },
  ];

  it("pays the oldest debt first and spills over to the next", () => {
    expect(planPayment(debts, 20000)).toEqual({
      ok: true,
      parts: [{ debtId: "old", amountSatang: 20000 }],
    });
    expect(planPayment(debts, 60000)).toEqual({
      ok: true,
      parts: [
        { debtId: "old", amountSatang: 30000 },
        { debtId: "new", amountSatang: 30000 },
      ],
    });
  });

  it("refuses more than is owed, and zero", () => {
    expect(planPayment(debts, 80001)).toEqual({ ok: false, owedSatang: 80000 });
    expect(planPayment(debts, 0)).toEqual({ ok: false, owedSatang: 80000 });
  });
});

const debt = (over: Partial<DebtDto>): DebtDto => ({
  id: "d",
  direction: "lent",
  person: "สมชาย",
  amountSatang: 50000,
  paidSatang: 0,
  remainingSatang: 50000,
  accountId: null,
  accountName: "เงินสด",
  occurredAt: "2026-10-01T05:00:00Z",
  dueAt: null,
  note: null,
  ...over,
});

describe("totalsByPerson", () => {
  it("adds a person's open debts (ignoring case and spaces), largest first, skipping settled ones", () => {
    const totals = totalsByPerson([
      debt({ id: "1", person: "John", remainingSatang: 10000, dueAt: "2026-11-01T05:00:00Z" }),
      debt({ id: "2", person: " john ", remainingSatang: 20000, dueAt: "2026-10-20T05:00:00Z" }),
      debt({ id: "3", person: "แม่", direction: "borrowed", remainingSatang: 90000 }),
      debt({ id: "4", person: "ปิดแล้ว", remainingSatang: 0 }),
    ]);
    expect(totals).toEqual([
      { person: "แม่", direction: "borrowed", remainingSatang: 90000, dueAt: null },
      { person: "John", direction: "lent", remainingSatang: 30000, dueAt: "2026-10-20T05:00:00Z" },
    ]);
  });
});

describe("dueState and the reminder note", () => {
  it("overdue, soon (within 3 days, today included), later, none", () => {
    expect(dueState("2026-10-17T05:00:00Z", NOW)).toBe("overdue");
    expect(dueState("2026-10-18T09:00:00Z", NOW)).toBe("soon");
    expect(dueState("2026-10-21T05:00:00Z", NOW)).toBe("soon");
    expect(dueState("2026-10-22T05:00:00Z", NOW)).toBe("later");
    expect(dueState(null, NOW)).toBe("none");
  });

  it("the reminder lists only overdue / soon debts that are still open", () => {
    const text = dueDebtsText(
      [
        debt({ id: "1", dueAt: "2026-10-17T05:00:00Z" }),
        debt({ id: "2", person: "แม่", direction: "borrowed", dueAt: "2026-10-20T05:00:00Z" }),
        debt({ id: "3", person: "ไกล", dueAt: "2026-12-20T05:00:00Z" }),
        debt({ id: "4", person: "ครบแล้ว", dueAt: "2026-10-17T05:00:00Z", remainingSatang: 0 }),
      ],
      NOW,
    );
    expect(text).toContain("สมชาย ติดเรา");
    expect(text).toContain("เลยกำหนดแล้ว");
    expect(text).toContain("เราติด แม่");
    expect(text).not.toContain("ไกล");
    expect(text).not.toContain("ครบแล้ว");
  });

  it("nothing due, nothing said", () => {
    expect(dueDebtsText([debt({})], NOW)).toBeNull();
  });
});
