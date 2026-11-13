import { describe, expect, it } from "vitest";
import {
  describeReminder,
  parseReminder,
  reminderCapacity,
  moveReminderTime,
  snoozeTime,
  whenFromNow,
} from "./user-reminder";

// Wednesday 28 Oct 2026, 10:00 in Bangkok
const NOW = new Date("2026-10-28T03:00:00Z");

/** The result as "YYYY-MM-DD HH:MM" in Bangkok, so the table below reads like a calendar. */
function bkk(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3_600_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}
const ok = (input: string, now = NOW) => {
  const r = parseReminder(input, now);
  if (!r.ok) throw new Error(`not ok: ${r.reason} for ${input}`);
  return r;
};

describe("when", () => {
  it.each([
    ["พรุ่งนี้ 9 โมง จ่ายค่าไฟ", "2026-10-29 09:00"],
    ["พรุ่งนี้ 09:30 จ่ายค่าไฟ", "2026-10-29 09:30"],
    ["พรุ่งนี้ 21.45 จ่ายค่าไฟ", "2026-10-29 21:45"],
    ["วันนี้ 4 โมงเย็น ประชุม", "2026-10-28 16:00"],
    ["วันนี้ บ่ายสาม ประชุม", "2026-10-28 15:00"],
    ["พรุ่งนี้ เก้าโมง ประชุม", "2026-10-29 09:00"],
    ["พรุ่งนี้ ตีห้า ไปสนามบิน", "2026-10-29 05:00"],
    ["พรุ่งนี้ สองทุ่ม ดูหนัง", "2026-10-29 20:00"],
    ["วันนี้ บ่าย 3 ประชุม", "2026-10-28 15:00"],
    ["วันนี้ บ่ายโมง ประชุม", "2026-10-28 13:00"],
    ["วันนี้ 2 โมง ประชุม", "2026-10-28 14:00"],
    ["วันนี้ 2 ทุ่ม ดูหนัง", "2026-10-28 20:00"],
    ["วันนี้ ทุ่ม ดูหนัง", "2026-10-28 19:00"],
    ["พรุ่งนี้ ตี 5 ไปสนามบิน", "2026-10-29 05:00"],
    ["พรุ่งนี้ 7 โมงเช้า ไปสนามบิน", "2026-10-29 07:00"],
    ["พรุ่งนี้ เที่ยง กินข้าว", "2026-10-29 12:00"],
    ["พรุ่งนี้ เที่ยงคืน ส่งงาน", "2026-10-30 00:00"],
    ["มะรืนนี้ 8 โมง ตัดผม", "2026-10-30 08:00"],
    ["พรุ่งนี้ ตอนเย็น ซื้อของ", "2026-10-29 17:00"],
    ["คืนนี้ ซักผ้า", "2026-10-28 20:00"],
    ["พรุ่งนี้ จ่ายค่าไฟ", "2026-10-29 09:00"], // no time: 09:00
    // "ครึ่ง" is half past
    ["พรุ่งนี้ 9 โมงครึ่ง ประชุม", "2026-10-29 09:30"],
    ["พรุ่งนี้ 9 โมง ครึ่ง ประชุม", "2026-10-29 09:30"],
    ["วันนี้ บ่าย 3 ครึ่ง ประชุม", "2026-10-28 15:30"],
    ["วันนี้ บ่ายโมงครึ่ง ประชุม", "2026-10-28 13:30"],
    ["วันนี้ 2 ทุ่มครึ่ง ดูหนัง", "2026-10-28 20:30"],
    ["พรุ่งนี้ ตี 5 ครึ่ง ไปสนามบิน", "2026-10-29 05:30"],
    ["พรุ่งนี้ เที่ยงครึ่ง กินข้าว", "2026-10-29 12:30"],
    ["พรุ่งนี้ 4 โมงเย็นครึ่ง รับลูก", "2026-10-29 16:30"],
    ["พรุ่งนี้ 7 โมงครึ่งเช้า ไปสนามบิน", "2026-10-29 07:30"],
    // a weekday with its day of the month: the day of the month decides
    ["วันศุกร์ที่ 27 งานเลี้ยงบริษัท", "2026-11-27 09:00"],
    ["วันศุกร์ ที่ 27 งานเลี้ยงบริษัท", "2026-11-27 09:00"],
  ])("%s", (input, expected) => {
    expect(bkk(ok(input).remindAt)).toBe(expected);
  });

  it("says when the time was not given", () => {
    expect(ok("พรุ่งนี้ จ่ายค่าไฟ").timeDefaulted).toBe(true);
    expect(ok("พรุ่งนี้ 9 โมง จ่ายค่าไฟ").timeDefaulted).toBe(false);
  });

  it("a time alone is today when still ahead, tomorrow when it has gone by", () => {
    expect(bkk(ok("11 โมง กินยา").remindAt)).toBe("2026-10-28 11:00");
    expect(bkk(ok("9 โมง กินยา").remindAt)).toBe("2026-10-29 09:00");
  });

  it("counts from now for อีก … นาที / ชั่วโมง / วัน", () => {
    expect(bkk(ok("อีก 30 นาที พักสายตา").remindAt)).toBe("2026-10-28 10:30");
    expect(bkk(ok("อีก 2 ชั่วโมง โทรหาแม่").remindAt)).toBe("2026-10-28 12:00");
    expect(bkk(ok("อีก 3 วัน คืนหนังสือ").remindAt)).toBe("2026-10-31 10:00");
  });

  it("a weekday is the next one, and the same day only while its time is still ahead", () => {
    expect(bkk(ok("วันศุกร์ 8 โมง ส่งรายงาน").remindAt)).toBe("2026-10-30 08:00");
    expect(bkk(ok("วันพุธ 11 โมง ประชุม").remindAt)).toBe("2026-10-28 11:00");
    expect(bkk(ok("วันพุธ 9 โมง ประชุม").remindAt)).toBe("2026-11-04 09:00");
    expect(bkk(ok("วันจันทร์หน้า ส่งงาน").remindAt)).toBe("2026-11-02 09:00");
  });

  it.each([
    ["25/12 ซื้อของขวัญ", "2026-12-25 09:00"],
    ["25/12/2569 ซื้อของขวัญ", "2026-12-25 09:00"],
    ["25 ธ.ค. 8 โมง ซื้อของขวัญ", "2026-12-25 08:00"],
    ["25 ธันวาคม ซื้อของขวัญ", "2026-12-25 09:00"],
    ["1/10 ต่อประกัน", "2027-10-01 09:00"], // the 1st of Oct has gone by: next year
    ["วันที่ 5 จ่ายค่าเน็ต", "2026-11-05 09:00"],
    ["วันที่ 30 จ่ายค่าเน็ต", "2026-10-30 09:00"],
    ["วันที่ 31 จ่ายค่าเน็ต", "2026-10-31 09:00"],
  ])("%s", (input, expected) => {
    expect(bkk(ok(input).remindAt)).toBe(expected);
  });

  it("converts a Buddhist-era year and skips a month that has no such day", () => {
    expect(bkk(ok("5/1/2570 ต่อภาษี").remindAt)).toBe("2027-01-05 09:00");
    expect(bkk(ok("วันที่ 31 จ่ายบิล", new Date("2026-11-10T03:00:00Z")).remindAt)).toBe(
      "2026-12-31 09:00", // November has no 31st
    );
  });

  it("works the same around midnight in Bangkok, not UTC", () => {
    // 28 Oct 23:30 Bangkok is still the 28th (16:30 UTC)
    const lateNight = new Date("2026-10-28T16:30:00Z");
    expect(bkk(ok("พรุ่งนี้ 8 โมง กินยา", lateNight).remindAt)).toBe("2026-10-29 08:00");
    expect(bkk(ok("วันนี้ 23:45 ปิดไฟ", lateNight).remindAt)).toBe("2026-10-28 23:45");
    expect(bkk(ok("9 โมง กินยา", lateNight).remindAt)).toBe("2026-10-29 09:00");
  });
});

