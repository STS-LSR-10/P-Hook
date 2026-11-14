import { describe, expect, it } from "vitest";
import { CONFIRM_THRESHOLD, extractTags, MAX_TAGS, parseMessage } from "./text-parser";

// 2026-10-15 15:00 in Bangkok
const NOW = new Date("2026-10-15T08:00:00Z");

function one(text: string) {
  const { entries } = parseMessage(text, NOW);
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

describe("parseMessage: basics", () => {
  it.each([
    ["กาแฟ 30", "expense", "กาแฟ", 3000],
    ["ข้าวมันไก่ 50.50", "expense", "ข้าวมันไก่", 5050],
    ["เงินเดือน 20,000", "income", "เงินเดือน", 2_000_000],
    ["+500 ขายของ", "income", "ขายของ", 50_000],
    ["-120 ค่าน้ำมัน", "expense", "ค่าน้ำมัน", 12_000],
    ["กาแฟ ๓๐", "expense", "กาแฟ", 3000],
    ["30 กาแฟ", "expense", "กาแฟ", 3000],
    ["กาแฟ 30 บาท", "expense", "กาแฟ", 3000],
    ["฿45 ชานม", "expense", "ชานม", 4500],
    ["ปันผล 1,234.56", "income", "ปันผล", 123_456],
    ["ขายของ 20,000.50 บาท", "income", "ขายของ", 2_000_050],
    ["ค่าคอม 800", "income", "ค่าคอม", 80_000],
    ["7-11 ซื้อของ 100", "expense", "7-11 ซื้อของ", 10_000],
    ["รับเงิน 500", "income", "รับเงิน", 50_000],
    ["ถูกหวย 2000", "income", "ถูกหวย", 200_000],
    ["ถูกรางวัลที่ 1 60000", "income", "ถูกรางวัลที่ 1", 6_000_000],
    ["เงินเข้า 1500", "income", "เงินเข้า", 150_000],
    ["รับโอนจากแม่ 300", "income", "รับโอนจากแม่", 30_000],
    ["ได้เงินคืน 90", "income", "ได้เงินคืน", 9000],
    ["ซื้อหวย 80", "expense", "ซื้อหวย", 8000],
    ["จ่ายคืนเพื่อน 200", "expense", "จ่ายคืนเพื่อน", 20_000],
    ["ไม่ได้รับของ 150", "expense", "ไม่ได้รับของ", 15_000],
    ["ได้ค่าขนม 100", "income", "ได้ค่าขนม", 10_000],
    ["รับค่าเช่า 5000", "income", "รับค่าเช่า", 500_000],
    ["แม่ให้ ได้เงิน 300", "income", "แม่ให้ ได้เงิน", 30_000],
    ["รับจ้างซื้อของ 300", "income", "รับจ้างซื้อของ", 30_000],
    ["รับประทานข้าว 50", "expense", "รับประทานข้าว", 5000],
    ["ได้ซื้อของ 200", "expense", "ได้ซื้อของ", 20_000],
    ["ซื้อกาแฟ 60", "expense", "ซื้อกาแฟ", 6000],
    ["จ่ายค่าไฟ 1200", "expense", "จ่ายค่าไฟ", 120_000],
    ["ซื้อสลากที่ได้เงินคืน 40", "expense", "ซื้อสลากที่ได้เงินคืน", 4000],
    ["ชำระบัตรเครดิต 3000", "expense", "ชำระบัตรเครดิต", 300_000],
    ["โอนให้แม่ 500", "expense", "โอนให้แม่", 50_000],
  ])("%s", (text, type, title, satang) => {
    const e = one(text);
    expect(e.type).toBe(type);
    expect(e.title).toBe(title);
    expect(e.amountSatang).toBe(satang);
    expect(e.confidence).toBeGreaterThanOrEqual(CONFIRM_THRESHOLD);
  });
});

describe("parseMessage: selling is income", () => {
  it.each(["ยอดขายวันนี้ 5000", "ขายรถ 200000", "ขายไก่ย่าง 500", "ขายของ 500"])(
    "%s is income",
    (text) => {
      expect(one(text).type).toBe("income");
    },
  );

  it.each(["ร้านขายยา 200", "ซื้อของขาย 300", "ขายส่ง 100", "ไปร้านขายของ 100", "ร้าน ขายยา 200"])(
    "%s is still an expense",
    (text) => {
      expect(one(text).type).toBe("expense");
    },
  );
});

describe("parseMessage: units", () => {
  it.each([
    ["ข้าว 1.5k", 150_000],
    ["ค่าห้อง 5พัน", 500_000],
    ["โบนัส 2หมื่น", 2_000_000],
    ["ค่าเทอม 1แสน", 10_000_000],
    ["ทอง 2K", 200_000],
  ])("%s", (text, satang) => {
    expect(one(text).amountSatang).toBe(satang);
  });
});

describe("parseMessage: multiple entries", () => {
  it("splits on comma", () => {
    const { entries } = parseMessage("กาแฟ 30, ข้าว 50", NOW);
    expect(entries.map((e) => [e.title, e.amountSatang])).toEqual([
      ["กาแฟ", 3000],
      ["ข้าว", 5000],
    ]);
  });

  it("splits on comma without a space", () => {
    expect(parseMessage("กาแฟ 30,ข้าว 50", NOW).entries).toHaveLength(2);
  });

  it("does not split thousands separators", () => {
    const { entries } = parseMessage("เงินเดือน 20,000, กาแฟ 30", NOW);
    expect(entries.map((e) => e.amountSatang)).toEqual([2_000_000, 3000]);
  });

  it("splits on newlines", () => {
    const { entries } = parseMessage("กาแฟ 30\nข้าว 50\nเงินเดือน 20000", NOW);
    expect(entries.map((e) => e.type)).toEqual(["expense", "expense", "income"]);
  });
});

describe("parseMessage: dates", () => {
  it("เมื่อวาน (leading)", () => {
    const e = one("เมื่อวาน กาแฟ 45");
    expect(e.title).toBe("กาแฟ");
    expect(e.occurredAt.toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });

  it("เมื่อวาน (trailing)", () => {
    expect(one("กาแฟ 45 เมื่อวาน").occurredAt.toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });

  it("เมื่อวานซืน", () => {
    expect(one("เมื่อวานซืน กาแฟ 45").occurredAt.toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });

  it("flags backdated entries only when a past day is named", () => {
    expect(one("เมื่อวาน กาแฟ 45").backdated).toBe(true);
    expect(one("12/10 ค่าไฟ 1200").backdated).toBe(true);
    expect(one("วันนี้ ข้าว 60").backdated).toBe(false);
    expect(one("กาแฟ 30").backdated).toBe(false);
  });

  it("วันนี้ keeps the current time", () => {
    expect(one("วันนี้ ข้าว 60").occurredAt.getTime()).toBe(NOW.getTime());
  });

  it("DD/MM in the current year", () => {
    const e = one("12/10 ค่าไฟ 1200");
    expect(e.title).toBe("ค่าไฟ");
    expect(e.amountSatang).toBe(120_000);
    expect(e.occurredAt.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("DD/MM/YYYY with Buddhist year", () => {
    expect(one("12/10/2569 ค่าไฟ 1200").occurredAt.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("DD/MM/YY two-digit year", () => {
    expect(one("12/10/26 ค่าไฟ 1200").occurredAt.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("a future DD/MM falls back to last year", () => {
    expect(one("25/12 ของขวัญ 500").occurredAt.toISOString()).toBe("2025-12-25T05:00:00.000Z");
  });

  it("trailing DD/MM", () => {
    expect(one("ค่าไฟ 1200 12/10").occurredAt.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("an invalid date is not consumed", () => {
    const { entries } = parseMessage("31/02 ค่าไฟ 1200", NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.occurredAt.getTime()).toBe(NOW.getTime());
  });
});

describe("parseMessage: type inference", () => {
  it("ดอกเบี้ย is income", () => {
    expect(one("ดอกเบี้ย 12").type).toBe("income");
  });

  it("ดอกเบี้ยจ่าย is expense", () => {
    expect(one("ดอกเบี้ยจ่าย 300").type).toBe("expense");
  });

  it("explicit sign wins over keywords", () => {
    expect(one("-500 เงินเดือน").type).toBe("expense");
  });

  it("a bare sign + amount is income with a default title", () => {
    const e = one("+500");
    expect(e.type).toBe("income");
    expect(e.title).toBe("รายรับ");
    expect(e.confidence).toBeGreaterThanOrEqual(CONFIRM_THRESHOLD);
  });
});

describe("parseMessage: needs confirmation", () => {
  it("a bare number is ambiguous", () => {
    const e = one("500");
    expect(e.confidence).toBeLessThan(CONFIRM_THRESHOLD);
    expect(e.amountSatang).toBe(50_000);
  });

  it("a very large amount asks first", () => {
    expect(one("ซื้อรถ 1,500,000").confidence).toBeLessThan(CONFIRM_THRESHOLD);
  });
});

describe("parseMessage: rejects", () => {
  it.each(["สวัสดี", "ข้าว 0", "โทร 0812345678", ""])("%j yields no entries", (text) => {
    expect(parseMessage(text, NOW).entries).toHaveLength(0);
  });

  it("reports unparsed segments", () => {
    const r = parseMessage("กาแฟ 30, สวัสดี", NOW);
    expect(r.entries).toHaveLength(1);
    expect(r.unparsed).toEqual(["สวัสดี"]);
  });

  it.each([
    "https://liff.line.me/2012036534-18JOac/summary",
    "ดูนี่ https://example.com/p/123 ราคา 500",
    "www.shop.co.th 250",
    "line.me/R/ti/p/@abc 30",
  ])("ignores links: %s", (text) => {
    expect(parseMessage(text, NOW).entries).toHaveLength(0);
  });

  it("still parses normal text next to a link", () => {
    const { entries } = parseMessage("กาแฟ 30\nhttps://example.com/1", NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe("กาแฟ");
  });

  it("ignores very long sentences", () => {
    const text =
      "วันนี้ฉันไปเดินเล่นที่สวนสาธารณะแล้วเจอเพื่อนเก่าที่ไม่ได้เจอกันมานานมากเลยคุยกันนานมากมาย 2 ชั่วโมง";
    expect(parseMessage(text, NOW).entries).toHaveLength(0);
  });
});

describe("a date anywhere in the line", () => {
  const YESTERDAY = "2026-10-14T05:00:00.000Z"; // NOW is 15 Oct 15:00 in Bangkok

  it.each([
    ["จ่ายค่าทุเรียน เมื่อวาน 300", "จ่ายค่าทุเรียน"],
    ["เมื่อวาน ทุเรียน 300", "ทุเรียน"],
    ["ทุเรียน 300 เมื่อวาน", "ทุเรียน"],
    ["จ่ายค่าทุเรียน 300 เมื่อวาน", "จ่ายค่าทุเรียน"],
    ["เมื่อวานจ่ายค่าทุเรียน 300", "จ่ายค่าทุเรียน"],
    ["ซื้อทุเรียนเมื่อวาน 300", "ซื้อทุเรียน"],
    ["จ่ายค่าทุเรียนเมื่อวานนี้ 300", "จ่ายค่าทุเรียน"],
  ])("%s is yesterday, whatever the position", (text, title) => {
    const e = one(text);
    expect(e.title).toBe(title);
    expect(e.amountSatang).toBe(30_000);
    expect(e.backdated).toBe(true);
    expect(e.occurredAt.toISOString()).toBe(YESTERDAY);
  });

  it("เมื่อวานซืน in the middle is two days ago, not yesterday plus a stray word", () => {
    const e = one("ค่าน้ำมัน เมื่อวานซืน 500");
    expect(e.title).toBe("ค่าน้ำมัน");
    expect(e.occurredAt.toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });

  it("วันนี้ in the middle keeps the current time and is not a backdate", () => {
    const e = one("ซื้อของ วันนี้ 80");
    expect(e.title).toBe("ซื้อของ");
    expect(e.backdated).toBe(false);
    expect(e.occurredAt.getTime()).toBe(NOW.getTime());
  });

  it("never leaves a double space or the day word in the title", () => {
    const e = one("กาแฟ   เมื่อวาน   45");
    expect(e.title).toBe("กาแฟ");
    expect(e.title).not.toContain("เมื่อวาน");
  });

  it("works with a #tag and a sign next to it", () => {
    const e = one("#trip ซื้อทุเรียน เมื่อวาน -300");
    expect(e.tags).toEqual(["trip"]);
    expect(e.title).toBe("ซื้อทุเรียน");
    expect(e.type).toBe("expense");
    expect(e.occurredAt.toISOString()).toBe(YESTERDAY);
  });

  it("a DD/MM in the middle counts when it cannot be a fraction", () => {
    const e = one("ค่าไฟ 12/10 1200");
    expect(e.title).toBe("ค่าไฟ");
    expect(e.amountSatang).toBe(120_000);
    expect(e.occurredAt.toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(one("ซื้อของ 25/3 500").occurredAt.toISOString()).toBe("2026-03-25T05:00:00.000Z");
  });

  it("a DD/MM/YYYY in the middle counts", () => {
    expect(one("ค่าห้อง 5/6/2026 3000").occurredAt.toISOString()).toBe("2026-06-05T05:00:00.000Z");
  });

  it("a fraction in the middle stays in the title and does not become a date", () => {
    const e = one("ข้าว 1/2 จาน 50");
    expect(e.title).toBe("ข้าว 1/2 จาน");
    expect(e.backdated).toBe(false);
    expect(e.amountSatang).toBe(5000);
    expect(one("หมู 3/4 กก. 120").backdated).toBe(false);
  });

  it("an ambiguous mid-line 5/6 stays text, but still works at the start or end", () => {
    expect(one("ค่าห้อง 5/6 3000").backdated).toBe(false);
    expect(one("5/6 ค่าห้อง 3000").occurredAt.toISOString()).toBe("2026-06-05T05:00:00.000Z");
    expect(one("ค่าห้อง 3000 5/6").occurredAt.toISOString()).toBe("2026-06-05T05:00:00.000Z");
  });

  it("each line of a multi-line message has its own date", () => {
    const { entries } = parseMessage("กาแฟ เมื่อวาน 45\nข้าว 60", NOW);
    expect(entries.map((e) => e.backdated)).toEqual([true, false]);
  });
});

describe("the date picker's prefix", () => {
  it("reads DD/MM/YYYY plus a typed item as a backdated entry on that day", () => {
    const e = one("12/10/2026 กาแฟ 60");
    expect(e.title).toBe("กาแฟ");
    expect(e.amountSatang).toBe(6000);
    expect(e.backdated).toBe(true);
    expect(e.occurredAt.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("a prefix with no item typed yet is not an entry", () => {
    expect(parseMessage("12/10/2026 ", NOW).entries).toHaveLength(0);
  });
});

describe("#tags", () => {
  it("are taken out of the title and kept on the entry", () => {
    const e = one("หมูกระทะ 500 #ปาร์ตี้บริษัท");
    expect(e.title).toBe("หมูกระทะ");
    expect(e.tags).toEqual(["ปาร์ตี้บริษัท"]);
    expect(e.amountSatang).toBe(50_000);
  });

  it("work anywhere in the line, several at once, lower-cased and without repeats", () => {
    const e = one("#Trip กาแฟ #เชียงใหม่ 60 #trip");
    expect(e.title).toBe("กาแฟ");
    expect(e.tags).toEqual(["trip", "เชียงใหม่"]);
    expect(e.amountSatang).toBe(6000);
  });

  it("do not disturb the date or the income/expense reading", () => {
    const e = one("เมื่อวาน เงินเดือน 25000 #งานหลัก");
    expect(e.type).toBe("income");
    expect(e.tags).toEqual(["งานหลัก"]);
    expect(e.backdated).toBe(true);
  });

  it("digits inside a tag are not read as the amount", () => {
    const e = one("ค่าที่พัก 1200 #trip2026");
    expect(e.amountSatang).toBe(120_000);
    expect(e.tags).toEqual(["trip2026"]);
  });

  it("a # followed by a number is not a tag", () => {
    expect(extractTags("คิวที่ #1 กาแฟ 50").tags).toEqual([]);
  });

  it("keeps at most MAX_TAGS but still removes the extra ones from the title", () => {
    const { text, tags } = extractTags("ข้าว #a #b #c #d #e #f #g");
    expect(tags).toHaveLength(MAX_TAGS);
    expect(text).toBe("ข้าว");
  });

  it("an entry without tags has an empty list", () => {
    expect(one("กาแฟ 30").tags).toEqual([]);
  });
});

describe("@wallet", () => {
  it("takes the wallet word out of the title", () => {
    const e = one("กาแฟ 45 @บัตร");
    expect(e.walletHint).toBe("บัตร");
    expect(e.title).toBe("กาแฟ");
    expect(e.amountSatang).toBe(4500);
  });

  it("works at the start and together with a tag", () => {
    const e = one("@ออมทรัพย์ เงินเดือน 20000 #งาน");
    expect(e.walletHint).toBe("ออมทรัพย์");
    expect(e.tags).toEqual(["งาน"]);
    expect(e.title).toBe("เงินเดือน");
  });

  it("an entry without @ has no wallet", () => {
    expect(one("กาแฟ 30").walletHint).toBeNull();
  });

  it("an email address is not a wallet", () => {
    expect(one("ค่าเมล a@b 30").walletHint).toBeNull();
  });
});

describe("several entries typed one after another, with no comma between", () => {
  const now = new Date("2026-11-04T03:00:00Z");
  const read = (s: string) =>
    parseMessage(s, now).entries.map((e) => [e.title, e.amountSatang / 100, e.type]);

  it("each name with its own amount is an entry", () => {
    expect(read("ข้าวเช้า16 น้ำ14 กาแฟ30")).toEqual([
      ["ข้าวเช้า", 16, "expense"],
      ["น้ำ", 14, "expense"],
      ["กาแฟ", 30, "expense"],
    ]);
    expect(read("ข้าวเช้า 16 น้ำ 14 กาแฟ 30")).toHaveLength(3);
  });

  it("each knows whether it is money in or out", () => {
    expect(read("ได้เงินเดือน 30000 จ่ายค่าห้อง 5000")).toEqual([
      ["ได้เงินเดือน", 30000, "income"],
      ["จ่ายค่าห้อง", 5000, "expense"],
    ]);
  });

  it("a day said first is the day of them all", () => {
    const entries = parseMessage("เมื่อวาน ข้าว 50 กาแฟ 30", now).entries;
    expect(entries.map((e) => e.title)).toEqual(["ข้าว", "กาแฟ"]);
    expect(entries.every((e) => e.backdated)).toBe(true);
  });

  it("a count with its unit stays one entry", () => {
    expect(read("ข้าวมันไก่ 2 จาน 100")).toEqual([["ข้าวมันไก่ 2 จาน", 100, "expense"]]);
    expect(read("กาแฟ 2 แก้ว 90")).toEqual([["กาแฟ 2 แก้ว", 90, "expense"]]);
    expect(read("7-11 50")).toEqual([["7-11", 50, "expense"]]);
    expect(read("ค่าไฟ 1200")).toEqual([["ค่าไฟ", 1200, "expense"]]);
  });
});

describe("one entry with numbers in its name is not split", () => {
  const now = new Date("2026-11-04T03:00:00Z");
  const count = (s: string) => parseMessage(s, now, { currencies: true }).entries.length;
  it.each([
    "ทีวี 55 นิ้ว 15900",
    "แอร์ 12000 BTU 15000",
    "ซื้อ iPhone 15 Pro 39900",
    "ค่าเน็ต 5G 599",
    "ค่าเน็ต 100Mbps 590",
    "Honda Click 125 เติมน้ำมัน 100",
    "ห้อง 1205 ค่าน้ำ 150",
    "ห้อง 305 ค่าเช่า 4500",
    "คอนโด ชั้น 8 ค่าส่วนกลาง 1200",
    "ซอย 7 ข้าว 50",
    "ร้านป้า 7 แยก 50",
    "ถนน 3 ร้าน หมูกระทะ 400",
    "ม.4 ค่าหนังสือ 500",
    "ป.6 ค่าเทอม 8000",
    "ทะเบียน กข 1234 เติมน้ำมัน 500",
    "ไข่ 30 ฟอง 120",
    "ยาง 4 เส้น 8000",
    "ซื้อของ 3 อย่าง 500",
    "กาแฟ 50 x2",
    "ข้าว 60 จ่ายไป 100 ทอน 40",
    "โอนให้แม่ 5000 เหลือ 2000",
    "เสื้อ 500 ลด 100",
    "แท็กซี่ 8.30 น. 120",
    "ค่ารถ 8.30 แท็กซี่ 120",
  ])("%s", (s) => expect(count(s)).toBe(1));

  it("a day said by number is the day, not an entry", () => {
    const entries = parseMessage("วันที่ 3 ข้าว 50 กาแฟ 30", now).entries;
    expect(entries.some((e) => e.amountSatang === 300)).toBe(false);
  });

  it("a piece the rules cannot read keeps the whole message unread, never half saved", () => {
    const long =
      "ค่าข้าวเที่ยงกับเพื่อนที่ทำงานร้านอาหารญี่ปุ่นแถวสยามสแควร์ซอยสามตรงข้ามสยามพารากอน 500 น้ำ 20";
    const result = parseMessage(long, now);
    expect(result.entries.map((e) => e.amountSatang)).not.toEqual([2000]);
  });

  it("a foreign amount keeps its currency", () => {
    const entries = parseMessage("ราเมง 1500 JPY รถไฟ 300", now, { currencies: true }).entries;
    expect(entries[0]?.foreign?.currency).toBe("JPY");
  });

  it("a day said in the middle is only for what follows it", () => {
    const entries = parseMessage("ข้าว 50 เมื่อวาน กาแฟ 30", now).entries;
    expect(entries.map((e) => [e.title, e.backdated])).toEqual([
      ["ข้าว", false],
      ["กาแฟ", true],
    ]);
  });

  it("joining words are not part of the name", () => {
    expect(parseMessage("ข้าว 50 กับ กาแฟ 30", now).entries.map((e) => e.title)).toEqual([
      "ข้าว",
      "กาแฟ",
    ]);
  });

  it("names that only start like a unit are names", () => {
    expect(parseMessage("กาแฟ 50 ตรวจสุขภาพ 1500", now).entries).toHaveLength(2);
    expect(parseMessage("ข้าว 60 วันเกิดแม่ 500", now).entries).toHaveLength(2);
    expect(parseMessage("ทีวี 55นิ้ว 15900", now).entries).toHaveLength(1);
  });

  it("an English run splits too", () => {
    expect(parseMessage("coffee 30 taxi 120", now).entries).toHaveLength(2);
  });
});

describe("parseMessage: numbers added with +", () => {
  const read = (text: string) =>
    parseMessage(text, NOW).entries.map((e) => [e.title, e.amountSatang / 100]);

  it.each([
    [
      "ข้าว35+55น้ำ8กาแฟ30",
      [
        ["ข้าว", 90],
        ["น้ำ", 8],
        ["กาแฟ", 30],
      ],
    ],
    ["ข้าว 35+55", [["ข้าว", 90]]],
    [
      "ข้าว 35 + 55 น้ำ 8",
      [
        ["ข้าว", 90],
        ["น้ำ", 8],
      ],
    ],
    ["ค่ารถ 20+20+15", [["ค่ารถ", 55]]],
    ["ของใช้ 1,200+50.50", [["ของใช้", 1250.5]]],
    ["ขนม ๑๐+๕", [["ขนม", 15]]],
    ["ค่าเช่า 1,234,000+5,000", [["ค่าเช่า", 1_239_000]]],
    ["ค่าโทร 12345678+5", [["ค่าโทร 12345678", 5]]],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each([
    ["ชานม 1+1 45", [["ชานม 1+1", 45]]],
    ["โปร 2+1 สบู่ 99", [["โปร 2+1 สบู่", 99]]],
  ])("a promotion (%s) is not added up", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each([
    // a + starting a line or after a comma is income, as before
    [
      "กาแฟ 50\n+500 ขายของ",
      [
        ["กาแฟ", 50],
        ["ขายของ", 500],
      ],
    ],
    [
      "ข้าว 50, +100 ขายของ",
      [
        ["ข้าว", 50],
        ["ขายของ", 100],
      ],
    ],
    ["ขาย 100 +200", [["ขาย 100", 200]]],
    // a multiplier belongs to its own number
    ["เงินเดือน 15000+5k", [["เงินเดือน 15000", 5000]]],
    // a model name, a phone number, a clock time
    ["ซื้อ S24+ 30000", [["ซื้อ S24", 30000]]],
    ["ค่าโทรศัพท์ 0812345678+50", [["ค่าโทรศัพท์ 0812345678", 50]]],
    ["08:00+50 กาแฟ", [["08:00 กาแฟ", 50]]],
    // promotions and counts
    ["โปร 4+1 น้ำ 100", [["โปร 4+1 น้ำ", 100]]],
    ["เบียร์ 10+1 ลัง 650", [["เบียร์ 10+1 ลัง", 650]]],
  ])("leaves %j as it was", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it("a + in front of an amount is still income", () => {
    expect(one("+500 ขายของ")).toMatchObject({ type: "income", amountSatang: 50_000 });
  });
});

describe("parseMessage: numbers multiplied with x", () => {
  const read = (text: string) =>
    parseMessage(text, NOW).entries.map((e) => [e.title, e.amountSatang / 100]);

  it.each([
    ["น้ำ 10x3", [["น้ำ", 30]]],
    ["กาแฟ 2*45", [["กาแฟ", 90]]],
    ["ขนม 15 X 4", [["ขนม", 60]]],
    ["ไข่ 4.5×10", [["ไข่", 45]]],
    [
      "ข้าว 35x2+20 น้ำ 8",
      [
        ["ข้าว", 90],
        ["น้ำ", 8],
      ],
    ],
    [
      "ข้าว35x2น้ำ8x3",
      [
        ["ข้าว", 70],
        ["น้ำ", 24],
      ],
    ],
    ["ขนม ๑๕x๒", [["ขนม", 30]]],
    [
      "ส้ม 2x35 แตงโม 1x50 องุ่น 3x80",
      [
        ["ส้ม", 70],
        ["แตงโม", 50],
        ["องุ่น", 240],
      ],
    ],
    [
      "ข้าว 50x2 ค่าส่ง 30",
      [
        ["ข้าว", 100],
        ["ค่าส่ง", 30],
      ],
    ],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it.each([
    ["จอ 1920x1080 5000", [["จอ 1920x1080", 5000]]],
    ["ไม้ 2x4 ราคา 300", [["ไม้ 2x4 ราคา", 300]]],
    ["iPhone X 30000", [["iPhone X", 30000]]],
    ["ยา 2x3 เม็ด 50", [["ยา 2x3 เม็ด", 50]]],
  ])("leaves %j as it was", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});

// a size, a model, an installment, a comma list, a phone number, a product too large to be one
// buy: not multiplied, read as before multiplication existed
describe("parseMessage: x that is not a count and a price", () => {
  it.each([
    [
      "ข้าว 3x50,20",
      [
        ["ข้าว 3x", 50],
        ["รายการ", 20],
      ],
    ],
    [
      "ข้าว 3x1,5 น้ำ 20",
      [
        ["ข้าว 3x", 1],
        ["5 น้ำ", 20],
      ],
    ],
    ["ทีวี 55x 15000", [["ทีวี 55x", 15000]]],
    ["iphone 15x 30000", [["iphone 15x", 30000]]],
    ["จอ 27x 5000", [["จอ 27x", 5000]]],
    ["จ่าย 500x12 งวด", [["จ่าย 500x งวด", 12]]],
    ["ผ่อน 12x500", [["ผ่อน 12x", 500]]],
    ["ข้าว 999x1000", [["ข้าว 999x", 1000]]],
    ["ผ้า 100x200 300", [["ผ้า 100x200", 300]]],
    ["ห้อง 4x5 500", [["ห้อง 4x5", 500]]],
    ["ไม้ 6x8 120", [["ไม้ 6x8", 120]]],
    ["รูป 60x90 250", [["รูป 60x90", 250]]],
    ["โต๊ะ 120x60 ซม 2500", [["โต๊ะ 120x60 ซม", 2500]]],
    ["ผ้า 100x200cm 300", [["ผ้า 100x200cm", 300]]],
    ["สาย 5x10m 200", [["สาย 5x10m", 200]]],
    ["เบียร์ 6x330ml 300", [["เบียร์ 6x330ml", 300]]],
    ["ผ้าห่ม 5x6ฟุต 900", [["ผ้าห่ม 5x6ฟุต", 900]]],
    ["ร้าน 7x7 100", [["ร้าน 7x7", 100]]],
    ["รองเท้า size 42x2 1500", [["รองเท้า size 42x2", 1500]]],
    ["กระเบื้อง 30x30 50 แผ่น 2000", [["กระเบื้อง 30x30 50 แผ่น", 2000]]],
    ["หมูกระทะ 299x4 +100", [["หมูกระทะ 299x4", 100]]],
    ["ข้าว 50x2=100", [["ข้าว 50x2=", 100]]],
    ["ข้าว 50x2 100", [["ข้าว 50x2", 100]]],
    ["เบอร์ 081x234 50", [["เบอร์ 081x234", 50]]],
    ["ข้าว 20x5x2", [["ข้าว 20x5x", 2]]],
    ["ข้าว 50x2 ราคา 100", [["ข้าว 50x2 ราคา", 100]]],
    ["ข้าว 50x2 หาร 2", [["ข้าว 50x2 หาร", 2]]],
    ["ข้าว 50x2 ร้าน 7", [["ข้าว 50x2 ร้าน", 7]]],
    ["เสื้อ 2x350 ลด 100", [["เสื้อ 2x350 ลด", 100]]],
    ["ข้าว 50x2 ส่วนลด 20", [["ข้าว 50x2 ส่วนลด", 20]]],
    ["ข้าว 50x2 รวม 100", [["ข้าว 50x2 รวม", 100]]],
    ["ข้าว 50x2 จ่ายไป 100", [["ข้าว 50x2 จ่ายไป", 100]]],
    ["ข้าว 50x2 เหลือ 20", [["ข้าว 50x2 เหลือ", 20]]],
    ["บุฟเฟ่ต์ 399x3 vat 7%", [["บุฟเฟ่ต์ 399x3 vat %", 7]]],
    ["ข้าว 50x2 วันที่ 3 พ.ย.", [["ข้าว 50x2 วันที่ พ.ย", 3]]],
    ["ข้าว 50x2 โต๊ะ 5", [["ข้าว 50x2 โต๊ะ", 5]]],
    ["ห้อง 301 x2 คืน 1600", [["ห้อง 301 x2 คืน", 1600]]],
    ["ข้าว 50x2-10", [["ข้าว 50x2", 10]]],
    ["หวย 45x50", [["หวย 45x", 50]]],
    ["หวย 123x10 456x20", [["หวย 123x10 456x", 20]]],
    ["ข้าว (50x2)", [["ข้าว (50x )", 2]]],
  ] as [string, [string, number][]][])("%s", (text, expected) => {
    expect(parseMessage(text, NOW).entries.map((e) => [e.title, e.amountSatang / 100])).toEqual(
      expected,
    );
  });
});
