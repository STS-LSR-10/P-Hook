import { describe, expect, it } from "vitest";
import { parseGroupCommand } from "./group";
import {
  billShares,
  evaluateSlip,
  parseBillCommand,
  receiverLast4s,
  totalOwed,
  unpaid,
  type BillRow,
  type OpenShare,
} from "./split-bill";

describe("parseBillCommand", () => {
  it("title then amount", () => {
    expect(parseBillCommand("หารบิล หมูกระทะ 1200")).toEqual({
      kind: "bill-new",
      title: "หมูกระทะ",
      amountSatang: 120_000,
      names: [],
      all: false,
    });
  });

  it("names after the amount (spaces or commas), commas in the amount, satang", () => {
    expect(parseBillCommand("หารบิล ข้าวเย็น 1,250.50 แอน, บ๊อบ ชมพู")).toEqual({
      kind: "bill-new",
      title: "ข้าวเย็น",
      amountSatang: 125_050,
      names: ["แอน", "บ๊อบ", "ชมพู"],
      all: false,
    });
  });

  it("the amount first: the rest is the name, or just 'บิล'", () => {
    expect(parseBillCommand("หารบิล 450 ชาบู")).toMatchObject({
      title: "ชาบู",
      amountSatang: 45_000,
      names: [],
    });
    expect(parseBillCommand("หารบิล 450")).toMatchObject({ title: "บิล", amountSatang: 45_000 });
  });

  it("'หาร บิล' with a space and 'แบ่งบิล' are the same words", () => {
    expect(parseBillCommand("หาร บิล หมูกระทะ 1200")).toMatchObject({
      kind: "bill-new",
      title: "หมูกระทะ",
    });
    expect(parseBillCommand("แบ่งบิล 450 ชาบู")).toMatchObject({
      kind: "bill-new",
      title: "ชาบู",
      amountSatang: 45_000,
    });
    expect(parseBillCommand("แบ่ง บิล 450")).toMatchObject({ kind: "bill-new", title: "บิล" });
    expect(parseBillCommand("หาร")).toBeNull();
    expect(parseBillCommand("หารกัน 100")).toBeNull();
    expect(parseBillCommand("หารบิลไหม")).toBeNull();
  });

  it("'ทั้งหมด' / 'ทุกคน' means everyone, in either place", () => {
    expect(parseBillCommand("หารบิล หมูกระทะ 1200 ทั้งหมด")).toMatchObject({
      all: true,
      names: [],
    });
    expect(parseBillCommand("หารบิล หมูกระทะ 1200 ทุกคน")).toMatchObject({ all: true, names: [] });
    expect(parseBillCommand("หารบิล 1200 หมูกระทะ ทั้งหมด")).toMatchObject({
      all: true,
      title: "หมูกระทะ",
      amountSatang: 120_000,
    });
    expect(parseBillCommand("หารบิล 1200 ทั้งหมด")).toMatchObject({ all: true, title: "บิล" });
    expect(parseBillCommand("หารบิล 1200 หมูกระทะ")).toMatchObject({ all: false });
  });

  it("the message the people-picker page writes in the group is recognised", () => {
    expect(parseBillCommand("✅ เลือกคนหารบิล หมูกระทะ แล้ว #abcdef12")).toEqual({
      kind: "bill-announce",
      shortId: "abcdef12",
    });
    expect(parseBillCommand("✅ เลือกคนหารบิล ชาบู ร้านดัง แล้ว #0123abcd")).toMatchObject({
      kind: "bill-announce",
    });
    expect(parseBillCommand("✅ เลือกคนหารบิล หมูกระทะ แล้ว #xyz")).toBeNull();
    expect(parseBillCommand("เลือกคนหารบิล หมูกระทะ แล้ว #abcdef12")).toBeNull(); // typed by hand without the tick
  });

  it("หารบิล can stand anywhere in the message", () => {
    const bill = (input: string) => parseBillCommand(input);
    expect(bill("หารบิลข้าว 100")).toMatchObject({
      kind: "bill-new",
      title: "ข้าว",
      amountSatang: 10_000,
    });
    expect(bill("หารบิล ข้าว 100")).toMatchObject({ title: "ข้าว", amountSatang: 10_000 });
    expect(bill("ข้าว 100 หารบิล")).toMatchObject({ title: "ข้าว", amountSatang: 10_000 });
    expect(bill("ข้าว 100, หารบิล")).toMatchObject({ title: "ข้าว", amountSatang: 10_000 });
    expect(bill("ข้าว หารบิล 100")).toMatchObject({ title: "ข้าว", amountSatang: 10_000 });
    expect(bill("ข้าว 100 หาร บิล")).toMatchObject({ title: "ข้าว", amountSatang: 10_000 });
    expect(bill("แบ่งบิลข้าว 100")).toMatchObject({ title: "ข้าว", amountSatang: 10_000 });
    expect(bill("ข้าว 100 ทั้งหมด หารบิล")).toMatchObject({ title: "ข้าว", all: true });
  });

  it("several items in one message make one bill of their total", () => {
    expect(parseBillCommand("หารบิล ข้าว 100, น้ำ 200")).toEqual({
      kind: "bill-new",
      title: "ข้าว, น้ำ",
      amountSatang: 30_000,
      names: [],
      all: false,
    });
    expect(parseBillCommand("ข้าว 100, น้ำ 200 หารบิล")).toMatchObject({
      title: "ข้าว, น้ำ",
      amountSatang: 30_000,
    });
    expect(parseBillCommand("หารบิล ข้าว 100\nน้ำ 200\nขนม 50")).toMatchObject({
      title: "ข้าว, น้ำ, ขนม",
      amountSatang: 35_000,
    });
    // a comma inside a number is not a separator
    expect(parseBillCommand("หารบิล ข้าว 1,200, น้ำ 300")).toMatchObject({ amountSatang: 150_000 });
    // names / everyone after the last item belong to the whole bill
    expect(parseBillCommand("หารบิล ข้าว 100, น้ำ 200 แอน บ๊อบ")).toMatchObject({
      amountSatang: 30_000,
      names: ["แอน", "บ๊อบ"],
    });
    expect(parseBillCommand("หารบิล ข้าว 100, น้ำ 200 ทั้งหมด")).toMatchObject({
      all: true,
      names: [],
    });
    expect(parseBillCommand("หารบิล 100 ข้าว, 200 น้ำ")).toMatchObject({
      title: "ข้าว, น้ำ",
      amountSatang: 30_000,
    });
  });

  it("a long list of items is shortened, one long name is refused, an item without an amount is refused", () => {
    const many = Array.from(
      { length: 12 },
      (_, i) => `อาหารจานที่${"กขคงจฉชซฌญฎฏ"[i]} ${100 + i}`,
    ).join(", ");
    const cmd = parseBillCommand(`หารบิล ${many}`);
    expect(cmd?.kind).toBe("bill-new");
    expect((cmd as { title: string }).title.length).toBeLessThanOrEqual(40);
    expect(parseBillCommand("หารบิล ข้าว 100, น้ำ")).toMatchObject({
      kind: "bill-new",
      names: ["น้ำ"],
    });
    expect(parseBillCommand("หารบิล ข้าว 100, น้ำ 5 ขนม 7 ")?.kind).toBe("bill-new");
    expect(parseBillCommand("หารบิล " + "ก".repeat(41) + " 100")?.kind).toBe("bill-usage");
    expect(parseBillCommand("หารบิล ข้าว 60000000, น้ำ 60000000")?.kind).toBe("bill-usage"); // over ฿1,000,000
  });

  it("chat that merely contains the word, without an amount, is left alone", () => {
    for (const chat of ["เดี๋ยวหารบิลกัน", "ช่วยหารบิลหน่อย", "ข้าว หารบิล ค่ะ", "หารบิลไหม"]) {
      expect(parseBillCommand(chat), chat).toBeNull();
    }
    expect(parseBillCommand("หารบิล")).toEqual({ kind: "bill-usage" });
  });

  it("Thai digits work", () => {
    expect(parseBillCommand("หารบิล ชาบู ๖๐๐")).toMatchObject({ amountSatang: 60_000 });
  });

  it("explains instead of guessing when something is missing or silly", () => {
    for (const text of [
      "หารบิล",
      "หารบิล หมูกระทะ",
      "หารบิล หมูกระทะ 0",
      "หารบิล หมูกระทะ 99999999",
    ]) {
      expect(parseBillCommand(text)?.kind, text).toBe("bill-usage");
    }
    expect(parseBillCommand("หารบิล " + "ก".repeat(41) + " 100")?.kind).toBe("bill-usage");
  });

  it("the other words", () => {
    expect(parseBillCommand("ตามเงิน")).toEqual({ kind: "bill-chase" });
    expect(parseBillCommand("บิลค้าง")).toEqual({ kind: "bill-open" });
    for (const q of ["ใครค้างบ้าง", "ใครค้างเงินบ้าง", "ใครยังไม่จ่ายบ้าง", "ใครค้างจ่ายอยู่บ้าง"])
      expect(parseBillCommand(q), q).toEqual({ kind: "bill-open" });
    expect(parseBillCommand("ใครค้างเรื่องงานอยู่")).toBeNull();
    expect(parseBillCommand("ปิดรายชื่อ")).toEqual({ kind: "bill-close" });
    expect(parseBillCommand("ยกเลิกบิล")).toEqual({ kind: "bill-cancel" });
    expect(parseBillCommand("ได้รับแล้ว แอน")).toEqual({ kind: "bill-paid", names: ["แอน"] });
    expect(parseBillCommand("ได้รับ แอน บ๊อบ")).toEqual({
      kind: "bill-paid",
      names: ["แอน", "บ๊อบ"],
    });
  });

  it("โอนแล้ว and ยังไม่ได้รับ", () => {
    expect(parseBillCommand("โอนแล้ว")).toEqual({ kind: "bill-claim" });
    expect(parseBillCommand("ยังไม่ได้รับ แอน")).toEqual({ kind: "bill-unpaid", names: ["แอน"] });
    expect(parseBillCommand("โอนแล้วนะ")).toBeNull();
    expect(parseBillCommand("ยังไม่ได้รับ")).toBeNull();
  });

  it("ordinary chat is not a command", () => {
    for (const text of [
      "หารกันเถอะ",
      "บิลมาแล้ว",
      "ตามเงินหน่อย",
      "ได้รับแล้วนะ",
      "กินข้าว 100 ไหม",
      "บิล",
    ]) {
      expect(parseBillCommand(text), text).toBeNull();
    }
  });

  it("is part of what a group understands, and does not steal the record or trip commands", () => {
    expect(parseGroupCommand("หารบิล หมูกระทะ 1200")?.kind).toBe("bill-new");
    expect(parseGroupCommand("ตามเงิน")?.kind).toBe("bill-chase");
    expect(parseGroupCommand("จด ข้าวเที่ยง 350")?.kind).toBe("record");
    expect(parseGroupCommand("เริ่มทริป เชียงใหม่")?.kind).toBe("trip-start");
  });
});