describe("how often", () => {
  it.each([
    ["ทุกวัน 8 โมง กินยา", "daily", "2026-10-29 08:00"],
    ["ทุกวัน 11 โมง กินยา", "daily", "2026-10-28 11:00"],
    ["ทุกสัปดาห์ 9 โมง ซักผ้า", "weekly", "2026-10-29 09:00"],
    ["ทุกวันจันทร์ 8 โมง ประชุมทีม", "weekly", "2026-11-02 08:00"],
    ["ทุกเดือน 9 โมง จ่ายค่าเช่า", "monthly", "2026-10-29 09:00"],
    ["ทุกวันที่ 1 จ่ายค่าเช่า", "monthly", "2026-11-01 09:00"],
  ])("%s", (input, repeat, at) => {
    const r = ok(input);
    expect(r.repeat).toBe(repeat);
    expect(bkk(r.remindAt)).toBe(at);
  });

  // what a voice message is heard as: the words of the repeat come apart
  it.each([
    ["ทำ weekly ทุก วัน พฤหัสบดี 15:00 น.", "weekly", "2026-10-29 15:00", "ทำ weekly"],
    ["ทุก วัน จันทร์ 8 โมง ประชุมทีม", "weekly", "2026-11-02 08:00", "ประชุมทีม"],
    ["ทุก พฤหัส 9 โมง ส่งงาน", "weekly", "2026-10-29 09:00", "ส่งงาน"],
    ["ทุก สัปดาห์ 9 โมง ซักผ้า", "weekly", "2026-10-29 09:00", "ซักผ้า"],
    ["ทุก วัน ที่ 1 จ่ายค่าเช่า", "monthly", "2026-11-01 09:00", "จ่ายค่าเช่า"],
    ["ทุก เดือน 9 โมง จ่ายค่าเน็ต", "monthly", "2026-10-29 09:00", "จ่ายค่าเน็ต"],
    ["ทุก วัน 8 โมง กินยา", "daily", "2026-10-29 08:00", "กินยา"],
  ])("spoken with spaces: %s", (input, repeat, at, body) => {
    const r = ok(input);
    expect([r.repeat, bkk(r.remindAt), r.body]).toEqual([repeat, at, body]);
    expect(r.rolledToTomorrow).toBeFalsy();
  });

  it("a day said with a space is that day", () => {
    expect(bkk(ok("วัน ศุกร์ 9 โมง ประชุม").remindAt)).toBe("2026-10-30 09:00");
  });

  it("a one-off has no repeat", () => {
    expect(ok("พรุ่งนี้ 9 โมง ประชุม").repeat).toBeNull();
  });
});

