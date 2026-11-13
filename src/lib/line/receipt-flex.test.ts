import { describe, expect, it } from "vitest";
import { buildReceiptCard, type ReceiptCardEntry } from "./receipt-flex";

const at = new Date("2026-12-27T15:46:00Z"); // 22:46 in Bangkok
const entry = (over: Partial<ReceiptCardEntry> = {}): ReceiptCardEntry => ({
  txId: "t1",
  type: "expense",
  title: "เลย์มาร์ติแพ็ด",
  amountSatang: 4600,
  occurredAt: at,
  categoryName: "ชอปปิ้ง",
  categoryIcon: null,
  ...over,
});
const json = (input: Partial<Parameters<typeof buildReceiptCard>[0]> = {}) =>
  JSON.stringify(
    buildReceiptCard({
      slipId: "s1",
      entries: [entry()],
      dateKnown: true,
      ...input,
    }),
  );

describe("receipt card", () => {
  it("says it is recorded, with no picture", () => {
    expect(json()).toContain("จดสำเร็จ ✅");
    expect(json()).not.toContain('"type":"image"');
  });

  it("shows each row with its date, title and amount, and a ❌ that deletes that entry", () => {
    const out = json();
    expect(out).toContain("27 ธ.ค. 2569 22:46");
    expect(out).toContain("เลย์มาร์ติแพ็ด");
    expect(out).toContain("฿46");
    expect(out).toContain('"data":"a=rdx&id=t1"');
  });

  it("has ✏️ only when an editor link is known, opening that entry", () => {
    expect(json()).not.toContain("✏️");
    const out = json({ editUrl: (id) => `https://liff.line.me/x/transactions?edit=${id}` });
    expect(out).toContain("✏️");
    expect(out).toContain("https://liff.line.me/x/transactions?edit=t1");
  });

  it("groups rows under their category, in the order they appear", () => {
    const out = json({
      entries: [
        entry({ txId: "a", title: "ขนม", categoryName: "อาหาร", categoryIcon: "🍜" }),
        entry({ txId: "b", title: "ถุงผ้า", categoryName: "ชอปปิ้ง" }),
        entry({ txId: "c", title: "นม", categoryName: "อาหาร", categoryIcon: "🍜" }),
      ],
    });
    expect(out.match(/รายจ่าย - /g)).toHaveLength(2);
    expect(out.indexOf("รายจ่าย - 🍜 อาหาร")).toBeLessThan(out.indexOf("รายจ่าย - ชอปปิ้ง"));
    // "นม" joins the first group, ahead of "ถุงผ้า"
    expect(out.indexOf('"text":"นม"')).toBeLessThan(out.indexOf('"text":"ถุงผ้า"'));
  });

  it("an entry with no category sits under 'ไม่ระบุหมวด'", () => {
    expect(json({ entries: [entry({ categoryName: null })] })).toContain("รายจ่าย - ไม่ระบุหมวด");
  });

  it("offers 'cancel the whole slip' only when there are several rows", () => {
    expect(json()).not.toContain("a=rcx");
    const out = json({ entries: [entry(), entry({ txId: "t2" })] });
    expect(out).toContain('"data":"a=rcx&s=s1"');
  });

  it("draws at most 25 rows and names how many more were recorded", () => {
    const many = Array.from({ length: 28 }, (_, i) =>
      entry({ txId: `t${i}`, title: `สินค้า${i}` }),
    );
    const out = json({ entries: many });
    expect(out).toContain("สินค้า24");
    expect(out).not.toContain("สินค้า25");
    expect(out).toContain("และอีก 3 รายการ");
    expect(out).toContain("จดสำเร็จ 28 รายการ"); // alt text counts every one
  });

  it("flags a date that was not on the slip", () => {
    expect(json({ dateKnown: false })).toContain("ไม่เห็นวันที่บนสลิป");
    expect(json({ dateKnown: true })).not.toContain("ไม่เห็นวันที่บนสลิป");
  });

  it("keeps postback data under LINE's 300 characters and shows no long digit runs", () => {
    const out = JSON.stringify(
      buildReceiptCard({
        slipId: "11111111-1111-1111-1111-111111111111",
        entries: [entry({ txId: "22222222-2222-2222-2222-222222222222" }), entry()],
        dateKnown: true,
      }),
    );
    for (const m of out.matchAll(/"data":"([^"]+)"/g))
      expect((m[1] ?? "").length).toBeLessThan(300);
    expect(out.replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "")).not.toMatch(/\d{9,}/);
  });

  it("carries the budget, the warnings and the payment row like a typed entry's card", () => {
    const out = json({
      budgets: [{ scopeName: null, spentSatang: 1_557_400, limitSatang: 1_500_000, level: "over" }],
      cycleLabel: "รายเดือน (วันที่ 1)",
      notices: [{ text: "เกินงบรวมแล้ว", level: "over" }],
      payment: {
        choices: [
          { id: "w1", label: "💵 เงินสด", selected: true },
          { id: "w2", label: "💳 KTC", selected: false },
        ],
        more: true,
      },
    });
    expect(out).toContain("งบรวม");
    expect(out).toContain("฿15,574");
    expect(out).toContain(" / ฿15,000");
    expect(out).toContain("รอบงบ: รายเดือน (วันที่ 1)");
    expect(out).toContain("🚨 เกินงบรวมแล้ว");
    expect(out).toContain("จ่ายด้วย");
    expect(out).toContain("✓ 💵 เงินสด");
    expect(out).toContain('"data":"a=wms&s=s1&w=w2"');
    expect(out).not.toContain("a=wms&s=s1&w=w1"); // the chosen one is not a button
    expect(out).toContain('"data":"a=wls&s=s1"'); // อื่น ๆ
  });

  it("shows one block per budget (a category budget for each category) and none without a budget", () => {
    const two = json({
      budgets: [
        { scopeName: "อาหาร", spentSatang: 10_000, limitSatang: 100_000, level: "ok" },
        { scopeName: "ชอปปิ้ง", spentSatang: 95_000, limitSatang: 100_000, level: "warn" },
      ],
    });
    expect(two).toContain("งบหมวดอาหาร");
    expect(two).toContain("งบหมวดชอปปิ้ง");
    expect(json()).not.toContain("งบ");
    expect(json()).not.toContain("จ่ายด้วย");
  });

  it("a single wallet shows only itself, and the add-channel pill when the page is known", () => {
    const one = { choices: [{ id: "w1", label: "เงินสด", selected: true }], more: false };
    const plain = json({ payment: one });
    expect(plain).toContain("✓ เงินสด");
    expect(plain).not.toContain("เพิ่มช่องทาง");
    const withAdd = json({ payment: { ...one, addUrl: "https://liff.line.me/x/wallets" } });
    expect(withAdd).toContain("＋ เพิ่มช่องทาง");
    expect(withAdd).toContain('"uri":"https://liff.line.me/x/wallets"');
  });
});
