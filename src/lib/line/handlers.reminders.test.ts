import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderDto } from "@/lib/user-reminder";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";
import {
  REMINDER_CANCELLED_TEXT,
  REMINDER_GONE_TEXT,
  REMINDER_HANDLED_TEXT,
  REMINDER_NO_TEXT_TEXT,
  REMINDER_PAST_TEXT,
  REMINDER_TOO_FAR_TEXT,
  REMINDER_USAGE_TEXT,
} from "./messages";

let plan = "free";
let locale = "th";
let active = 0;
let repeating = 0;
let listed: ReminderDto[] = [];
let cancelFound = true;
const created: Record<string, unknown>[] = [];
const cancelled: string[] = [];
let stored: ReminderDto | null = null;
let snoozeFound = true;
const snoozed: [string, string][] = [];
const ticked: string[] = [];
const rescheduled: [string, string][] = [];
const ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
    locale,
  }),
}));
const PENDING = "22222222-2222-4222-8222-222222222222";
let held: { text: string } | null = null;
vi.mock("@/lib/pending-intent-repo", () => ({
  putPendingIntent: async (_db: unknown, _u: string, input: { text: string }) => {
    held = input;
    return PENDING;
  },
  takePendingIntent: async () => {
    const h = held;
    held = null;
    return h ? { id: PENDING, input: h.text, decision: null } : null;
  },
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  countActiveReminders: async (_db: unknown, _u: string, kind?: string) =>
    kind === "repeat" ? repeating : active,
  listReminders: async () => listed,
  createReminder: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return { id: ID, body: input.body, remindAt: String(input.remindAt), repeat: input.repeat };
  },
  getReminder: async () => stored,
  rescheduleReminder: async (_db: unknown, _u: string, id: string, input: { remindAt: Date }) => {
    rescheduled.push([id, input.remindAt.toISOString()]);
    return stored ? { ...stored, remindAt: input.remindAt.toISOString() } : null;
  },
  snoozeReminder: async (_db: unknown, _u: string, id: string, at: Date) => {
    snoozed.push([id, at.toISOString()]);
    return snoozeFound ? { ...stored, status: "active", remindAt: at.toISOString() } : null;
  },
  setReminderDone: async (_db: unknown, _u: string, id: string) => {
    ticked.push(id);
    return true;
  },
  cancelReminder: async (_db: unknown, _u: string, id: string) => {
    cancelled.push(id);
    return cancelFound;
  },
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});
const tap = (data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  postback: { data },
});
function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    // Wednesday 28 Oct 2026, 10:00 in Bangkok
    now: () => new Date("2026-10-28T03:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const sent = (reply: ReturnType<typeof setup>["reply"]) =>
  (reply.mock.calls[0]?.[1] ?? []) as { type: string; text?: string }[];
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  sent(reply)
    .map((m) => m.text ?? JSON.stringify(m))
    .join("\n");

beforeEach(() => {
  plan = "free";
  locale = "th";
  repeating = 0;
  active = 0;
  listed = [];
  cancelFound = true;
  created.length = 0;
  cancelled.length = 0;
  stored = null;
  snoozeFound = true;
  snoozed.length = 0;
  ticked.length = 0;
  rescheduled.length = 0;
  held = null;
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("setting a reminder from the chat", () => {
  it("saves it and answers with a card that says when, and has a cancel button", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ"), deps);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: "จ่ายค่าไฟ", repeat: null, via: "chat" });
    expect((created[0]?.remindAt as Date).toISOString()).toBe("2026-10-29T02:00:00.000Z");
    expect(sent(reply)[0]?.type).toBe("flex");
    expect(said(reply)).toContain('"text":"09:00"');
    expect(said(reply)).toContain('"text":"พรุ่งนี้"');
    expect(said(reply)).toContain(`a=rmx&id=${ID}`);
    expect(said(reply)).toContain("https://liff.line.me/1234-abcd/reminders");
  });

  it("a repeating one, and a day with no time (09:00 used and said so)", async () => {
    plan = "starter"; // Free has no repeating reminder
    const a = setup();
    await handleEvent(say("เตือน ทุกวัน 8 โมง กินยา"), a.deps);
    expect(created[0]).toMatchObject({ body: "กินยา", repeat: "daily" });
    const b = setup();
    await handleEvent(say("เตือน พรุ่งนี้ จ่ายค่าเน็ต"), b.deps);
    expect(said(b.reply)).toContain("ตั้งเป็น 08:30");
  });

  it("tells what is wrong instead of saving: no text, a time gone by, no time at all", async () => {
    const a = setup();
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง"), a.deps);
    expect(said(a.reply)).toBe(REMINDER_NO_TEXT_TEXT);
    const b = setup();
    await handleEvent(say("เตือน วันนี้ 8 โมง ประชุม"), b.deps);
    expect(said(b.reply)).toBe(REMINDER_PAST_TEXT);
    const c = setup();
    await handleEvent(say("เตือน จ่ายค่าไฟ"), c.deps);
    expect(said(c.reply)).toBe(REMINDER_USAGE_TEXT);
    expect(created).toHaveLength(0);
  });

  it("Free holds 3 waiting reminders, Pro more", async () => {
    active = 3;
    const free = setup();
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง อีกอัน"), free.deps);
    expect(created).toHaveLength(0);
    expect(said(free.reply)).toContain("ครบ 3 รายการ");
    plan = "plus";
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง อีกอัน"), setup().deps);
    expect(created).toHaveLength(1);
  });

  it('Free has no repeating reminder: it says so plainly (not "0 of 0"), a one-off still works', async () => {
    const full = setup();
    await handleEvent(say("เตือน ทุกวัน 8 โมง กินยา"), full.deps);
    expect(created).toHaveLength(0);
    expect(said(full.reply)).toContain("ตั้งเตือนประจำ (เตือนซ้ำ) ไม่ได้");
    expect(said(full.reply)).not.toContain("ครบ 0");
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ"), setup().deps);
    expect(created).toHaveLength(1);
  });

  it("เตือนใจ 100 is still an entry, not a reminder", async () => {
    const { deps } = setup();
    // it goes on to the entry flow, which needs a real database: only the reminder side is checked
    await handleEvent(say("เตือนใจ 100"), deps).catch(() => undefined);
    expect(created).toHaveLength(0);
  });
});

describe("listing and cancelling", () => {
  it("เตือน alone lists what is waiting, or says there is none and shows how to set one", async () => {
    const none = setup();
    await handleEvent(say("เตือน"), none.deps);
    expect(said(none.reply)).toContain("ยังไม่มีเตือน");
    expect(said(none.reply)).toContain("เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ");
    listed = [
      {
        id: "a",
        body: "จ่ายค่าไฟ",
        remindAt: "2026-10-29T02:00:00Z",
        repeat: null,
        status: "active",
        category: null,
      },
      {
        id: "b",
        body: "กินยา",
        remindAt: "2026-10-29T01:00:00Z",
        repeat: "daily",
        status: "active",
        category: null,
      },
    ];
    const { deps, reply } = setup();
    await handleEvent(say("เตือน"), deps);
    const card = JSON.stringify(reply.mock.calls[0]?.[1]);
    expect(card).toContain('"type":"flex"');
    expect(card).toContain("เตือนที่รออยู่");
    expect(card).toContain('"text":"จ่ายค่าไฟ"');
    expect(card).toContain('"text":"กินยา"');
    expect(card).toContain("https://liff.line.me/1234-abcd/reminders");
  });

  it("the cancel button removes it, and a second tap finds it gone", async () => {
    const a = setup();
    await handleEvent(tap(`a=rmx&id=${ID}`), a.deps);
    expect(cancelled).toEqual([ID]);
    expect(said(a.reply)).toBe(REMINDER_CANCELLED_TEXT);
    cancelFound = false;
    const b = setup();
    await handleEvent(tap(`a=rmx&id=${ID}`), b.deps);
    expect(said(b.reply)).toBe(REMINDER_GONE_TEXT);
  });

  it("a made-up id never reaches the database", async () => {
    await handleEvent(tap("a=rmx&id=../x"), setup().deps);
    expect(cancelled).toHaveLength(0);
  });
});

describe("the buttons under a reminder that was sent", () => {
  const once = (over: Partial<ReminderDto> = {}): ReminderDto => ({
    id: ID,
    body: "ส่งรายงาน",
    remindAt: "2026-10-28T02:55:00Z",
    repeat: null,
    status: "done",
    category: "work",
    ...over,
  });

  it("✅ ทำแล้ว closes a one-off", async () => {
    stored = once();
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rmd&id=${ID}`), deps);
    expect(said(reply)).toBe("เยี่ยมเลย ✅ ปิดเตือนนี้แล้ว");
    expect(ticked).toEqual([]);
  });

  it("✅ ทำแล้ว left over, on a one-off since moved to another time, leaves it waiting", async () => {
    stored = once({ status: "active", remindAt: "2026-10-29T03:10:00Z" });
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rmd&id=${ID}`), deps);
    expect(ticked).toEqual([]);
    expect(said(reply)).toBe(REMINDER_HANDLED_TEXT);
  });

  it("✅ ทำแล้ว on a repeating one says when the next round is", async () => {
    stored = once({ repeat: "daily", status: "active", remindAt: "2026-10-29T01:00:00Z" });
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rmd&id=${ID}`), deps);
    expect(said(reply)).toBe("เยี่ยมเลย ✅ รอบหน้าเตือนอีกที พรุ่งนี้ 08:00");
    expect(ticked).toEqual([]);
  });

  it("⏰ อีก 10 นาที brings a one-off back at that time", async () => {
    stored = once();
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=10`), deps);
    expect(snoozed).toEqual([[ID, "2026-10-28T03:10:00.000Z"]]);
    expect(said(reply)).toBe("ได้เลย เดี๋ยวเตือนอีกทีตอน 10:10 นะ ⏰");
    expect(created).toHaveLength(0);
  });

  it("🌅 พรุ่งนี้เช้า is 08:30 tomorrow", async () => {
    stored = once();
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=tm`), deps);
    expect(snoozed).toEqual([[ID, "2026-10-29T01:30:00.000Z"]]);
    expect(said(reply)).toBe("ได้เลย เดี๋ยวเตือนอีกทีพรุ่งนี้ 08:30 นะ 🌅");
  });

  it("a repeating one gets this round again as a one-off, and keeps its rounds", async () => {
    stored = once({ repeat: "daily", status: "active", remindAt: "2026-10-29T01:00:00Z" });
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=60`), deps);
    expect(snoozed).toEqual([]);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: "ส่งรายงาน", repeat: null, category: "work" });
    expect((created[0]?.remindAt as Date).toISOString()).toBe("2026-10-28T04:00:00.000Z");
    expect(said(reply)).toBe("ได้เลย เดี๋ยวเตือนอีกทีตอน 11:00 นะ ⏰");
  });

  it("a repeating one's extra round needs room for a one-off", async () => {
    stored = once({ repeat: "daily", status: "active" });
    active = 3;
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=10`), deps);
    expect(created).toHaveLength(0);
    expect(said(reply)).toContain("ครบ 3 รายการ");
  });

  it("a second tap, or a reminder that has gone, is already handled", async () => {
    stored = once();
    snoozeFound = false;
    const a = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=10`), a.deps);
    expect(said(a.reply)).toBe(REMINDER_HANDLED_TEXT);
    stored = null;
    const b = setup();
    await handleEvent(tap(`a=rmd&id=${ID}`), b.deps);
    expect(said(b.reply)).toBe(REMINDER_HANDLED_TEXT);
    const c = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=10`), c.deps);
    expect(said(c.reply)).toBe(REMINDER_HANDLED_TEXT);
  });

  it("a made-up id or snooze never reaches the database", async () => {
    stored = once();
    await handleEvent(tap("a=rmd&id=../x"), setup().deps);
    await handleEvent(tap(`a=rms&id=${ID}&s=999`), setup().deps);
    expect(snoozed).toHaveLength(0);
    expect(ticked).toHaveLength(0);
  });
});

describe("someone who chose English", () => {
  it("sets a reminder typed in English; the same words from a Thai user are not read as one", async () => {
    const { withZoneScope } = await import("@/lib/zone-scope");
    locale = "en";
    const a = setup();
    await withZoneScope(() => handleEvent(say("remind me tomorrow 9am pay rent"), a.deps));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: "pay rent", repeat: null });
    expect((created[0]?.remindAt as Date).toISOString()).toBe("2026-10-29T02:00:00.000Z");
    locale = "th";
    const b = setup();
    // read as an entry instead (which this test's database cannot save): no reminder either way
    await withZoneScope(() =>
      handleEvent(say("remind me tomorrow 9am pay rent"), b.deps).catch(() => undefined),
    );
    expect(created).toHaveLength(1);
  });
});

describe("after a reminder was changed on its page", () => {
  it("the chat gets its card, saying it was changed", async () => {
    listed = [
      {
        id: ID,
        body: "ไปทำงาน",
        remindAt: "2026-10-29T03:10:00Z",
        repeat: null,
        status: "active",
        category: null,
      },
    ];
    const { deps, reply } = setup();
    await handleEvent(say(`แก้ไขเตือนเสร็จแล้ว #${ID.slice(0, 8)}`), deps);
    expect(sent(reply)[0]?.type).toBe("flex");
    expect(said(reply)).toContain("แก้ไขเตือนแล้ว");
    expect(said(reply)).toContain('"text":"10:10"');
    expect(said(reply)).toContain('"text":"ไปทำงาน"');
  });

  it("one that is gone says so", async () => {
    listed = [];
    const { deps, reply } = setup();
    await handleEvent(say("แก้ไขเตือนเสร็จแล้ว #deadbeef"), deps);
    expect(said(reply)).toBe(REMINDER_GONE_TEXT);
  });
});