describe("what about", () => {
  it.each([
    ["พรุ่งนี้ 9 โมง จ่ายค่าไฟ", "จ่ายค่าไฟ"],
    ["จ่ายค่าไฟ พรุ่งนี้ 9 โมง", "จ่ายค่าไฟ"],
    ["พรุ่งนี้ 9 โมง ให้อาหารแมว", "ให้อาหารแมว"], // "ให้" can be part of the text
    ["พรุ่งนี้ ตอน 9 โมง ว่า ประชุมทีม", "ประชุมทีม"],
    ["  พรุ่งนี้   9 โมง   ซื้อ นม   ไข่ ", "ซื้อ นม ไข่"],
    ["พรุ่งนี้ 9 โมง - ส่งงาน", "ส่งงาน"],
  ])("%s", (input, body) => {
    expect(ok(input).body).toBe(body);
  });

  it("keeps the case and a long text is cut at 200 characters", () => {
    expect(ok("พรุ่งนี้ 9 โมง Call Mom").body).toBe("Call Mom");
    expect(ok(`พรุ่งนี้ 9 โมง ${"ก".repeat(300)}`).body).toHaveLength(200);
  });

  it("Thai digits work", () => {
    expect(bkk(ok("พรุ่งนี้ ๙ โมง ประชุม").remindAt)).toBe("2026-10-29 09:00");
  });
});

describe("what it refuses", () => {
  it("no text", () => {
    expect(parseReminder("พรุ่งนี้ 9 โมง", NOW)).toEqual({ ok: false, reason: "no_text" });
    expect(parseReminder("", NOW)).toEqual({ ok: false, reason: "no_text" });
  });
  it("no time at all", () => {
    expect(parseReminder("จ่ายค่าไฟ", NOW)).toEqual({ ok: false, reason: "no_time" });
  });
  it("a time that has gone by today", () => {
    expect(parseReminder("วันนี้ 8 โมง จ่ายค่าไฟ", NOW)).toEqual({ ok: false, reason: "past" });
    expect(parseReminder("25/10/2569 จ่ายค่าไฟ", NOW)).toEqual({ ok: false, reason: "past" });
  });
  it("more than a year ahead, and an impossible date", () => {
    expect(parseReminder("1/1/2575 ต่อภาษี", NOW)).toEqual({ ok: false, reason: "too_far" });
    expect(parseReminder("31/2 ต่อภาษี", NOW).ok).toBe(false);
  });
});

describe("reminderCapacity and describeReminder", () => {
  it("grows with the plan", () => {
    expect(
      (["free", "starter", "plus", "ultimate"] as const).map((p) => reminderCapacity(p)),
    ).toEqual([5, 50, 100, 250]);
  });
  it("shows the date, the time and how often", () => {
    expect(describeReminder(new Date("2026-10-29T02:00:00Z"), null)).toBe("29 ต.ค. 2569 09:00");
    expect(describeReminder(new Date("2026-10-29T02:00:00Z"), "daily")).toBe(
      "29 ต.ค. 2569 09:00 · ทุกวัน",
    );
  });
});

