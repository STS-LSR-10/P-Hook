import { describe, expect, it } from "vitest";
import { buildReminderCard, buildReminderListCard } from "./reminder-flex";

// Wednesday 28 Oct 2026, 10:00 in Bangkok; the reminder is 09:00 on Thursday the 29th
const NOW = new Date("2026-10-28T03:00:00Z");
const base = {
  id: "11111111-1111-1111-1111-111111111111",
  body: "จ่ายค่าไฟ",
  remindAt: new Date("2026-10-29T02:00:00Z"),
  repeat: null,
  timeDefaulted: false,
  now: NOW,
};
const card = (over: Partial<Parameters<typeof buildReminderCard>[0]> = {}) =>
  buildReminderCard({ ...base, ...over }) as unknown as {
    contents: {
      header: { contents: { text: string }[] };
      body: { contents: Record<string, unknown>[] };
      footer: { contents: Record<string, unknown>[] };
    };
  };
const json = (over: Partial<Parameters<typeof buildReminderCard>[0]> = {}) =>
  JSON.stringify(card(over));

describe("reminder card", () => {
  it("is a narrow card: what it holds is short", () => {
    expect(
      (buildReminderCard(base) as unknown as { contents: { size: string } }).contents.size,
    ).toBe("kilo");
  });

  it("says it is set and how often in the header, in the app's green", () => {
    const head = card().contents.header.contents.map((c) => c.text);
    expect(head).toEqual(["⏰ ตั้งเตือนแล้ว", "ครั้งเดียว"]);
    expect(json()).toContain("#CCFBF1");
    expect(card({ repeat: "daily" }).contents.header.contents[1]?.text).toBe("ทุกวัน");
  });

  it("shows what, then the time large with its day beside it", () => {
    const out = json();
    expect(out).toContain('"text":"จ่ายค่าไฟ"');
    expect(out).toContain('"text":"09:00"');
    expect(out).toContain('"text":"พรุ่งนี้"');
    expect(json({ remindAt: new Date("2026-10-28T11:00:00Z") })).toContain('"text":"วันนี้"');
    expect(json({ remindAt: new Date("2026-11-05T02:00:00Z") })).toContain('"text":"5 พ.ย. 2569"');
  });

  it("a repeating one says its day of the week or month", () => {
    // the 29th is a Thursday
    expect(json({ repeat: "weekly" })).toContain('"text":"ทุกวันพฤหัสบดี"');
    expect(json({ repeat: "monthly" })).toContain('"text":"ทุกวันที่ 29"');
    expect(json({ repeat: "daily" })).toContain('"text":"ทุกวัน"');
  });

  it("two outlined buttons: change the time (the reminders page) and cancel", () => {
    const out = json({ listUrl: "https://liff.line.me/x/reminders" });
    // the page opens on this reminder, ready to change
    expect(out).toContain(
      `"label":"เปลี่ยนเวลา","uri":"https://liff.line.me/x/reminders?edit=${base.id}"`,
    );
    // a group's goes to the group's page as it is
    expect(
      json({ listUrl: "https://liff.line.me/x/reminders?g=g1", cancelData: "a=grmx&id=1" }),
    ).toContain('"uri":"https://liff.line.me/x/reminders?g=g1"');
    expect(out).toContain(`"data":"a=rmx&id=${base.id}"`);
    // no page known: only cancel
    expect(json()).not.toContain("เปลี่ยนเวลา");
  });

  it("a personal one can be added to a calendar, on a page that asks which", () => {
    const out = json({ listUrl: "https://liff.line.me/x/reminders" });
    expect(out).toContain(
      `"label":"📅 เพิ่มลงปฏิทิน","uri":"https://liff.line.me/x/reminders/calendar?id=${base.id}"`,
    );
    // a group's keeps its own two calendar buttons
    expect(
      json({ listUrl: "https://liff.line.me/x/reminders?g=g1", cancelData: "a=grmx&id=1" }),
    ).not.toContain("เพิ่มลงปฏิทิน");
    expect(json()).not.toContain("เพิ่มลงปฏิทิน");
  });

  it("still says when the time was not given, or had passed", () => {
    expect(json({ timeDefaulted: true })).toContain("ตั้งเป็น 09:00");
    expect(json({ timeDefaulted: true })).toContain("เปลี่ยนเวลา");
    expect(json({ rolledToTomorrow: true })).toContain("เลยตั้งเป็นพรุ่งนี้");
    expect(json()).not.toContain("ตั้งเป็น 09:00");
  });

  it("keeps the postback data short", () => {
    expect(`a=rmx&id=${base.id}`.length).toBeLessThan(300);
  });
});

describe("the card after a reminder was changed on its page", () => {
  it("says so in its header", () => {
    const head = card({ edited: true }).contents.header.contents.map((c) => c.text);
    expect(head[0]).toBe("⏰ แก้ไขเตือนแล้ว");
  });
});

describe("the list of waiting reminders", () => {
  const item = (n: number, body: string, remindAt: string, repeat: "daily" | null = null) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    body,
    remindAt,
    repeat,
    status: "active" as const,
    category: null,
  });
  const three = [
    item(1, "กินข้าว", "2026-10-28T10:00:00Z"),
    item(2, "กินยา", "2026-10-29T01:00:00Z", "daily"),
    item(3, "ไปดูดวง", "2026-11-02T08:00:00Z"),
  ];
  const list = (over: Partial<Parameters<typeof buildReminderListCard>[0]> = {}) =>
    JSON.stringify(
      buildReminderListCard({
        items: three,
        total: 3,
        listUrl: "https://liff.line.me/x/reminders",
        now: NOW,
        ...over,
      }),
    );

  it("shows each reminder: its time large, its day beside it, and what it is", () => {
    const out = list();
    expect(out).toContain('"text":"17:00"');
    expect(out).toContain('"text":"วันนี้"');
    expect(out).toContain('"text":"กินข้าว"');
    expect(out).toContain('"text":"08:00"');
    expect(out).toContain('"text":"ทุกวัน"');
    expect(out).toContain('"text":"ไปดูดวง"');
  });

  it("says how many wait, and how many more there are than shown", () => {
    expect(list()).toContain("3 รายการ");
    expect(list({ total: 8 })).toContain("และอีก 5 รายการ");
    expect(list()).not.toContain("และอีก");
  });

  it("a button opens the page with them all, and none without a page", () => {
    expect(list()).toContain('"label":"ดูเตือนทั้งหมด","uri":"https://liff.line.me/x/reminders"');
    expect(list({ listUrl: undefined })).not.toContain("ดูเตือนทั้งหมด");
  });
});

describe("the icon in a card's header", () => {
  const title = (m: unknown) =>
    (m as { contents: { header: { contents: { text?: string }[] } } }).contents.header.contents[0]
      ?.text;

  it("the reminder list has an hourglass", () => {
    const card = buildReminderListCard({ items: [], total: 0, now: NOW });
    expect(title(card)).toBe("⏳ เตือนที่รออยู่");
  });
});
