import { describe, expect, it } from "vitest";
import { buildFilesPageCard } from "./file-flex";
import {
  buildGroupRecentCard,
  buildGroupRemindersCard,
  buildGroupTripsCard,
  buildNoteListCard,
} from "./list-flex";

const json = (m: unknown) => JSON.stringify(m);
const bubble = (m: unknown) =>
  (m as { contents: Record<string, unknown> & { header: { contents: { text?: string }[] } } })
    .contents;
const note = (n: number, body: string) => ({
  id: `n${n}`,
  body,
  createdAt: "2026-10-29T05:00:00Z",
  updatedAt: "2026-10-29T05:00:00Z",
});

describe("note list card", () => {
  const card = (over: Partial<Parameters<typeof buildNoteListCard>[0]> = {}) =>
    json(
      buildNoteListCard({
        title: "โน้ตล่าสุด",
        items: [note(1, "ซื้อนม\nไข่"), note(2, "รหัสไวไฟ 1234")],
        url: "https://liff.line.me/x/notes",
        ...over,
      }),
    );

  it("is a flex card with the title, each note's first line and its day", () => {
    const out = card();
    expect(out).toContain('"type":"flex"');
    expect(out).toContain("โน้ตล่าสุด");
    expect(out).toContain('"text":"ซื้อนม"');
    expect(out).not.toContain("ไข่");
    expect(out).toContain('"text":"รหัสไวไฟ 1234"');
    expect(out).toContain("29 ต.ค. 2569");
  });

  it("a button opens the notes page, with the search typed when it was a search", () => {
    expect(card()).toContain('"label":"ดูโน้ตทั้งหมด","uri":"https://liff.line.me/x/notes"');
    expect(card({ url: "https://liff.line.me/x/notes?q=%E0%B9%84" })).toContain("notes?q=");
    expect(card({ url: undefined })).not.toContain("ดูโน้ตทั้งหมด");
  });

  it("says when there are more than shown", () => {
    expect(card({ more: true })).toContain("ยังมีอีก");
    expect(card()).not.toContain("ยังมีอีก");
  });
});

describe("the files page card", () => {
  it("is one button to the files page, with no list and no space used", () => {
    const out = json(buildFilesPageCard("https://liff.line.me/x/files"));
    expect(out).toContain('"type":"flex"');
    expect(out).toContain("ไฟล์ของฉัน");
    expect(out).toContain('"label":"เปิดหน้าไฟล์","uri":"https://liff.line.me/x/files"');
    expect(out).not.toContain("ใช้ไป");
    expect(out).not.toContain("carousel");
  });
});

describe("group cards", () => {
  const NOW = new Date("2026-10-28T03:00:00Z");

  it("the group's reminders are numbered, each with its time, day and words", () => {
    const out = json(
      buildGroupRemindersCard({
        now: NOW,
        items: [
          { id: "a", body: "จ่ายค่าห้อง", remindAt: "2026-10-29T02:00:00Z", repeat: null },
          { id: "b", body: "ประชุม", remindAt: "2026-10-30T02:00:00Z", repeat: "weekly" },
        ],
      }),
    );
    expect(out).toContain("เตือนของกลุ่ม");
    expect(out).toContain('"text":"1"');
    expect(out).toContain('"text":"2"');
    expect(out).toContain('"text":"09:00"');
    expect(out).toContain('"text":"พรุ่งนี้"');
    expect(out).toContain('"text":"จ่ายค่าห้อง"');
    expect(out).toContain('"text":"ทุกวันศุกร์"');
    // how to cancel one, by its number
    expect(out).toContain("ยกเลิกเตือน 1");
  });

  it("the group's latest entries show what, how much and who paid", () => {
    const out = json(
      buildGroupRecentCard([
        { title: "ข้าว", amountSatang: 12000, payer: "แอน" },
        { title: "น้ำมัน", amountSatang: 50050, payer: "บอบ" },
      ]),
    );
    expect(out).toContain("รายการล่าสุดของกลุ่ม");
    expect(out).toContain('"text":"ข้าว"');
    expect(out).toContain("฿120");
    expect(out).toContain("฿500.50");
    expect(out).toContain('"text":"แอน"');
  });

  it("the trips that ended show their name, day and total", () => {
    const out = json(
      buildGroupTripsCard([
        { name: "ทริปเชียงใหม่", closedAt: "2026-10-20T05:00:00Z", totalSatang: 1250000 },
      ]),
    );
    expect(out).toContain("ทริปที่จบแล้ว");
    expect(out).toContain('"text":"ทริปเชียงใหม่"');
    expect(out).toContain("20 ต.ค. 2569");
    expect(out).toContain("฿12,500");
  });
});

describe("the list cards are as narrow and as plain as the reminder card", () => {
  const cards = {
    notes: buildNoteListCard({
      title: "โน้ตล่าสุด",
      items: [note(1, "ซื้อนม")],
      url: "https://liff.line.me/x/notes",
    }),
    files: buildFilesPageCard("https://liff.line.me/x/files"),
    groupReminders: buildGroupRemindersCard({
      items: [{ id: "a", body: "ประชุม", remindAt: "2026-10-29T02:00:00Z", repeat: null }],
    }),
    groupRecent: buildGroupRecentCard([{ title: "ข้าว", amountSatang: 12000, payer: "แอน" }]),
    groupTrips: buildGroupTripsCard([{ name: "ทริป", closedAt: null, totalSatang: 100 }]),
  };

  it.each(Object.entries(cards))(
    "%s: kilo, a one-line header, no big filled button",
    (_n, card) => {
      expect(bubble(card).size).toBe("kilo");
      // title (and a short count on the right), no emoji as big as the title
      const head = bubble(card).header.contents;
      expect(head.length).toBeLessThanOrEqual(2);
      expect(json(card)).not.toContain('"style":"primary"');
      expect(json(card)).not.toContain('cornerRadius":"26px');
    },
  );

  it("the reminder list card too", async () => {
    const { buildReminderListCard } = await import("./reminder-flex");
    const card = buildReminderListCard({
      items: [
        {
          id: "a",
          body: "x",
          remindAt: "2026-10-29T02:00:00Z",
          repeat: null,
          status: "active",
          category: null,
        },
      ],
      total: 1,
      listUrl: "https://liff.line.me/x/reminders",
    });
    expect(bubble(card).size).toBe("kilo");
    expect(bubble(card).header.contents.length).toBeLessThanOrEqual(2);
    expect(json(card)).not.toContain('"style":"primary"');
  });
});

describe("the icon in a card's header", () => {
  const title = (m: unknown) =>
    (m as { contents: { header: { contents: { text?: string }[] } } }).contents.header.contents[0]
      ?.text;

  it("notes have a notebook, the files page a folder", () => {
    expect(title(buildNoteListCard({ title: "โน้ตล่าสุด", items: [], url: undefined }))).toBe(
      "📒 โน้ตล่าสุด",
    );
    expect(title(buildFilesPageCard(undefined))).toBe("📁 ไฟล์ของฉัน");
  });

  it("the group's reminders have a clock, its finished trips a pin", () => {
    expect(title(buildGroupRemindersCard({ items: [] }))).toBe("⏰ เตือนของกลุ่ม");
    expect(title(buildGroupTripsCard([]))).toBe("📌 ทริปที่จบแล้ว");
  });
});
