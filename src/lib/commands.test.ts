import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";

describe("parseCommand", () => {
  it.each([
    ["ช่วยเหลือ", { kind: "help" }],
    ["Help", { kind: "help" }],
    ["สรุปวันนี้", { kind: "summary", scope: "today" }],
    ["สรุปเดือนนี้", { kind: "summary", scope: "month" }],
    ["ลบล่าสุด", { kind: "delete-latest" }],
    ["แก้ล่าสุด 45", { kind: "edit-latest", amountSatang: 4500 }],
    ["แก้ล่าสุด ๔๕.๕๐ บาท", { kind: "edit-latest", amountSatang: 4550 }],
    ["แก้ล่าสุด 1,200", { kind: "edit-latest", amountSatang: 120_000 }],
    ["แก้ล่าสุด 2k", { kind: "edit-latest", amountSatang: 200_000 }],
    ["แก้ล่าสุด", { kind: "edit-latest-usage" }],
    ["แก้ไขเสร็จแล้ว", { kind: "edit-done" }],
    ["แก้ล่าสุด abc", { kind: "edit-latest-usage" }],
    ["แก้ล่าสุด 0", { kind: "edit-latest-usage" }],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it.each([
    ["เหรียญสะสม", { kind: "points" }],
    ["เหรียญ", { kind: "points" }],
    ["ตังสะสม", { kind: "points" }],
    ["แต้ม", { kind: "points" }],
    ["รหัสชวน", { kind: "my-code" }],
    ["ใช้รหัส ABCD1234", { kind: "use-code", code: "ABCD1234" }],
    ["ใช้รหัส   abcd1234", { kind: "use-code", code: "ABCD1234" }],
    ["ใช้รหัส", { kind: "use-code-usage" }],
    ["ใช้รหัส ก", { kind: "use-code-usage" }],
    ["ใช้รหัส AB", { kind: "use-code-usage" }],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("where to be paid (PromptPay / bank), set in the private chat", () => {
    expect(parseCommand("พร้อมเพย์")).toEqual({ kind: "payment-show" });
    expect(parseCommand("พร้อมเพย์ 0812345678")).toEqual({
      kind: "payment-promptpay",
      id: "0812345678",
    });
    expect(parseCommand("พร้อมเพย์ 081-234-5678")).toEqual({
      kind: "payment-promptpay",
      id: "0812345678",
    });
    expect(parseCommand("พร้อมเพย์ ๐๘๑๒๓๔๕๖๗๘")).toEqual({
      kind: "payment-promptpay",
      id: "0812345678",
    });
    expect(parseCommand("พร้อมเพย์ 12345")).toEqual({ kind: "payment-usage" });
    expect(parseCommand("พร้อมเพย์ ลบ")).toEqual({ kind: "payment-clear", what: "promptpay" });
    expect(parseCommand("บัญชี กสิกร 123-4-56789-0 สมชาย ใจดี")).toEqual({
      kind: "payment-bank",
      bank: "กสิกร",
      account: "123-4-56789-0",
      name: "สมชาย ใจดี",
    });
    expect(parseCommand("บัญชี ไทยพาณิชย์ 1234567890")).toEqual({
      kind: "payment-bank",
      bank: "ไทยพาณิชย์",
      account: "1234567890",
      name: null,
    });
    expect(parseCommand("บัญชี กสิกร")).toEqual({ kind: "payment-usage" });
    expect(parseCommand("บัญชี กสิกร 12")).toEqual({ kind: "payment-usage" });
    expect(parseCommand("บัญชี ลบ")).toEqual({ kind: "payment-clear", what: "bank" });
  });

  it("วิธีใช้งาน is the help word", () => {
    expect(parseCommand("วิธีใช้งาน")).toEqual({ kind: "help" });
  });

  it("returns null for transactions", () => {
    expect(parseCommand("กาแฟ 30")).toBeNull();
    expect(parseCommand("สรุปวันนี้ 30")).toBeNull();
  });
});

describe("parseCommand: summary of a custom range", () => {
  const range = (
    start: [number, number, number | null],
    end: [number, number, number | null] | "today",
  ) => ({
    kind: "summary-range",
    start: { day: start[0], month: start[1], year: start[2] },
    end: end === "today" ? "today" : { day: end[0], month: end[1], year: end[2] },
  });

  it.each([
    ["สรุป 1/10 ถึง 15/10", range([1, 10, null], [15, 10, null])],
    ["สรุป 25/9 - 24/10", range([25, 9, null], [24, 10, null])],
    ["สรุป 25/9-24/10", range([25, 9, null], [24, 10, null])],
    ["สรุป 25/9 – 24/10", range([25, 9, null], [24, 10, null])],
    ["สรุป 1/10 ไป 15/10", range([1, 10, null], [15, 10, null])],
    ["สรุปวันที่ 1/10 ถึงวันที่ 15/10", range([1, 10, null], [15, 10, null])],
    ["สรุป 1/1/2569 ถึง 31/1/2569", range([1, 1, 2569], [31, 1, 2569])],
    ["สรุป 1/10 ถึง วันนี้", range([1, 10, null], "today")],
    ["สรุป ๑/๑๐ ถึง ๑๕/๑๐", range([1, 10, null], [15, 10, null])],
    ["  สรุป   1/10   ถึง   15/10  ", range([1, 10, null], [15, 10, null])],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("a date without the other end shows how to write a range", () => {
    expect(parseCommand("สรุป 1/10")).toEqual({ kind: "summary-range-usage" });
    expect(parseCommand("สรุป 1/10 ถึง")).toEqual({ kind: "summary-range-usage" });
  });

  it("leaves the plain summaries and ordinary entries alone", () => {
    expect(parseCommand("สรุปวันนี้")).toEqual({ kind: "summary", scope: "today" });
    expect(parseCommand("สรุปเดือนนี้")).toEqual({ kind: "summary", scope: "month" });
    expect(parseCommand("สรุปค่าไฟ 500")).toBeNull();
    expect(parseCommand("12/10 ค่าไฟ 1200")).toBeNull();
  });
});

describe("parseCommand: search", () => {
  it.each([
    ["ค้นหา กาแฟ", { kind: "search", term: "กาแฟ" }],
    ["ค้นหา #ปาร์ตี้", { kind: "search", term: "#ปาร์ตี้" }],
    ["ค้นหา   ชานม   ไข่มุก ", { kind: "search", term: "ชานม ไข่มุก" }],
    ["ค้นหา Grab", { kind: "search", term: "Grab" }], // keeps the case it was typed in
    ["ค้นหา", { kind: "search-usage" }],
    ["ค้นหา   ", { kind: "search-usage" }],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("an entry that merely starts with the word is not a search", () => {
    expect(parseCommand("ค้นหาของ 50")).toBeNull();
  });
});

describe("parseCommand: latest entries and spend by category", () => {
  it.each([
    ["ล่าสุด", { kind: "recent" }],
    ["รายการล่าสุด", { kind: "recent" }],
    ["5 รายการล่าสุด", { kind: "recent" }],
    ["๕ รายการล่าสุด", { kind: "recent" }],
    ["สรุปหมวด", { kind: "category-spend" }],
    ["สรุปตามหมวด", { kind: "category-spend" }],
    ["สรุปหมวดหมู่", { kind: "category-spend" }],
    ["  สรุป  หมวด ", null],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("does not take over the neighbouring commands or entries", () => {
    expect(parseCommand("ลบล่าสุด")).toEqual({ kind: "delete-latest" });
    expect(parseCommand("แก้ล่าสุด 45")).toEqual({ kind: "edit-latest", amountSatang: 4500 });
    expect(parseCommand("ล่าสุด 50")).toBeNull();
    expect(parseCommand("สรุปเดือนนี้")).toEqual({ kind: "summary", scope: "month" });
  });
});

describe("parseCommand: yearly summary and month comparison", () => {
  it.each([
    ["สรุปปี", { kind: "year-summary", year: null }],
    ["สรุปรายปี", { kind: "year-summary", year: null }],
    ["สรุปปีนี้", { kind: "year-summary", year: null }],
    ["สรุปปีที่แล้ว", { kind: "year-summary", year: "last" }],
    ["สรุปปีก่อน", { kind: "year-summary", year: "last" }],
    ["สรุปปี 2568", { kind: "year-summary", year: 2568 }],
    ["สรุปปี 2025", { kind: "year-summary", year: 2025 }],
    ["สรุปรายปี ๒๕๖๙", { kind: "year-summary", year: 2569 }],
    ["เทียบเดือน", { kind: "compare-months" }],
    ["เทียบเดือนก่อน", { kind: "compare-months" }],
    ["เปรียบเทียบเดือน", { kind: "compare-months" }],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("is not confused with the other summaries or with entries", () => {
    expect(parseCommand("สรุปปี 25")).toBeNull();
    expect(parseCommand("สรุปปีใหม่ 500")).toBeNull();
    expect(parseCommand("เทียบเดือน 500")).toBeNull();
    expect(parseCommand("สรุปเดือนนี้")).toEqual({ kind: "summary", scope: "month" });
  });
});

describe("parseCommand: forecast", () => {
  it.each(["พยากรณ์", "พยากรณ์เงิน", "พยากรณ์ปลายเดือน", "พยากรณ์ปลายรอบ", "  พยากรณ์  "])(
    "%s",
    (input) => {
      expect(parseCommand(input)).toEqual({ kind: "forecast" });
    },
  );

  it("an entry that merely mentions the word is not the command", () => {
    expect(parseCommand("พยากรณ์อากาศ 50")).toBeNull();
  });
});

describe("parseCommand: insight", () => {
  it.each(["วิเคราะห์", "วิเคราะห์การใช้จ่าย", "AI Insight", "insight", "  วิเคราะห์  "])(
    "%s",
    (input) => {
      expect(parseCommand(input)).toEqual({ kind: "insight" });
    },
  );

  it("is not taken for an entry that merely starts with the word", () => {
    expect(parseCommand("วิเคราะห์ตลาด 500")).toBeNull();
  });
});

describe("parseCommand: wallets", () => {
  it.each(["กระเป๋า", "กระเป๋าเงิน", "ยอดเงิน", "Wallet", "  wallets  "])("%s", (input) => {
    expect(parseCommand(input)).toEqual({ kind: "wallets" });
  });

  it("is not taken for an entry that merely starts with the word", () => {
    expect(parseCommand("กระเป๋า 500")).toBeNull();
  });
});

describe("parseCommand: cards", () => {
  it.each(["บัตร", "บัตรเครดิต", "  บัตร  "])("%s", (input) => {
    expect(parseCommand(input)).toEqual({ kind: "cards", name: null });
  });

  it("with a card name", () => {
    expect(parseCommand("บัตร KTC")).toEqual({ kind: "cards", name: "ktc" });
  });

  it("an entry that starts with the word is not a command", () => {
    expect(parseCommand("บัตร 500")).toBeNull();
    expect(parseCommand("บัตรจอดรถ 50")).toBeNull();
  });
});

describe("parseCommand: daily budget", () => {
  it("shows, sets and clears", () => {
    expect(parseCommand("งบวัน")).toEqual({ kind: "daily-budget", action: "show" });
    expect(parseCommand("งบรายวัน")).toEqual({ kind: "daily-budget", action: "show" });
    expect(parseCommand("งบวัน 500")).toEqual({
      kind: "daily-budget",
      action: "set",
      amountSatang: 50000,
    });
    expect(parseCommand("งบวัน 1,200.50 บาท")).toEqual({
      kind: "daily-budget",
      action: "set",
      amountSatang: 120050,
    });
    expect(parseCommand("งบวัน ๕๐๐")).toEqual({
      kind: "daily-budget",
      action: "set",
      amountSatang: 50000,
    });
    expect(parseCommand("งบวัน ปิด")).toEqual({ kind: "daily-budget", action: "clear" });
    expect(parseCommand("งบวัน off")).toEqual({ kind: "daily-budget", action: "clear" });
  });

  it("anything else after it is the usage hint", () => {
    expect(parseCommand("งบวัน abc")).toEqual({ kind: "daily-budget", action: "usage" });
    expect(parseCommand("งบวัน 0")).toEqual({ kind: "daily-budget", action: "usage" });
  });

  it("an entry that merely starts with it is not a command", () => {
    expect(parseCommand("งบวันเกิดแม่ 500")).toBeNull();
  });
});

describe("note commands", () => {
  it.each([
    ["โน้ต ซื้อนม รหัสไวไฟ 1234", { kind: "note-add", body: "ซื้อนม รหัสไวไฟ 1234" }],
    ["โน๊ต ไอเดียแอป", { kind: "note-add", body: "ไอเดียแอป" }],
    ["  โน้ต   ซื้อนม  \nไข่ ", { kind: "note-add", body: "ซื้อนม  \nไข่" }],
    ["โน้ต", { kind: "note-list" }],
    ["ค้นหาโน้ต ไวไฟ", { kind: "note-search", term: "ไวไฟ" }],
    ["ค้นหา โน้ต ไวไฟ", { kind: "note-search", term: "ไวไฟ" }],
    ["โน้ต ค้นหา ไวไฟ", { kind: "note-search", term: "ไวไฟ" }],
    ["ค้นหาโน้ต", { kind: "note-search", term: null }],
  ])("%j", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("the word must stand alone: a notebook is still an entry, and entry search is untouched", () => {
    expect(parseCommand("โน้ตบุ๊ก 25000")).toBeNull();
    expect(parseCommand("โน๊ตบุ๊ค 25000")).toBeNull();
    expect(parseCommand("ค้นหา กาแฟ")).toEqual({ kind: "search", term: "กาแฟ" });
  });
});

describe("reminder commands", () => {
  it.each([
    ["เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ", { kind: "remind-add", text: "พรุ่งนี้ 9 โมง จ่ายค่าไฟ" }],
    ["เตือนฉัน พรุ่งนี้ 9 โมง จ่ายค่าไฟ", { kind: "remind-add", text: "พรุ่งนี้ 9 โมง จ่ายค่าไฟ" }],
    ["เตือนให้ จ่ายค่าไฟ พรุ่งนี้", { kind: "remind-add", text: "จ่ายค่าไฟ พรุ่งนี้" }],
    ["เตือนผม ให้ ซื้อนม ทุกวัน", { kind: "remind-add", text: "ซื้อนม ทุกวัน" }],
    ["เตือน", { kind: "remind-list" }],
    ["เตือนฉัน", { kind: "remind-list" }],
    ["รายการเตือน", { kind: "remind-list" }],
    ["เตือนทั้งหมด", { kind: "remind-list" }],
  ])("%j", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("the word must stand alone: เตือนใจ 100 is still an entry", () => {
    expect(parseCommand("เตือนใจ 100")).toBeNull();
    expect(parseCommand("เตือนภัย 50")).toBeNull();
  });
});

describe("พี่ฮูก commands", () => {
  it.each([
    ["ถามพี่ฮูก", { kind: "owl-start" }],
    ["ฮูก", { kind: "owl-start" }],
    ["พี่ฮูก", { kind: "owl-start" }],
    ["ฮูก เดือนนี้ใช้ไปเท่าไร", { kind: "owl-ask", question: "เดือนนี้ใช้ไปเท่าไร" }],
    ["ถามพี่ฮูก หมวดไหนเยอะสุด", { kind: "owl-ask", question: "หมวดไหนเยอะสุด" }],
    ["ถามฮูก ในโน้ตมีอะไร\nบ้าง", { kind: "owl-ask", question: "ในโน้ตมีอะไร\nบ้าง" }],
    ["จบ", { kind: "owl-end" }],
    ["จบการถาม", { kind: "owl-end" }],
    ["เลิกถาม", { kind: "owl-end" }],
    ["พอแล้ว", { kind: "owl-end" }],
  ])("%j", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("the name must stand alone", () => {
    expect(parseCommand("ฮูกกี้ 50")).toBeNull();
    expect(parseCommand("จบงาน 500")).toBeNull();
  });
});

describe("commands that open the pages that left the Rich Menu", () => {
  it.each([
    ["หน้ารายการ", "transactions"],
    ["รายการทั้งหมด", "transactions"],
    ["ประวัติ", "transactions"],
    ["งบ", "budgets"],
    ["หน้างบ", "budgets"],
    ["หมวด/งบ", "budgets"],
    ["กราฟ", "analytics"],
    ["หน้าวิเคราะห์", "analytics"],
    ["หน้าสรุป", "summary"],
    ["เปิดหน้าสรุป", "summary"],
  ])("%s", (input, page) => {
    expect(parseCommand(input)).toEqual({ kind: "open-page", page });
  });

  it("do not take over the commands and entries that start the same way", () => {
    expect(parseCommand("วิเคราะห์")).toEqual({ kind: "insight" });
    expect(parseCommand("สรุปเดือนนี้")).toEqual({ kind: "summary", scope: "month" });
    expect(parseCommand("งบวัน 500")).toEqual({
      kind: "daily-budget",
      action: "set",
      amountSatang: 50_000,
    });
    expect(parseCommand("งบ 500")).toBeNull();
  });
});

describe("summary: the menu, the ready-made ones and the many ways to name a range", () => {
  it("สรุป alone asks which summary", () => {
    expect(parseCommand("สรุป")).toEqual({ kind: "summary-menu" });
    expect(parseCommand("  สรุป  ")).toEqual({ kind: "summary-menu" });
  });

  it.each([
    ["สรุปเมื่อวาน", "yesterday"],
    ["สรุปสัปดาห์นี้", "this-week"],
    ["สรุปอาทิตย์นี้", "this-week"],
    ["สรุปสัปดาห์ที่แล้ว", "last-week"],
    ["สรุปสัปดาห์ก่อน", "last-week"],
    ["สรุปเดือนที่แล้ว", "last-month"],
    ["สรุปเดือนก่อน", "last-month"],
  ])("%s", (input, preset) => {
    expect(parseCommand(input)).toEqual({ kind: "summary-preset", preset });
  });

  it("the date picker has its own command", () => {
    for (const t of ["สรุปช่วง", "สรุปช่วงวันที่", "เลือกช่วงวันที่"]) {
      expect(parseCommand(t)).toEqual({ kind: "summary-range-pick" });
    }
  });

  const range = (
    a: [number, number, number | null],
    b: [number, number, number | null] | "today",
  ) => ({
    kind: "summary-range",
    start: { day: a[0], month: a[1], year: a[2] },
    end: b === "today" ? "today" : { day: b[0], month: b[1], year: b[2] },
  });

  it.each([
    ["สรุป 20oct-30oct", range([20, 10, null], [30, 10, null])],
    ["สรุป20oct-30oct", range([20, 10, null], [30, 10, null])],
    ["สรุป 20/10-30/10", range([20, 10, null], [30, 10, null])],
    ["สรุป 20 ต.ค. - 30 ต.ค.", range([20, 10, null], [30, 10, null])],
    ["สรุป 20 ตุลาคม ถึง 30 ตุลาคม", range([20, 10, null], [30, 10, null])],
    ["สรุป 1-15 ต.ค.", range([1, 10, null], [15, 10, null])],
    ["สรุป 20.10-30.10", range([20, 10, null], [30, 10, null])],
    ["สรุป 2026-10-20 to 2026-10-30", range([20, 10, 2026], [30, 10, 2026])],
    ["สรุป ตั้งแต่ 20/10 ถึงวันนี้", range([20, 10, null], "today")],
    ["สรุป ตั้งแต่ 20 oct", range([20, 10, null], "today")],
    ["สรุปช่วง 20/10-30/10", range([20, 10, null], [30, 10, null])],
    ["summary 20oct-30oct", range([20, 10, null], [30, 10, null])],
    ["สรุป oct 20 - oct 30", range([20, 10, null], [30, 10, null])],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("a date that is not a whole range gets the help text, other words are left alone", () => {
    expect(parseCommand("สรุป 20oct")).toEqual({ kind: "summary-range-usage" });
    expect(parseCommand("สรุป 20/10 ถึง")).toEqual({ kind: "summary-range-usage" });
    expect(parseCommand("สรุปอะไรดี")).toBeNull();
    expect(parseCommand("สรุปวันนี้ 30")).toBeNull();
  });
});

describe("kept files", () => {
  it.each([
    ["เก็บไฟล์", { kind: "file-save", name: null }],
    ["เก็บไว้", { kind: "file-save", name: null }],
    ["เก็บไว้ให้หน่อย", { kind: "file-save", name: null }],
    ["เก็บไฟล์ สัญญาเช่า", { kind: "file-save", name: "สัญญาเช่า" }],
    ["หาไฟล์ สัญญา", { kind: "file-search", term: "สัญญา" }],
    ["ไฟล์ของฉัน", { kind: "file-list" }],
    ["คลัง", { kind: "file-list" }],
    ["ชื่อไฟล์ รูปบัตร", { kind: "file-rename", name: "รูปบัตร" }],
  ])("reads %s", (input, command) => {
    expect(parseCommand(input)).toEqual(command);
  });

  it("an entry that starts the same way stays an entry", () => {
    expect(parseCommand("ไฟล์ 500")).toBeNull();
    expect(parseCommand("เก็บไว้กินเย็น 80")).toBeNull();
  });
});
