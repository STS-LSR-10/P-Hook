import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";
import { numberCountsThings, needsRouter } from "./ai/route-text";
import { parseMessage } from "./parse/text-parser";
import { parseNaturalCommand } from "./rule-intents";

const NOW = new Date("2026-11-12T05:00:00Z");
const nat = (t: string) => parseNaturalCommand(t, NOW);

describe("the usual ways of saying a command, read by rules", () => {
  it("deleting the last entry", () => {
    for (const t of ["ลบอันล่าสุด", "ยกเลิกรายการล่าสุด", "ลบรายการสุดท้าย", "ลบอันล่าสุดค่ะ"]) {
      expect(nat(t), t).toEqual({ kind: "delete-latest" });
    }
  });

  it("a summary of a period, asked as a question or by name", () => {
    expect(nat("เดือนนี้ใช้ไปเท่าไหร่")).toEqual({ kind: "summary", scope: "month" });
    expect(nat("วันนี้ใช้ไปเท่าไร")).toEqual({ kind: "summary", scope: "today" });
    expect(nat("วันนี้ ใช้ไปกี่บาทแล้ว")).toEqual({ kind: "summary", scope: "today" });
    expect(nat("สัปดาห์นี้ใช้ไปเท่าไหร่")).toEqual({ kind: "summary-preset", preset: "this-week" });
    expect(nat("เมื่อวานจ่ายไปเท่าไหร่")).toEqual({ kind: "summary-preset", preset: "yesterday" });
    expect(nat("เดือนที่แล้วใช้ไปเท่าไหร่")).toEqual({
      kind: "summary-preset",
      preset: "last-month",
    });
    expect(nat("ยอดเดือนนี้")).toEqual({ kind: "summary", scope: "month" });
    expect(nat("ขอดูยอดวันนี้")).toEqual({ kind: "summary", scope: "today" });
    expect(nat("ดูสรุป")).toEqual({ kind: "summary-menu" });
    expect(nat("ขอดูรายการล่าสุด")).toEqual({ kind: "recent" });
  });

  it("notes", () => {
    expect(nat("จดโน้ต รหัสห้อง 304")).toEqual({ kind: "note-add", body: "รหัสห้อง 304" });
    expect(nat("จำไว้ว่า แม่ชอบทุเรียน")).toEqual({ kind: "note-add", body: "แม่ชอบทุเรียน" });
  });

  it("a reminder only when its time is understood, otherwise it is left to the AI", () => {
    expect(nat("เตือนจ่ายค่าไฟ พรุ่งนี้ 9 โมง")).toEqual({
      kind: "remind-add",
      text: "จ่ายค่าไฟ พรุ่งนี้ 9 โมง",
    });
    expect(nat("อย่าลืมโทรหาแม่ พรุ่งนี้")?.kind).toBe("remind-add");
    expect(nat("อย่าลืมโทรหาแม่")).toBeNull();
    expect(nat("เตือนใจ 100")).toBeNull();
  });

  it("looking everywhere for a word, but not for a number or a question", () => {
    expect(nat("หา ใบเสร็จ ค่าไฟ")).toEqual({ kind: "find", term: "ใบเสร็จ ค่าไฟ", in: "any" });
    expect(nat("หา 500")).toBeNull();
    expect(nat("หา อะไรกินดีไหม")).toBeNull();
    expect(nat("หาหมอ 500")).toBeNull();
  });

  it("greetings, thanks and help are fixed answers", () => {
    for (const t of ["สวัสดี", "สวัสดีครับ", "หวัดดีค่ะ", "hello"]) {
      expect(nat(t), t).toEqual({ kind: "chitchat", say: "hello" });
    }
    for (const t of ["ขอบคุณ", "ขอบคุณค่ะ", "ขอบคุณมากครับ", "thanks"]) {
      expect(nat(t), t).toEqual({ kind: "chitchat", say: "thanks" });
    }
    expect(nat("ช่วยด้วย")).toEqual({ kind: "help" });
    expect(nat("ทำอะไรได้บ้าง")).toEqual({ kind: "help" });
  });

  it("a budget said in the chat becomes a budget to confirm, never an expense", () => {
    expect(nat("งบอาหาร 3000")).toEqual({
      kind: "budget-set",
      name: "อาหาร",
      amountSatang: 300000,
    });
    expect(nat("ตั้งงบอาหาร 3000")).toEqual({
      kind: "budget-set",
      name: "อาหาร",
      amountSatang: 300000,
    });
    expect(nat("งบกินเที่ยว 120 บาท")).toEqual({
      kind: "budget-set",
      name: "กินเที่ยว",
      amountSatang: 12000,
    });
    expect(nat("แก้งบ ค่ากาแฟ 1,500")).toEqual({
      kind: "budget-set",
      name: "ค่ากาแฟ",
      amountSatang: 150000,
    });
    expect(nat("ตั้งงบ 5000 ค่ะ")).toEqual({
      kind: "budget-set",
      name: null,
      amountSatang: 500000,
    });
    expect(nat("งบ 20000")).toEqual({ kind: "budget-set", name: null, amountSatang: 2000000 });
    expect(nat("งบรวม 20k")).toEqual({ kind: "budget-set", name: null, amountSatang: 2000000 });
    expect(nat("งบ ๓๐๐๐")).toEqual({ kind: "budget-set", name: null, amountSatang: 300000 });
  });

  it("a daily budget goes to its own command, and period words are not category names", () => {
    for (const t of ["งบวันละ 300", "งบต่อวัน 300", "ตั้งงบรายวัน 500"]) {
      expect(nat(t)?.kind, t).toBe("daily-budget");
    }
    expect(nat("ตั้งงบรายวัน 500")).toEqual({
      kind: "daily-budget",
      action: "set",
      amountSatang: 50000,
    });
    expect(nat("งบเดือนนี้ 5000")).toEqual({
      kind: "budget-set",
      name: null,
      amountSatang: 500000,
    });
    expect(nat("งบอาหาร เดือนละ 3000")).toEqual({
      kind: "budget-set",
      name: "อาหาร",
      amountSatang: 300000,
    });
    for (const t of [
      "งบรายสัปดาห์ 2000",
      "งบอาทิตย์ละ 2000",
      "งบเหลือ 500",
      "งบอาหาร -500",
      "งบ 99999999999",
    ]) {
      expect(nat(t), t).toBeNull();
    }
  });

  it("'งบ' with no amount, or an amount of nothing, is left alone", () => {
    expect(nat("งบ")).toBeNull();
    expect(nat("งบอาหาร")).toBeNull();
    expect(nat("งบอาหาร 0")).toBeNull();
  });

  it("leaves real entries and unknown phrases alone", () => {
    for (const t of [
      "กาแฟ 50",
      "ค่างบ 100",
      "ข้าว 50 กาแฟ 30",
      "สวัสดีค่ะ พี่ฮูกอยากรู้ว่าฝนจะตกไหม",
      "ฝนจะตกไหม",
    ]) {
      expect(nat(t), t).toBeNull();
    }
  });

  it("the exact commands still belong to parseCommand", () => {
    expect(parseCommand("ลบล่าสุด")).toEqual({ kind: "delete-latest" });
    expect(parseCommand("ลบอันล่าสุด")).toBeNull();
  });
});

