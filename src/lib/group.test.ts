import { describe, expect, it } from "vitest";
import { canDeleteEntry, parseGroupCommand, summarizePayers } from "./group";

describe("parseGroupCommand", () => {
  it.each([
    ["เปิดสมุดกลุ่ม", { kind: "open" }],
    ["เปิดสมุด", { kind: "open" }],
    ["ปิดสมุดกลุ่ม", { kind: "close" }],
    ["สรุป", { kind: "summary", scope: "month" }],
    ["สรุปกลุ่ม", { kind: "summary", scope: "month" }],
    ["สรุปเดือนนี้", { kind: "summary", scope: "month" }],
    ["สรุปวันนี้", { kind: "summary", scope: "today" }],
    ["ล่าสุด", { kind: "recent" }],
    ["ลบล่าสุด", { kind: "delete-last" }],
    ["ช่วยเหลือ", { kind: "help" }],
    ["  Help  ", { kind: "help" }],
  ])("%s", (input, expected) => {
    expect(parseGroupCommand(input)).toEqual(expected);
  });

  it.each([
    ["เก็บไฟล์", { kind: "file-keep", name: null }],
    ["เก็บรูป", { kind: "file-keep", name: null }],
    ["เก็บไฟล์ สัญญาเช่า", { kind: "file-keep", name: "สัญญาเช่า" }],
    ["ไฟล์กลุ่ม", { kind: "file-list", term: null }],
    ["ไฟล์ทั้งหมด", { kind: "file-list", term: null }],
    ["หาไฟล์ สัญญา", { kind: "file-list", term: "สัญญา" }],
    ["เตือนกลุ่ม", { kind: "remind-list" }],
    ["รายการเตือน", { kind: "remind-list" }],
    ["เตือน พรุ่งนี้ 9 โมง ประชุม", { kind: "remind-add", text: "พรุ่งนี้ 9 โมง ประชุม" }],
    [
      "เตือน ทุกวันศุกร์ 5 โมงเย็น จ่ายค่าห้อง",
      { kind: "remind-add", text: "ทุกวันศุกร์ 5 โมงเย็น จ่ายค่าห้อง" },
    ],
    ["ยกเลิกเตือน 2", { kind: "remind-cancel", index: 2 }],
    ["ฮูก ทริปนี้ใช้ไปเท่าไร", { kind: "owl", question: "ทริปนี้ใช้ไปเท่าไร" }],
    ["ถามพี่ฮูก แปลว่าอะไร", { kind: "owl", question: "แปลว่าอะไร" }],
    ["พี่ฮูก ช่วยคิดหน่อย", { kind: "owl", question: "ช่วยคิดหน่อย" }],
    ["ถามพี่ฮูก", { kind: "owl", question: "" }],
  ])("group extras: %s", (input, expected) => {
    expect(parseGroupCommand(input)).toEqual(expected);
  });

  it("ordinary chat that only starts like an extra stays quiet", () => {
    expect(parseGroupCommand("เก็บไว้ก่อนนะ")).toBeNull();
    expect(parseGroupCommand("ฮูกกี้ น่ารัก")).toBeNull();
    expect(parseGroupCommand("เตือนแล้วนะ")).toBeNull();
    expect(parseGroupCommand("ไฟล์อยู่ไหน")).toBeNull();
  });

  it("the word จด can stand anywhere in the entry", () => {
    const body = (input: string) => parseGroupCommand(input);
    expect(body("จด ข้าว 300")).toEqual({ kind: "record", body: "ข้าว 300" });
    expect(body("จดค่าน้ำ 200")).toEqual({ kind: "record", body: "ค่าน้ำ 200" });
    expect(body("เครื่องเล่น 500 จด")).toEqual({ kind: "record", body: "เครื่องเล่น 500" });
    expect(body("เครื่องเล่น 500จด")).toEqual({ kind: "record", body: "เครื่องเล่น 500" });
    expect(body("ข้าว 300 , จด")).toEqual({ kind: "record", body: "ข้าว 300" });
    expect(body("ข้าว จด 300")).toEqual({ kind: "record", body: "ข้าว 300" });
    expect(body("จดข้าว ๓๐๐")).toEqual({ kind: "record", body: "ข้าว ๓๐๐" }); // Thai digits
    expect(body("จดข้าว 300, น้ำ 50")).toEqual({ kind: "record", body: "ข้าว 300, น้ำ 50" });
  });

  it("only 'จด ' in front is a command by itself; the loose forms need an amount", () => {
    expect(parseGroupCommand("จด ข้าวเที่ยง")).toEqual({ kind: "record", body: "ข้าวเที่ยง" }); // the bot explains
    expect(parseGroupCommand("จดไว้ก่อน")).toBeNull();
    expect(parseGroupCommand("เดี๋ยวจด")).toBeNull();
    expect(parseGroupCommand("จดทะเบียนเสร็จแล้ว")).toBeNull();
    expect(parseGroupCommand("ข้าว จด ค่ะ")).toBeNull();
  });

  it("the bot's own name is not the word, and other commands win", () => {
    expect(parseGroupCommand("จดตังค์ 100")).toBeNull();
    expect(parseGroupCommand("จดตังค์")).toBeNull();
    expect(parseGroupCommand("หารบิล หมูกระทะ 1200")?.kind).toBe("bill-new");
    expect(parseGroupCommand("สรุป")?.kind).toBe("summary");
    expect(parseGroupCommand("เริ่มทริป เที่ยวจดหมาย")?.kind).toBe("trip-start");
  });

  it("an entry with the word จด in front", () => {
    expect(parseGroupCommand("จด ข้าวเที่ยง 350")).toEqual({
      kind: "record",
      body: "ข้าวเที่ยง 350",
    });
    expect(parseGroupCommand("จด กาแฟ 90,\nขนม 40")).toEqual({
      kind: "record",
      body: "กาแฟ 90,\nขนม 40",
    });
  });

  it.each([
    "กินข้าว 100 ไหม", // ordinary chat with a number
    "ข้าวเที่ยง 350",
    "จด", // nothing to record
    "สวัสดีทุกคน",
    "",
    "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15", // a personal command is not a group command
    "หนี้",
    "กระเป๋า",
  ])("%s is ignored", (input) => {
    expect(parseGroupCommand(input)).toBeNull();
  });
});

