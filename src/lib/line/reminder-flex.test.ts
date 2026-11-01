import { describe, expect, it } from "vitest";
import { buildReminderCard } from "./reminder-flex";

const base = {
  id: "11111111-1111-1111-1111-111111111111",
  body: "จ่ายค่าไฟ",
  remindAt: new Date("2026-10-29T02:00:00Z"),
  repeat: null,
  timeDefaulted: false,
};
const json = (over: Partial<Parameters<typeof buildReminderCard>[0]> = {}) =>
  JSON.stringify(buildReminderCard({ ...base, ...over }));

describe("reminder card", () => {
  it("shows what and when, with a button that cancels this reminder", () => {
    const out = json();
    expect(out).toContain("ตั้งเตือนแล้ว");
    expect(out).toContain("จ่ายค่าไฟ");
    expect(out).toContain("29 ต.ค. 2569 09:00");
    expect(out).toContain(`"data":"a=rmx&id=${base.id}"`);
  });

  it("says how often, and when the time was not given", () => {
    expect(json({ repeat: "daily" })).toContain("· ทุกวัน");
    expect(json({ timeDefaulted: true })).toContain("ใช้ 09:00");
    expect(json()).not.toContain("ใช้ 09:00");
  });

  it("says when the time had passed, so it was set for tomorrow", () => {
    expect(json({ rolledToTomorrow: true })).toContain("เลยตั้งเป็นพรุ่งนี้");
    expect(json()).not.toContain("เลยตั้งเป็นพรุ่งนี้");
  });

  it("links to the reminders page only when it is known", () => {
    expect(json()).not.toContain('"type":"uri"');
    expect(json({ listUrl: "https://liff.line.me/x/reminders" })).toContain(
      "https://liff.line.me/x/reminders",
    );
  });

  it("keeps the postback data short", () => {
    expect(`a=rmx&id=${base.id}`.length).toBeLessThan(300);
  });
});
