import { describe, expect, it } from "vitest";
import { buildBatchConfirmMessage, type BatchRow } from "./batch-flex";

const rows: BatchRow[] = [
  {
    txId: "t1",
    title: "น้ำ",
    type: "expense",
    amountSatang: 1000,
    categoryName: "เครื่องดื่ม",
    categoryEmoji: "🥤",
  },
  {
    txId: "t2",
    title: "ข้าว",
    type: "expense",
    amountSatang: 5000,
    categoryName: "อาหาร",
    categoryEmoji: "🍜",
  },
];
const base = { rows, budgets: [] as never[], notices: [] as never[] };

type Json = Record<string, unknown>;
const walk = (node: unknown, fn: (n: Json) => void) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, fn));
  else if (node && typeof node === "object") {
    fn(node as Json);
    Object.values(node as Json).forEach((v) => walk(v, fn));
  }
};
const texts = (m: unknown) => {
  const out: string[] = [];
  walk(m, (n) => {
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
  });
  return out;
};
const actions = (m: unknown) => {
  const out: Json[] = [];
  walk(m, (n) => {
    if (n.action && typeof n.action === "object") out.push(n.action as Json);
  });
  return out;
};

describe("buildBatchConfirmMessage", () => {
  it("is one flex message with the count in its title", () => {
    const m = buildBatchConfirmMessage(base) as unknown as Json;
    expect(m.type).toBe("flex");
    expect(texts(m)).toContain("จดสำเร็จ 2 รายการ ✅");
    expect(texts(m)).toContain("อย่าลืมตรวจสอบรายการที่จดด้วยนะ");
  });

  it("lists each entry with its emoji, title, category and signed amount", () => {
    const t = texts(buildBatchConfirmMessage(base));
    for (const s of ["🥤", "น้ำ", "เครื่องดื่ม", "-฿10", "🍜", "ข้าว", "อาหาร", "-฿50"]) {
      expect(
        t.some((x) => x.includes(s)),
        s,
      ).toBe(true);
    }
  });

  it("gives every row its own delete and edit button for that entry", () => {
    const a = actions(buildBatchConfirmMessage({ ...base }));
    const del = a.filter((x) => String(x.data ?? "").startsWith("a=del&id="));
    expect(del.map((x) => x.data)).toEqual(["a=del&id=t1", "a=del&id=t2"]);
    const edit = a.filter((x) => String(x.data ?? "").startsWith("a=edit&id="));
    expect(edit.map((x) => x.data)).toEqual(["a=edit&id=t1", "a=edit&id=t2"]);
  });

  it("opens the editor page when there is a link for the entry", () => {
    const withUrl = rows.map((r) => ({
      ...r,
      editUrl: `https://liff.line.me/x/transactions?edit=${r.txId}`,
    }));
    const a = actions(buildBatchConfirmMessage({ ...base, rows: withUrl }));
    const uris = a.filter((x) => x.type === "uri").map((x) => x.uri);
    expect(uris).toEqual([
      "https://liff.line.me/x/transactions?edit=t1",
      "https://liff.line.me/x/transactions?edit=t2",
    ]);
    expect(a.filter((x) => String(x.data ?? "").startsWith("a=edit"))).toHaveLength(0);
  });

  it("totals the expenses, and the incomes on their own line when mixed", () => {
    expect(texts(buildBatchConfirmMessage(base))).toContain("-฿60");
    const mixed = buildBatchConfirmMessage({
      ...base,
      rows: [
        ...rows,
        {
          txId: "t3",
          title: "ขายของ",
          type: "income",
          amountSatang: 20000,
          categoryName: null,
          categoryEmoji: null,
        },
      ],
    });
    const t = texts(mixed);
    expect(t).toContain("+฿200");
    expect(t).toContain("รายรับรวม");
    expect(t).toContain("รายจ่ายรวม");
  });

  it("shows the budget once, in the compact form of the design", () => {
    const m = buildBatchConfirmMessage({
      ...base,
      budgets: [
        {
          label: "งบเดือนนี้",
          status: { scopeName: null, spentSatang: 1019600, limitSatang: 1500000, level: "ok" },
        },
      ],
    });
    const t = texts(m);
    expect(t).toContain("งบเดือนนี้ ฿15,000");
    expect(t).toContain("68%");
    expect(t.some((x) => x.includes("ใช้ไป ฿10,196") && x.includes("เหลือ ฿4,804"))).toBe(true);
  });

  it("says how far over the budget it went", () => {
    const m = buildBatchConfirmMessage({
      ...base,
      budgets: [
        {
          label: "งบเดือนนี้",
          status: { scopeName: null, spentSatang: 1600000, limitSatang: 1500000, level: "over" },
        },
      ],
    });
    expect(texts(m).some((x) => x.includes("เกินงบ ฿1,000"))).toBe(true);
  });

  it("carries warnings inside the card", () => {
    const m = buildBatchConfirmMessage({
      ...base,
      notices: [{ text: "วันนี้ใช้เกินงบวัน", level: "warn" }],
    });
    expect(texts(m).some((x) => x.includes("วันนี้ใช้เกินงบวัน"))).toBe(true);
  });

  it("shows at most 10 rows and says how many more were saved", () => {
    const many: BatchRow[] = Array.from({ length: 14 }, (_, i) => ({
      txId: `t${i}`,
      title: `รายการ${i}`,
      type: "expense",
      amountSatang: 1000,
      categoryName: null,
      categoryEmoji: null,
    }));
    const m = buildBatchConfirmMessage({ ...base, rows: many });
    const t = texts(m);
    expect(t).toContain("จดสำเร็จ 14 รายการ ✅");
    expect(actions(m).filter((x) => String(x.data ?? "").startsWith("a=del"))).toHaveLength(10);
    expect(t.some((x) => x.includes("อีก 4 รายการ"))).toBe(true);
  });

  it("keeps the alt text within LINE's 400 characters", () => {
    const long: BatchRow[] = Array.from({ length: 10 }, (_, i) => ({
      txId: `t${i}`,
      title: "ชื่อรายการที่ยาวมากมากมากมาก".repeat(3),
      type: "expense",
      amountSatang: 1000,
      categoryName: null,
      categoryEmoji: null,
    }));
    const m = buildBatchConfirmMessage({ ...base, rows: long }) as unknown as { altText: string };
    expect(m.altText.length).toBeLessThanOrEqual(400);
  });

  it("is a bubble whose colours are the base palette, so the card theme can recolour it", () => {
    const json = JSON.stringify(buildBatchConfirmMessage(base)).toUpperCase();
    expect(json).toContain("#CCFBF1");
    expect(json).toContain("#E11D48");
  });
});