describe("a time that has already gone by today", () => {
  it("moves to tomorrow and says so", () => {
    const r = ok("กินยา 8 โมง");
    expect(bkk(r.remindAt)).toBe("2026-10-29 08:00");
    expect(r.rolledToTomorrow).toBe(true);
  });

  it("is not flagged while it is still ahead", () => {
    expect(ok("กินยา 11 โมง").rolledToTomorrow).toBe(false);
  });

  it("is not flagged when the day was named", () => {
    expect(ok("พรุ่งนี้ กินยา 8 โมง").rolledToTomorrow).toBe(false);
  });

  it("is not flagged on a repeat, which simply starts tomorrow", () => {
    expect(ok("ทุกวัน กินยา 8 โมง").rolledToTomorrow).toBe(false);
  });
});

describe("moveReminderTime", () => {
  const SUNDAY_NOON = new Date("2026-11-01T05:00:00Z");
  const at = (iso: string, when: string) => moveReminderTime(when, new Date(iso), SUNDAY_NOON);
  const time = (r: ReturnType<typeof at>) => (r.ok ? r.remindAt.toISOString() : r.reason);

  it("a time alone keeps the day of a monthly reminder", () => {
    expect(time(at("2026-11-05T01:00:00Z", "3 ทุ่ม"))).toBe("2026-11-05T14:00:00.000Z");
  });

  it("a time alone keeps the day of a one-off reminder", () => {
    expect(time(at("2026-11-06T02:00:00Z", "3 ทุ่ม"))).toBe("2026-11-06T14:00:00.000Z");
  });

  it("a day alone keeps the time", () => {
    expect(time(at("2026-11-05T01:00:00Z", "พรุ่งนี้"))).toBe("2026-11-02T01:00:00.000Z");
  });

  it("a day and a time replace both", () => {
    expect(time(at("2026-11-05T01:00:00Z", "พรุ่งนี้ 3 ทุ่ม"))).toBe("2026-11-02T14:00:00.000Z");
  });

  it("counts from now for a relative time", () => {
    expect(time(at("2026-11-05T01:00:00Z", "อีก 30 นาที"))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("moves on to the next time when the kept day has passed for that time", () => {
    expect(time(at("2026-11-01T01:00:00Z", "7 โมง"))).toBe("2026-11-02T00:00:00.000Z");
  });

  it("flags only a move that rolled over", () => {
    const kept = at("2026-11-05T01:00:00Z", "3 ทุ่ม");
    expect(kept.ok && kept.rolledToTomorrow).toBe(false);
    const rolled = at("2026-11-01T01:00:00Z", "7 โมง");
    expect(rolled.ok && rolled.rolledToTomorrow).toBe(true);
  });

  it("midnight is the end of the kept day", () => {
    expect(time(at("2026-11-05T01:00:00Z", "เที่ยงคืน"))).toBe("2026-11-05T17:00:00.000Z");
  });

  it("a new repeat is taken as given", () => {
    const r = at("2026-11-05T01:00:00Z", "ทุกวัน 3 ทุ่ม");
    expect(r.ok && r.repeat).toBe("daily");
    expect(time(r)).toBe("2026-11-01T14:00:00.000Z");
  });

  it("says when no time was given", () => {
    expect(time(at("2026-11-05T01:00:00Z", "เร็วๆ นี้"))).toBe("no_time");
  });
});

describe("snoozing", () => {
  // Tuesday 3 Nov 2026, 10:30:20 in Bangkok
  const now = new Date("2026-11-03T03:30:20Z");

  it("is 10 minutes or an hour from now, on the minute", () => {
    expect(snoozeTime("10", now).toISOString()).toBe("2026-11-03T03:41:00.000Z");
    expect(snoozeTime("60", now).toISOString()).toBe("2026-11-03T04:31:00.000Z");
  });

  it("is 09:00 tomorrow, or this morning when it is still the small hours", () => {
    expect(snoozeTime("tm", now).toISOString()).toBe("2026-11-04T02:00:00.000Z");
    const late = new Date("2026-11-02T18:30:00Z"); // 01:30 on the 3rd in Bangkok
    expect(snoozeTime("tm", late).toISOString()).toBe("2026-11-03T02:00:00.000Z");
  });

  it("says when as a person would", () => {
    expect(whenFromNow(new Date("2026-11-03T03:41:00Z"), now)).toBe("ตอน 10:41");
    expect(whenFromNow(new Date("2026-11-04T02:00:00Z"), now)).toBe("พรุ่งนี้ 09:00");
    expect(whenFromNow(new Date("2026-11-10T01:00:00Z"), now)).toBe("10 พ.ย. 2569 08:00");
  });
});

describe("the three chats that went wrong", () => {
  it("เตือนวันที่ 27 เวลา 9 โมงครึ่งงานเลี้ยงบริษัท: 09:30, and ครึ่ง is not in the words", () => {
    const r = ok("วันที่ 27 เวลา 9 โมงครึ่งงานเลี้ยงบริษัท");
    expect(bkk(r.remindAt)).toBe("2026-11-27 09:30");
    expect(r.body).toBe("งานเลี้ยงบริษัท");
  });
  it("the AI's words for the same (what, then when) give the same", () => {
    const r = ok("งานเลี้ยงบริษัท วันที่ 27 9 โมงครึ่ง");
    expect(bkk(r.remindAt)).toBe("2026-11-27 09:30");
    expect(r.body).toBe("งานเลี้ยงบริษัท");
  });
  it("วันศุกร์ที่ 27 keeps ที่ out of the words", () => {
    expect(ok("วันศุกร์ที่ 27 งานเลี้ยงบริษัท").body).toBe("งานเลี้ยงบริษัท");
  });
  it("ครึ่ง that is not a time stays in the words", () => {
    expect(ok("พรุ่งนี้ 9 โมง แบ่งครึ่งค่าข้าว").body).toBe("แบ่งครึ่งค่าข้าว");
  });
  it.each([
    ["พรุ่งนี้ 9 โมง ครึ่งชั่วโมงก่อนประชุม", "2026-10-29 09:00", "ครึ่งชั่วโมงก่อนประชุม"],
    ["พรุ่งนี้ 9 โมง ครึ่งนึงของเงินเดือนโอนแม่", "2026-10-29 09:00", "ครึ่งนึงของเงินเดือนโอนแม่"],
    ["พรุ่งนี้ 5 โมงเย็น ครึ่งหนึ่งของทีมไปงาน", "2026-10-29 17:00", "ครึ่งหนึ่งของทีมไปงาน"],
    ["พรุ่งนี้ 8 โมง ครึ่งวัน ลางาน", "2026-10-29 08:00", "ครึ่งวัน ลางาน"],
    ["พรุ่งนี้ บ่าย 2 ครึ่งชม ประชุม", "2026-10-29 14:00", "ครึ่งชม ประชุม"],
  ])("ครึ่ง of something is not half past: %s", (input, at, body) => {
    const r = ok(input);
    expect(bkk(r.remindAt)).toBe(at);
    expect(r.body).toBe(body);
  });
});

describe("a weekday with a day number and no time", () => {
  it("วันอาทิตย์ 27 is the next 27th that is a Sunday, at 09:00, said so", () => {
    const r = ok("วันอาทิตย์ 27 ไปกินข้าวกับเพื่อน");
    expect(bkk(r.remindAt)).toBe("2026-12-27 09:00");
    expect(r.body).toBe("ไปกินข้าวกับเพื่อน");
    expect(r.timeDefaulted).toBe(true);
  });
  it.each([
    ["วันอาทิตย์ที่ 27 ไปกินข้าวกับเพื่อน", "2026-12-27 09:00"],
    ["วันพุธที่ 11 ประชุม", "2026-11-11 09:00"],
    ["วันศุกร์ที่ 27 งานเลี้ยงบริษัท", "2026-11-27 09:00"],
    ["วันอาทิตย์ 27 บ่าย 2 ครึ่ง ไปกินข้าว", "2026-12-27 14:30"],
  ])("%s", (input, at) => expect(bkk(ok(input).remindAt)).toBe(at));
  it("a weekday and a time (no day number) stays the coming weekday", () => {
    expect(bkk(ok("วันอาทิตย์ 9 โมง ไปวัด").remindAt)).toBe("2026-11-01 09:00");
  });
});

describe("a number after a weekday that is not a day", () => {
  it.each([
    ["กินยาวันพุธ 2 เม็ด", "2026-11-04 09:00", "กินยา 2 เม็ด"],
    ["กินยาวันพุธ 5 ครั้ง", "2026-11-04 09:00", "กินยา 5 ครั้ง"],
    ["วิ่งวันอาทิตย์ 5 กม.", "2026-11-01 09:00", "วิ่ง 5 กม"],
  ])("%s keeps the count in the words", (input, at, body) => {
    const r = ok(input);
    expect(bkk(r.remindAt)).toBe(at);
    expect(r.body).toBe(body);
  });
  it("a weekday that matches no 27th soon keeps the next 27th", () => {
    expect(bkk(ok("วันเสาร์ 27 งาน").remindAt)).toBe("2026-11-27 09:00");
  });
});
