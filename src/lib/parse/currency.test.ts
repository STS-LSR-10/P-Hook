import { describe, expect, it } from "vitest";
import { parseMessage } from "./text-parser";
import { extractForeign } from "./currency";

const NOW = new Date("2026-10-18T05:00:00Z");

describe("extractForeign", () => {
  it.each([
    ["ราเมน 1500 JPY", "JPY", 150000, "ราเมน"],
    ["ราเมน 1500 jpy", "JPY", 150000, "ราเมน"],
    ["ราเมน JPY 1500", "JPY", 150000, "ราเมน"],
    ["ชา 80 เยน", "JPY", 8000, "ชา"],
    ["ตั๋ว 200 USD", "USD", 20000, "ตั๋ว"],
    ["ตั๋ว 1,200.50 ดอลลาร์", "USD", 120050, "ตั๋ว"],
    ["ซื้อของ 30 ยูโร", "EUR", 3000, "ซื้อของ"],
    ["อาหาร 45 หยวน", "CNY", 4500, "อาหาร"],
    ["อาหาร 45 RMB", "CNY", 4500, "อาหาร"],
    ["กาแฟ $5", "USD", 500, "กาแฟ"],
    ["กาแฟ €4.50", "EUR", 450, "กาแฟ"],
    ["รถไฟ ¥1,500", "JPY", 150000, "รถไฟ"],
    ["ของฝาก 20 ดอลลาร์สิงคโปร์", "SGD", 2000, "ของฝาก"],
    ["ของฝาก 20 SGD", "SGD", 2000, "ของฝาก"],
  ])("%s", (line, currency, minor, text) => {
    const hit = extractForeign(line);
    expect(hit?.foreign).toMatchObject({ currency, minor, supported: true });
    expect(hit?.text).toBe(text);
  });

  it("keeps a sign typed in front", () => {
    expect(extractForeign("+500 USD ขายของ")?.sign).toBe("+");
    expect(extractForeign("ขายของ -500 USD")?.sign).toBe("-");
    expect(extractForeign("ขายของ 500 USD")?.sign).toBeNull();
  });

  it("knows VND and TWD but marks them unsupported", () => {
    expect(extractForeign("ข้าว 50000 VND")?.foreign).toMatchObject({
      currency: "VND",
      supported: false,
    });
    expect(extractForeign("ชาไข่มุก 80 TWD")?.foreign).toMatchObject({
      currency: "TWD",
      supported: false,
    });
  });

  it.each([
    "กาแฟ 50",
    "กาแฟ 50 บาท",
    "กาแฟ 50 THB",
    "JPYshop 500", // letters run into the code
    "500 USDT", // a longer code
    "ข้าว 1500", // no currency
    "โรงเรียนวอนดี 50",
  ])("%s has no foreign amount", (line) => {
    expect(extractForeign(line)).toBeNull();
  });
});

describe("parseMessage with currencies", () => {
  it("is off by default: the digits are baht, as before", () => {
    const e = parseMessage("ราเมน 1500 JPY", NOW).entries[0];
    expect(e?.foreign).toBeNull();
    expect(e?.amountSatang).toBe(150000);
  });

  it("on: the entry carries the foreign amount and a clean title", () => {
    const e = parseMessage("ราเมน 1500 JPY", NOW, { currencies: true }).entries[0];
    expect(e?.foreign).toEqual({ currency: "JPY", minor: 150000, supported: true });
    expect(e?.title).toBe("ราเมน");
    expect(e?.type).toBe("expense");
  });

  it("works with a date, a wallet, a tag and income", () => {
    const e = parseMessage("เมื่อวาน ขายของ +20 USD @ktc #งาน", NOW, { currencies: true })
      .entries[0];
    expect(e?.foreign?.currency).toBe("USD");
    expect(e?.type).toBe("income");
    expect(e?.walletHint).toBe("ktc");
    expect(e?.tags).toEqual(["งาน"]);
    expect(e?.backdated).toBe(true);
  });

  it("a plain baht line is untouched when currencies are on", () => {
    const e = parseMessage("กาแฟ 50", NOW, { currencies: true }).entries[0];
    expect(e?.foreign).toBeNull();
    expect(e?.amountSatang).toBe(5000);
  });

  it("each line of a multi-entry message is read on its own", () => {
    const { entries } = parseMessage("ราเมน 1500 JPY, กาแฟ 50", NOW, { currencies: true });
    expect(entries.map((e) => e.foreign?.currency ?? null)).toEqual(["JPY", null]);
  });
});

describe("baht written in a book kept in another currency", () => {
  it("is a foreign amount there, and nothing special in a baht book", async () => {
    const { runInZone } = await import("@/lib/zone-scope");
    const { extractForeign: find } = await import("./currency");
    const inDollars = (line: string) => runInZone(null, () => find(line), "USD");
    expect(inDollars("กาแฟ 60 บาท")?.foreign).toEqual({
      currency: "THB",
      minor: 6000,
      supported: true,
    });
    expect(inDollars("กาแฟ ฿60")?.foreign.currency).toBe("THB");
    expect(inDollars("taxi 120 baht")?.text).toBe("taxi");
    expect(inDollars("กาแฟ 60")).toBeNull();
    expect(find("กาแฟ 60 บาท")).toBeNull();
  });
});