describe("summarizePayers", () => {
  it("totals, counts and shares, with the names we know", () => {
    const s = summarizePayers(
      [
        { lineUserId: "Ubob", totalSatang: 75_000, entries: 2 },
        { lineUserId: "Uanna", totalSatang: 25_000, entries: 1 },
        { lineUserId: "Ughost", totalSatang: 0, entries: 0 },
      ],
      new Map([
        ["Ubob", "บ๊อบ"],
        ["Uanna", "แอน"],
      ]),
    );
    expect(s.totalSatang).toBe(100_000);
    expect(s.count).toBe(3);
    expect(s.payers.map((p) => [p.name, p.percent])).toEqual([
      ["บ๊อบ", 75],
      ["แอน", 25],
      ["สมาชิกกลุ่ม", 0],
    ]);
  });

  it("an empty group has no shares", () => {
    expect(summarizePayers([], new Map())).toEqual({ totalSatang: 0, count: 0, payers: [] });
  });
});

describe("canDeleteEntry", () => {
  it("the writer or the owner", () => {
    expect(canDeleteEntry({ entryPayer: "Ua", requester: "Ua", requesterIsOwner: false })).toBe(
      true,
    );
    expect(canDeleteEntry({ entryPayer: "Ua", requester: "Ub", requesterIsOwner: true })).toBe(
      true,
    );
    expect(canDeleteEntry({ entryPayer: "Ua", requester: "Ub", requesterIsOwner: false })).toBe(
      false,
    );
  });
});