describe("billShares", () => {
  const total = (list: { shareSatang: number }[]) => list.reduce((s, x) => s + x.shareSatang, 0);

  it("equal shares that add up exactly, whatever the amount and the number of people", () => {
    for (const amount of [100, 101, 9999, 120_000, 1_234_567]) {
      for (let n = 2; n <= 9; n++) {
        const people = Array.from({ length: n }, (_, i) => `U${i}`);
        const shares = billShares(amount, people, "U0");
        expect(total(shares), `${amount}/${n}`).toBe(amount);
        const values = shares.map((s) => s.shareSatang);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the payer is always in, takes the odd satang first, and counts as paid", () => {
    const shares = billShares(10_000, ["Ubob", "Uchom"], "Uanna");
    expect(shares.map((s) => s.lineUserId)).toEqual(["Uanna", "Ubob", "Uchom"]);
    expect(shares.map((s) => s.shareSatang)).toEqual([3334, 3333, 3333]);
    expect(shares.filter((s) => s.paid).map((s) => s.lineUserId)).toEqual(["Uanna"]);
  });
});

describe("who still owes", () => {
  const m = (lineUserId: string, shareSatang: number, paid: boolean) => ({
    lineUserId,
    shareSatang,
    paid,
    qrToken: lineUserId,
  });
  it("leaves out the payer and the ones who paid", () => {
    const members = [
      m("Uanna", 300, true),
      m("Ubob", 300, false),
      m("Uchom", 300, true),
      m("Udan", 250, false),
    ];
    expect(unpaid(members, "Uanna").map((x) => x.lineUserId)).toEqual(["Ubob", "Udan"]);
    expect(totalOwed(members, "Uanna")).toBe(550);
    expect(totalOwed([m("Uanna", 300, false)], "Uanna")).toBe(0); // the payer never owes themself
  });
});

describe("evaluateSlip", () => {
  const bill = (id: string, createdAt: string, payer = "Uanna"): BillRow => ({
    id,
    groupId: "g",
    payerLineUserId: payer,
    title: id,
    amountSatang: 90_000,
    status: "collecting",
    createdAt,
  });
  const open = (
    id: string,
    share: number,
    createdAt = "2026-10-18T05:00:00Z",
    payer = "Uanna",
  ): OpenShare => ({
    bill: bill(id, createdAt, payer),
    shareSatang: share,
  });
  const payee = { promptpayId: "0812345678", bankAccount: "123-4-56789-0" };
  const base = {
    amountSatang: 30_000,
    paidAt: new Date("2026-10-18T05:05:00Z"),
    receiverLast4: "5678",
    payeeOf: () => payee,
  };

  it("nothing owed, nothing to decide", () => {
    expect(evaluateSlip({ ...base, open: [] })).toBeNull();
  });

  it("pays a share when the slip covers it and goes to the payer's PromptPay or bank account", () => {
    const v = evaluateSlip({ ...base, open: [open("b1", 30_000)] });
    expect(v).toMatchObject({ kind: "paid", receiver: "verified", overSatang: 0 });
    // the bank account's last four digits count too
    expect(
      evaluateSlip({ ...base, receiverLast4: "7890", open: [open("b1", 30_000)] }),
    ).toMatchObject({
      kind: "paid",
      receiver: "verified",
    });
  });

  it("more than the share is fine and the extra is reported", () => {
    expect(
      evaluateSlip({ ...base, amountSatang: 35_050, open: [open("b1", 30_000)] }),
    ).toMatchObject({
      kind: "paid",
      overSatang: 5050,
    });
  });

  it("less than every open share is 'too little', with the smallest share to compare", () => {
    expect(
      evaluateSlip({
        ...base,
        amountSatang: 20_000,
        open: [open("b1", 30_000), open("b2", 25_000)],
      }),
    ).toEqual({
      kind: "too_little",
      amountSatang: 20_000,
      smallestShareSatang: 25_000,
    });
  });

  it("with two open shares it takes the biggest the slip covers (the older bill when equal)", () => {
    const v = evaluateSlip({
      ...base,
      amountSatang: 30_000,
      open: [
        open("small", 10_000),
        open("big", 30_000, "2026-10-18T05:00:00Z"),
        open("tooBig", 40_000),
      ],
    });
    expect(v).toMatchObject({ kind: "paid", share: { bill: { id: "big" } } });
    const tie = evaluateSlip({
      ...base,
      open: [
        open("newer", 30_000, "2026-10-18T06:00:00Z"),
        open("older", 30_000, "2026-10-18T05:00:00Z"),
      ],
    });
    expect(tie).toMatchObject({ share: { bill: { id: "older" } } });
  });

  it("a receiver that is not the payer's is refused", () => {
    expect(
      evaluateSlip({ ...base, receiverLast4: "0000", open: [open("b1", 30_000)] }),
    ).toMatchObject({
      kind: "receiver_mismatch",
    });
  });

  it("a receiver the slip does not show, or a payer with nothing set, is accepted as unverified", () => {
    expect(
      evaluateSlip({ ...base, receiverLast4: null, open: [open("b1", 30_000)] }),
    ).toMatchObject({
      kind: "paid",
      receiver: "unverified",
    });
    expect(
      evaluateSlip({ ...base, payeeOf: () => null, open: [open("b1", 30_000)] }),
    ).toMatchObject({
      kind: "paid",
      receiver: "unverified",
    });
  });

  it("each bill is checked against its own payer's account", () => {
    const v = evaluateSlip({
      ...base,
      open: [open("b1", 30_000, "2026-10-18T05:00:00Z", "Ubob")],
      payeeOf: (payer) =>
        payer === "Ubob" ? { promptpayId: "0899990000", bankAccount: null } : payee,
    });
    expect(v?.kind).toBe("receiver_mismatch"); // 5678 is Anna's, not Bob's
  });

  it("a slip made before the bill was opened is refused, a few minutes of clock difference are not", () => {
    const o = [open("b1", 30_000, "2026-10-18T05:00:00Z")];
    expect(evaluateSlip({ ...base, paidAt: new Date("2026-10-18T03:00:00Z"), open: o })?.kind).toBe(
      "before_bill",
    );
    expect(evaluateSlip({ ...base, paidAt: new Date("2026-10-18T04:55:00Z"), open: o })?.kind).toBe(
      "paid",
    );
    expect(evaluateSlip({ ...base, paidAt: null, open: o })?.kind).toBe("paid"); // a slip with no time is judged on the rest
  });
});

describe("receiverLast4s", () => {
  it("the last four digits of every place the payer can be paid", () => {
    expect(receiverLast4s({ promptpayId: "0812345678", bankAccount: "123-4-56789-0" })).toEqual([
      "5678",
      "7890",
    ]);
    expect(receiverLast4s({ promptpayId: null, bankAccount: "12" })).toEqual([]);
    expect(receiverLast4s(null)).toEqual([]);
  });
});