describe("a number that counts things is not a price", () => {
  it("a lone number before a unit goes to the AI instead of being recorded as baht", () => {
    for (const t of ["ซื้อครีม 2 หลอด", "ซื้อไข่ 3 แผง", "ข้าว 2 จาน", "เตะบอล 5 คน"]) {
      expect(numberCountsThings(t), t).toBe(true);
      expect(needsRouter(t, parseMessage(t, NOW)), t).toBe(true);
    }
  });

  it("a price beside it, or the word baht, keeps it an entry", () => {
    for (const t of [
      "กาแฟ 2 แก้ว 90",
      "ครีม 2 หลอด 300",
      "ค่าครีม 200 บาท",
      "กาแฟ 50",
      "ข้าว 50 กาแฟ 30",
    ]) {
      expect(numberCountsThings(t), t).toBe(false);
    }
    expect(needsRouter("กาแฟ 50", parseMessage("กาแฟ 50", NOW))).toBe(false);
  });
});

describe("what the rules must not record as an expense without the AI", () => {
  const router = (t: string) => needsRouter(t, parseMessage(t, NOW));

  it("a count with decimals or a long unit list is not a price", () => {
    for (const t of [
      "น้ำมัน 1.5 ลิตร",
      "ข้าวสาร 2.5 กิโล",
      "เดิน 10,000 ก้าว",
      "วิ่ง 5 กม.",
      "นอน 8 ชม",
      "เช่ารถ 3 วัน",
      "อายุ 30 ปี",
    ]) {
      expect(router(t), t).toBe(true);
    }
    // a price with a unit after it is still read by the AI, which is only a cost, never a wrong entry
    expect(router("กาแฟ 50")).toBe(false);
    expect(router("ข้าวมันไก่ 55")).toBe(false);
  });

  it("slang questions, plans and wishes, English sentences and a day of the month go to the AI", () => {
    for (const t of [
      "ค่าไฟ 2000 แพงป่ะ",
      "เดือนนี้ใช้ไป 5000 เยอะไปป่าว",
      "เดือนหน้าต้องจ่ายค่าเทอม 20000",
      "อยากได้ไอโฟน 40000",
      "I paid 300 for taxi yesterday",
      "ค่าเช่าวันที่ 5 5000",
    ]) {
      expect(router(t), t).toBe(true);
    }
  });

  it("a word search stops at a Thai-digit number too", () => {
    expect(nat("หา ของขวัญ ๕๐๐")).toBeNull();
    expect(nat("หา ของขวัญ")).toEqual({ kind: "find", term: "ของขวัญ", in: "any" });
  });
});
