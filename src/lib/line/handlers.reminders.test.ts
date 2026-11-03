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
vi.mock("@/lib/user-reminder-repo", () => ({
  countActiveReminders: async (_db: unknown, _u: string, kind?: string) =>
    kind === "repeat" ? repeating : active,
  listReminders: async () => listed,
  createReminder: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return { id: ID, body: input.body, remindAt: String(input.remindAt), repeat: input.repeat };
  },
  getReminder: async () => stored,
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
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("setting a reminder from the chat", () => {
  it("saves it and answers with a card that says when, and has a cancel button", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ"), deps);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: "จ่ายค่าไฟ", repeat: null });
    expect((created[0]?.remindAt as Date).toISOString()).toBe("2026-10-29T02:00:00.000Z");
    expect(sent(reply)[0]?.type).toBe("flex");
    expect(said(reply)).toContain('"text":"09:00"');
    expect(said(reply)).toContain('"text":"พรุ่งนี้"');
    expect(said(reply)).toContain(`a=rmx&id=${ID}`);
    expect(said(reply)).toContain("https://liff.line.me/1234-abcd/reminders");
  });

  it("a repeating one, and a day with no time (09:00 used and said so)", async () => {
    const a = setup();
    await handleEvent(say("เตือน ทุกวัน 8 โมง กินยา"), a.deps);
    expect(created[0]).toMatchObject({ body: "กินยา", repeat: "daily" });
    const b = setup();
    await handleEvent(say("เตือน พรุ่งนี้ จ่ายค่าเน็ต"), b.deps);
    expect(said(b.reply)).toContain("ใช้ 09:00");
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

  it("Free holds 3 waiting reminders, Pro 30", async () => {
    active = 3;
    const free = setup();
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง อีกอัน"), free.deps);
    expect(created).toHaveLength(0);
    expect(said(free.reply)).toContain("ครบ 3 รายการ");
    plan = "plus";
    await handleEvent(say("เตือน พรุ่งนี้ 9 โมง อีกอัน"), setup().deps);
    expect(created).toHaveLength(1);
  });

  it("a repeating reminder has its own limit: Free holds 1", async () => {
    repeating = 1;
    const full = setup();
    await handleEvent(say("เตือน ทุกวัน 8 โมง กินยา"), full.deps);
    expect(created).toHaveLength(0);
    expect(said(full.reply)).toContain("เตือนประจำ");
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
    expect(said(reply)).toContain("เตือนที่รออยู่");
    expect(said(reply)).toContain("29 ต.ค. 2569 09:00  จ่ายค่าไฟ");
    expect(said(reply)).toContain("· ทุกวัน  กินยา");
    expect(said(reply)).toContain("https://liff.line.me/1234-abcd/reminders");
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

  it("🌅 พรุ่งนี้เช้า is 09:00 tomorrow", async () => {
    stored = once();
    const { deps, reply } = setup();
    await handleEvent(tap(`a=rms&id=${ID}&s=tm`), deps);
    expect(snoozed).toEqual([[ID, "2026-10-29T02:00:00.000Z"]]);
    expect(said(reply)).toBe("ได้เลย เดี๋ยวเตือนอีกทีพรุ่งนี้ 09:00 นะ 🌅");
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