describe("a weekday that does not fall on the nearest date asks first", () => {
  const buttons = (reply: ReturnType<typeof setup>["reply"]) => JSON.stringify(sent(reply));

  it("asks, naming both dates, and saves nothing yet", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เตือนวันอาทิตย์ 27 ไปกินข้าวกับเพื่อน"), deps);
    expect(created).toHaveLength(0);
    expect(said(reply)).toContain("27 พ.ย. 2569");
    expect(said(reply)).toContain("วันศุกร์");
    expect(said(reply)).toContain("27 ธ.ค. 2569");
    expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=on:2026-12-27`);
    expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=on:2026-11-27`);
    expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=retype`);
  });

  it.each([
    ["on:2026-12-27", "2026-12-27T01:30:00.000Z"],
    ["on:2026-11-27", "2026-11-27T01:30:00.000Z"],
  ])("a tap on %s saves it on that day at 08:30", async (pick, at) => {
    await handleEvent(say("เตือนวันอาทิตย์ 27 ไปกินข้าวกับเพื่อน"), setup().deps);
    const { deps, reply } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=${pick}`), deps);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: "ไปกินข้าวกับเพื่อน" });
    expect((created[0]?.remindAt as Date).toISOString()).toBe(at);
    expect(said(reply)).toContain("ตั้งเตือนแล้ว");
  });

  it("a tap on พิมพ์วันใหม่ saves nothing and says how", async () => {
    await handleEvent(say("เตือนวันอาทิตย์ 27 ไปกินข้าวกับเพื่อน"), setup().deps);
    const { deps, reply } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=retype`), deps);
    expect(created).toHaveLength(0);
    expect(said(reply)).toContain("วันที่และเดือน");
  });

  it("no Saturday the 27th soon: offers the nearest 27th", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เตือนวันเสาร์ 27 งานแต่ง"), deps);
    expect(created).toHaveLength(0);
    expect(buttons(reply)).toContain("p=on:2026-11-27");
    expect(buttons(reply)).not.toContain("p=on:2026-12");
  });

  it.each(["on:2099-01-01", "on:2026-02-31", "on:2026-11-20"])(
    "a day that was not offered (%s) saves nothing",
    async (pick) => {
      await handleEvent(say("เตือนวันอาทิตย์ 27 ไปกินข้าวกับเพื่อน"), setup().deps);
      await handleEvent(tap(`a=irp&id=${PENDING}&p=${pick}`), setup().deps);
      expect(created).toHaveLength(0);
    },
  );

  it("a weekday that is right is saved at once", async () => {
    await handleEvent(say("เตือนวันศุกร์ 27 งานเลี้ยง"), setup().deps);
    expect(created).toHaveLength(1);
  });
});

describe("เปลี่ยนเวลา with LINE's picker", () => {
  const pick = (datetime: string): LineEvent => ({
    type: "postback",
    replyToken: "rt",
    source: { type: "user", userId: "U" + "a".repeat(32) },
    postback: { data: `a=rmt&id=${ID}`, params: { datetime } },
  });
  const waiting = (over: Partial<ReminderDto> = {}): ReminderDto => ({
    id: ID,
    body: "ไปกินข้าวกับเพื่อน",
    remindAt: "2026-12-27T01:30:00Z",
    repeat: null,
    status: "active",
    category: null,
    ...over,
  });

  it("moves it to the time picked (Bangkok) and answers with a line and a fresh card", async () => {
    stored = waiting();
    const { deps, reply } = setup();
    await handleEvent(pick("2026-11-29T11:00"), deps);
    expect(rescheduled).toEqual([[ID, "2026-11-29T04:00:00.000Z"]]);
    expect(said(reply)).toContain("ไปกินข้าวกับเพื่อน");
    expect(said(reply)).toContain("29 พ.ย. 2569 11:00");
    expect(said(reply)).toContain("แก้ไขเตือนแล้ว");
  });

  it("takes a small t too, as LINE may send", async () => {
    stored = waiting();
    await handleEvent(pick("2026-11-29t11:00"), setup().deps);
    expect(rescheduled).toEqual([[ID, "2026-11-29T04:00:00.000Z"]]);
  });

  it("a repeating one keeps repeating from the new time", async () => {
    stored = waiting({ repeat: "daily" });
    await handleEvent(pick("2026-11-29T07:15"), setup().deps);
    expect(rescheduled).toEqual([[ID, "2026-11-29T00:15:00.000Z"]]);
  });

  it.each([
    ["a time already gone", waiting(), "2026-10-28T09:00", REMINDER_PAST_TEXT],
    ["more than a year ahead", waiting(), "2028-01-01T09:00", REMINDER_TOO_FAR_TEXT],
    [
      "a reminder already sent",
      waiting({ status: "done" }),
      "2026-11-29T11:00",
      REMINDER_GONE_TEXT,
    ],
    ["a reminder that is gone", null, "2026-11-29T11:00", REMINDER_GONE_TEXT],
    ["no time from the picker", waiting(), "", REMINDER_GONE_TEXT],
  ])("%s changes nothing", async (_name, s, datetime, answer) => {
    stored = s;
    const { deps, reply } = setup();
    await handleEvent(pick(datetime), deps);
    expect(rescheduled).toEqual([]);
    expect(said(reply)).toBe(answer);
  });
});
