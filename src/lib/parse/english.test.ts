import { describe, expect, it } from "vitest";
import { englishToThai } from "./english";

const cases: [string, string][] = [
  // commands on their own
  ["help", "วิธีใช้งาน"],
  ["Summary", "สรุปวันนี้"],
  ["today", "สรุปวันนี้"],
  ["this month", "สรุปเดือนนี้"],
  ["recent", "ล่าสุด"],
  ["undo", "ลบล่าสุด"],
  ["delete last", "ลบล่าสุด"],
  ["by category", "สรุปหมวด"],
  ["compare", "เทียบเดือน"],
  ["forecast", "พยากรณ์"],
  ["analyse", "วิเคราะห์"],
  ["wallets", "กระเป๋า"],
  ["debts", "หนี้"],
  ["bills", "บิล"],
  ["goals", "เป้าหมาย"],
  ["reminders", "รายการเตือน"],
  ["notes", "โน้ต"],
  ["my files", "ไฟล์ของฉัน"],
  ["keep this", "เก็บไว้"],
  ["points", "เหรียญ"],
  ["invite code", "รหัสชวน"],
  ["daily budget", "งบวัน"],
  ["daily budget off", "งบวัน ปิด"],
  ["ask", "ถามพี่ฮูก"],
  ["done", "จบ"],
  // commands with what follows
  ["edit last 45", "แก้ล่าสุด 45"],
  ["daily budget 500", "งบวัน 500"],
  ["use code ABCD1234", "ใช้รหัส ABCD1234"],
  ["join wallet 482913", "ร่วมกระเป๋า 482913"],
  ["note buy milk, wifi 1234", "โน้ต buy milk, wifi 1234"],
  ["search notes wifi", "ค้นหาโน้ต wifi"],
  ["find file lease", "หาไฟล์ lease"],
  ["search coffee", "ค้นหา coffee"],
  ["ask how much did I spend", "ฮูก how much did I spend"],
  ["year 2025", "สรุปปี 2025"],
  ["transfer 500 from cash to KTC", "โอน 500 จาก cash ไป KTC"],
  ["lend John 500", "ให้ยืม John 500"],
  ["borrow mom 2000 due 25/10", "ยืม mom 2000 คืน 25/10"],
  ["John paid back 200", "Johnคืน 200"],
  ["repay mom 1000", "คืนmom 1000"],
  ["pay bill electricity", "จ่ายบิล electricity"],
  ["new goal Japan trip 30000", "เป้าหมาย ใหม่ Japan trip 30000"],
  ["save Japan trip 2000", "ออม Japan trip 2000"],
  ["withdraw Japan trip 500", "ถอน Japan trip 500"],
  ["summary 1/10 to 15/10", "สรุป 1/10 ถึง 15/10"],
  // reminders, with their times in words the Thai reader knows
  ["remind me tomorrow 9am pay rent", "เตือน พรุ่งนี้ 9:00 pay rent"],
  ["remind me tomorrow at 9:30pm call mom", "เตือน พรุ่งนี้ 21:30 call mom"],
  ["remind me in 30 minutes rest", "เตือน อีก 30 นาที rest"],
  ["remind me in 2 hours check the oven", "เตือน อีก 2 ชั่วโมง check the oven"],
  ["remind me every day 8am take pills", "เตือน ทุกวัน 8:00 take pills"],
  ["remind me every monday at noon meeting", "เตือน ทุกวันจันทร์ 12:00 meeting"],
  ["remind me every month on the 1st pay rent", "เตือน ทุกวันที่ 1 pay rent"],
  ["remind me today 6pm call mom", "เตือน วันนี้ 18:00 call mom"],
  ["remind me 12am sleep", "เตือน 0:00 sleep"],
  // entries
  ["yesterday coffee 60", "เมื่อวาน coffee 60"],
  ["salary 25000", "+25000 salary"],
  ["coffee 30", "coffee 30"],
  ["กาแฟ 30", "กาแฟ 30"],
];

describe("English typed to the bot, read as the Thai it already understands", () => {
  it.each(cases)("%s", (en, th) => {
    expect(englishToThai(en)).toBe(th);
  });

  it("leaves words inside an entry alone (only a command at the start is read)", () => {
    expect(englishToThai("help desk fee 200")).toBe("help desk fee 200");
    expect(englishToThai("today special 80")).toBe("today special 80");
  });
});
