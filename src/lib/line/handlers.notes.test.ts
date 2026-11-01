import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteDto } from "@/lib/note";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";
import { NOT_FOUND_TEXT, NOTE_SECRET_WARNING_TEXT, NOTE_UNDONE_TEXT } from "./messages";

let plan = "free";
let count = 0;
let listed: NoteDto[] = [];
let hasMore = false;
const created: string[] = [];
const searched: (string | undefined)[] = [];
const entries: string[] = [];
const deleted: string[] = [];
let noteExists = true;

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
  getSettings: async () => ({
    confirm_style: "off",
    budget_cycle: "monthly",
    cycle_start_day: 1,
  }),
  loadCategories: async () => [],
  loadMemoryFor: async () => [],
  insertTransaction: async (_db: unknown, input: Record<string, unknown>) => {
    entries.push(String(input.title));
    return {
      id: "t1",
      status: input.status,
      type: input.type,
      title: input.title,
      amount: "1.00",
      occurred_at: new Date().toISOString(),
      category_id: null,
      slip_id: null,
    };
  },
}));
vi.mock("@/lib/note-repo", () => ({
  countNotes: async () => count,
  createNote: async (_db: unknown, _u: string, body: string) => {
    created.push(body);
    return { id: "n", body, createdAt: "2026-10-30T05:00:00Z", updatedAt: "2026-10-30T05:00:00Z" };
  },
  listNotes: async (_db: unknown, _u: string, o: { q?: string }) => {
    searched.push(o.q);
    return { items: listed, hasMore };
  },
  deleteNote: async (_db: unknown, _u: string, id: string) => {
    deleted.push(id);
    return noteExists;
  },
}));

const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U" + "a".repeat(32) },
  message: { type: "text", id: "1", text: t },
});
function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-10-30T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  ((reply.mock.calls[0]?.[1] ?? []) as { text?: string }[]).map((m) => m.text).join("\n");

const note = (n: number, body: string): NoteDto => ({
  id: `n${n}`,
  body,
  createdAt: "2026-10-29T05:00:00Z",
  updatedAt: "2026-10-29T05:00:00Z",
});

beforeEach(() => {
  plan = "free";
  count = 0;
  listed = [];
  hasMore = false;
  created.length = 0;
  searched.length = 0;
  entries.length = 0;
  deleted.length = 0;
  noteExists = true;
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("saving a note from the chat", () => {
  it("saves it for everybody, answers with a preview and where to see them all", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต ซื้อนม รหัสไวไฟ 1234"), deps);
    expect(created).toEqual(["ซื้อนม รหัสไวไฟ 1234"]);
    expect(said(reply)).toContain("จดโน้ตแล้ว");
    expect(said(reply)).toContain('"ซื้อนม รหัสไวไฟ 1234"');
    expect(said(reply)).toContain("https://liff.line.me/1234-abcd/notes");
  });

  it("keeps the line breaks, and shows only the first line as the preview", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต ของที่ต้องซื้อ\nนม\nไข่"), deps);
    expect(created).toEqual(["ของที่ต้องซื้อ\nนม\nไข่"]);
    expect(said(reply)).toContain('"ของที่ต้องซื้อ"');
  });

  it("stops at the plan's number of notes and says how to get more", async () => {
    count = 30;
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต อีกอัน"), deps);
    expect(created).toHaveLength(0);
    expect(said(reply)).toContain("โน้ตเต็ม 30 รายการ");
    plan = "plus";
    count = 30;
    await handleEvent(say("โน้ต อีกอัน"), setup().deps);
    expect(created).toEqual(["อีกอัน"]);
  });

  it("refuses a note over 2,000 characters", async () => {
    const { deps, reply } = setup();
    await handleEvent(say(`โน้ต ${"ก".repeat(2001)}`), deps);
    expect(created).toHaveLength(0);
    expect(said(reply)).toContain("ยาวเกิน 2,000");
  });

  it("a notebook is still an expense, not a note", async () => {
    const { deps } = setup();
    await handleEvent(say("โน้ตบุ๊ก 25000"), deps);
    expect(created).toHaveLength(0);
    expect(entries).toEqual(["โน้ตบุ๊ก"]);
  });
});

describe("taking a note back", () => {
  const NOTE_ID = "11111111-1111-1111-1111-111111111111";
  const tap = (data: string): LineEvent => ({
    type: "postback",
    replyToken: "rt",
    source: { type: "user", userId: "U" + "a".repeat(32) },
    postback: { data },
  });
  const firstMessage = (reply: ReturnType<typeof setup>["reply"]) =>
    reply.mock.calls[0]?.[1]?.[0] as {
      quickReply?: { items: { action: { data?: string } }[] };
    };

  it("offers undo on a saved note", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต ซื้อนม"), deps);
    expect(firstMessage(reply).quickReply?.items[0]?.action.data).toBe("a=ntx&id=n");
  });

  it("undo deletes that note", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap(`a=ntx&id=${NOTE_ID}`), deps);
    expect(deleted).toEqual([NOTE_ID]);
    expect(said(reply)).toBe(NOTE_UNDONE_TEXT);
  });

  it("undo of a note that is gone says so", async () => {
    noteExists = false;
    const { deps, reply } = setup();
    await handleEvent(tap(`a=ntx&id=${NOTE_ID}`), deps);
    expect(said(reply)).toBe(NOT_FOUND_TEXT);
  });

  it("warns when the note looks secret", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต รหัสไวไฟ 1234"), deps);
    expect(said(reply)).toContain(NOTE_SECRET_WARNING_TEXT);
  });

  it("does not warn on an ordinary note", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต ซื้อนม"), deps);
    expect(said(reply)).not.toContain(NOTE_SECRET_WARNING_TEXT);
  });
});

describe("listing and searching", () => {
  it("โน้ต alone lists the latest, or says there are none", async () => {
    const empty = setup();
    await handleEvent(say("โน้ต"), empty.deps);
    expect(said(empty.reply)).toContain("ยังไม่มีโน้ต");
    listed = [note(1, "ซื้อนม\nไข่"), note(2, "รหัสไวไฟ 1234")];
    const { deps, reply } = setup();
    await handleEvent(say("โน้ต"), deps);
    expect(said(reply)).toContain("โน้ตล่าสุด");
    expect(said(reply)).toContain("ซื้อนม");
    expect(said(reply)).not.toContain("ไข่"); // only the first line
    expect(said(reply)).toContain("รหัสไวไฟ 1234");
  });

  it("ค้นหาโน้ต finds by the word and links to the page with it typed", async () => {
    listed = [note(1, "รหัสไวไฟ 1234")];
    const { deps, reply } = setup();
    await handleEvent(say("ค้นหาโน้ต ไวไฟ"), deps);
    expect(searched).toEqual(["ไวไฟ"]);
    expect(said(reply)).toContain('โน้ตที่มี "ไวไฟ"');
    expect(said(reply)).toContain("รหัสไวไฟ 1234");
    expect(said(reply)).toContain(`/notes?q=${encodeURIComponent("ไวไฟ")}`);
  });

  it("says when nothing matches, and how to search when no word was given", async () => {
    const none = setup();
    await handleEvent(say("ค้นหาโน้ต ไม่มีคำนี้"), none.deps);
    expect(said(none.reply)).toContain('ไม่เจอโน้ตที่มีคำว่า "ไม่มีคำนี้"');
    const usage = setup();
    await handleEvent(say("ค้นหาโน้ต"), usage.deps);
    expect(said(usage.reply)).toContain("ค้นหาโน้ต ไวไฟ");
  });
});
