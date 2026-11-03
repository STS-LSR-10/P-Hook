import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupRow } from "@/lib/group";
import type { GroupReminder } from "@/lib/user-reminder-repo";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

const GID = "C-group-1";
const NOW = new Date("2026-10-18T05:00:00Z");

let group: GroupRow | null = null;
let ownerPlan = "ultimate";
let waits = new Map<string, { name: string | null }>();
let saved: { owner: string; name: string | null; group?: { groupId: string; savedBy: string } }[] =
  [];
let saveOutcome: "ok" | "full" = "ok";
let groupFiles: { id: string; name: string }[] = [];
let listCalls: { groupId?: string; q?: string }[] = [];
let reminders: (GroupReminder & { groupId: string })[] = [];
let activeCount = 0;
let created: {
  userId: string;
  body: string;
  groupId?: string;
  createdBy?: string;
  mentions?: unknown;
}[] = [];
let owlTaken = 0;
let owlRefunded = 0;
let owlAllowed = true;
let slipChecks = 0;
const removed: string[] = [];
let ridersTaken = 0;
let takenWhenListed = -1;
let riders: {
  body: string;
  repeat: string | null;
  mentions: unknown[];
  dueAt: string;
  late: boolean;
}[] = [];
let lateAdded: unknown[] = [];
let noteCount = 0;
let notes: { id: string; body: string; createdBy: string | null; userId: string }[] = [];
let noteCalls: { userId?: string; body?: string; group?: unknown; q?: string }[] = [];

vi.mock("@/lib/group-repo", () => ({
  getGroup: async () => group,
  getOwner: async () => ({ lineUserId: "Uowner", plan: ownerPlan, planExpiresAt: null }),
  memberNames: async () => new Map([["Uanna", { name: "แอน", updatedAt: NOW.toISOString() }]]),
  upsertMember: async () => undefined,
  removeMembers: async (_db: unknown, _g: string, ids: string[]) => {
    removed.push(...ids);
  },
  payerTotals: async () => [{ lineUserId: "Uanna", totalSatang: 45000, entries: 3 }],
  recentEntries: async () => [],
  openTrip: async () => null,
  tripEntries: async () => [],
}));
vi.mock("@/lib/split-bill-repo", async (original) => ({
  ...(await original<typeof import("@/lib/split-bill-repo")>()),
  listBills: async () => [],
}));
vi.mock("./split-bill-slip", () => ({
  checkGroupSlip: async () => {
    slipChecks += 1;
  },
}));
vi.mock("@/lib/file-repo", async (original) => ({
  ...(await original<typeof import("@/lib/file-repo")>()),
  startGroupFileWait: async (_db: unknown, g: string, u: string, name: string | null) => {
    waits.set(`${g}/${u}`, { name });
  },
  takeGroupFileWait: async (_db: unknown, g: string, u: string) => {
    const w = waits.get(`${g}/${u}`) ?? null;
    waits.delete(`${g}/${u}`);
    return w;
  },
  listGroupFiles: async (_db: unknown, groupId: string, options: { q?: string }) => {
    listCalls.push({ groupId, q: options.q });
    const items = groupFiles
      .filter((f) => !options.q || f.name.includes(options.q))
      .map((f) => ({
        ...f,
        mimeType: "application/pdf",
        sizeBytes: 100,
        createdAt: NOW.toISOString(),
        hasThumb: false,
      }));
    return { items, hasMore: false };
  },
}));
vi.mock("@/lib/file-save", () => ({
  saveFile: async (
    _deps: unknown,
    owner: { id: string },
    _media: unknown,
    name: string | null,
    g?: { groupId: string; savedBy: string },
  ) => {
    if (saveOutcome === "full") return { ok: false, reason: "full" };
    saved.push({ owner: owner.id, name, group: g });
    return {
      ok: true,
      file: {
        id: "f1",
        name: name ?? "file.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        createdAt: NOW.toISOString(),
        hasThumb: false,
      },
    };
  },
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  countActiveReminders: async () => activeCount,
  createReminder: async (
    _db: unknown,
    userId: string,
    input: {
      body: string;
      remindAt: Date;
      repeat: null;
      groupId?: string;
      createdBy?: string;
      mentions?: unknown[];
    },
  ) => {
    created.push({
      userId,
      body: input.body,
      groupId: input.groupId,
      createdBy: input.createdBy,
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
    });
    return {
      id: "r-new",
      body: input.body,
      remindAt: input.remindAt.toISOString(),
      repeat: input.repeat,
      status: "active",
      category: null,
    };
  },
  listGroupReminders: async (_db: unknown, groupId: string) => {
    takenWhenListed = ridersTaken;
    return reminders.filter((r) => r.groupId === groupId);
  },
  cancelGroupReminder: async (_db: unknown, groupId: string, id: string) => {
    const before = reminders.length;
    reminders = reminders.filter((r) => !(r.id === id && r.groupId === groupId));
    return reminders.length < before;
  },
}));
vi.mock("@/lib/group-reminder-repo", () => ({
  takeGroupRiders: async () => {
    ridersTaken += 1;
    const out = riders;
    riders = [];
    return out;
  },
  addLateReminder: async (_db: unknown, input: unknown) => {
    lateAdded.push(input);
  },
}));
vi.mock("@/lib/note-repo", () => ({
  countNotes: async () => noteCount,
  createNote: async (_db: unknown, userId: string, body: string, g?: unknown) => {
    noteCalls.push({ userId, body, group: g });
    return { id: "n-new", body, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
  },
  listGroupNotes: async (_db: unknown, groupId: string, options: { q?: string }) => {
    noteCalls.push({ q: options.q });
    const items = notes
      .filter((n) => groupId === "g1" && (!options.q || n.body.includes(options.q)))
      .map((n) => ({ ...n, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }));
    return { items, hasMore: false };
  },
  getGroupNote: async (_db: unknown, groupId: string, id: string) => {
    const n = notes.find((x) => x.id === id && groupId === "g1");
    return n ? { ...n, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() } : null;
  },
  deleteGroupNote: async (_db: unknown, _g: string, id: string) => {
    const before = notes.length;
    notes = notes.filter((n) => n.id !== id);
    return notes.length < before;
  },
}));
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: async (_db: unknown, userId: string, kind: string) => {
    if (kind === "owl" && userId === "app-owner") owlTaken += 1;
    return owlAllowed;
  },
  refundUsage: async () => {
    owlRefunded += 1;
  },
}));

const message = (userId: string | undefined, m: LineEvent["message"]): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
  message: m,
});
const say = (userId: string | undefined, t: string) =>
  message(userId, { type: "text", id: "1", text: t });
const tap = (userId: string, data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
  postback: { data },
});

function setup(withOwl = true) {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const asked: { question: string; data: string; group?: boolean }[] = [];
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => NOW,
    files: {
      fetchFile: async () => ({ bytes: new Uint8Array(1), mimeType: "application/pdf" }),
      store: {} as never,
    },
    slip: { fetchImage: async () => ({}) as never, ocr: {} as never },
    calendarLink: async (id: string) => `https://app.test/api/calendar/${id}?t=tok`,
    ...(withOwl
      ? {
          owl: {
            name: "fake",
            answer: async (input: { question: string; data: string; group?: boolean }) => {
              asked.push(input);
              return "ตอบแล้ว";
            },
          },
        }
      : {}),
  };
  return { deps, reply, asked };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));

beforeEach(() => {
  process.env.APP_BASE_URL = "https://app.test";
  group = { id: "g1", lineGroupId: GID, ownerUserId: "app-owner", isActive: true };
  ownerPlan = "ultimate";
  waits = new Map();
  saved = [];
  saveOutcome = "ok";
  groupFiles = [];
  listCalls = [];
  reminders = [];
  activeCount = 0;
  created = [];
  owlTaken = 0;
  owlRefunded = 0;
  owlAllowed = true;
  slipChecks = 0;
  removed.length = 0;
  riders = [];
  ridersTaken = 0;
  lateAdded = [];
  noteCount = 0;
  notes = [];
  noteCalls = [];
});

describe("members leaving", () => {
  it("forgets who left, so they no longer see the group's files", async () => {
    const { deps } = setup();
    await handleEvent(
      {
        type: "memberLeft",
        source: { type: "group", groupId: GID },
        left: { members: [{ type: "user", userId: "Ubob" }] },
      },
      deps,
    );
    expect(removed).toEqual(["Ubob"]);
  });
});

describe("files in a group", () => {
  it("'เก็บไฟล์' then a file keeps it for the group, in the owner's space", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เก็บไฟล์ สัญญาเช่า"), deps);
    expect(said(reply)).toContain("คลังไฟล์ของกลุ่ม");
    await handleEvent(
      message("Uanna", { type: "file", id: "m1", fileName: "a.pdf", fileSize: 100 }),
      deps,
    );
    expect(saved).toEqual([
      { owner: "app-owner", name: "สัญญาเช่า", group: { groupId: "g1", savedBy: "Uanna" } },
    ]);
    expect(said(reply)).toContain("/vault?g=g1");
  });

  it("a picture with nobody waiting is still looked at as a slip, and is not kept", async () => {
    const { deps } = setup();
    await handleEvent(message("Uanna", { type: "image", id: "m2" }), deps);
    expect(saved).toEqual([]);
    expect(slipChecks).toBe(1);
  });

  it("only the member who asked has a file kept", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เก็บไฟล์"), deps);
    await handleEvent(message("Ubob", { type: "file", id: "m3", fileName: "b.pdf" }), deps);
    expect(saved).toEqual([]);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("says the owner's space is full", async () => {
    saveOutcome = "full";
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เก็บไฟล์"), deps);
    await handleEvent(message("Uanna", { type: "file", id: "m4", fileName: "c.pdf" }), deps);
    expect(said(reply)).toContain("พื้นที่เก็บไฟล์ของเจ้าของสมุดเต็มแล้ว");
  });

  it("is paused when the owner is no longer on Elite", async () => {
    ownerPlan = "plus";
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เก็บไฟล์"), deps);
    expect(said(reply)).toContain("หยุดจดชั่วคราว");
    expect(waits.size).toBe(0);
  });

  it("'ไฟล์กลุ่ม' and 'หาไฟล์' list only this group's files", async () => {
    groupFiles = [
      { id: "f1", name: "สัญญาเช่า.pdf" },
      { id: "f2", name: "เมนู.jpg" },
    ];
    const { deps, reply } = setup();
    await handleEvent(say("Ubob", "หาไฟล์ สัญญา"), deps);
    expect(listCalls).toEqual([{ groupId: "g1", q: "สัญญา" }]);
    expect(said(reply)).toContain("สัญญาเช่า.pdf");
    expect(said(reply)).not.toContain("เมนู.jpg");

    groupFiles = [];
    const second = setup();
    await handleEvent(say("Ubob", "ไฟล์กลุ่ม"), second.deps);
    expect(said(second.reply)).toContain("กลุ่มนี้ยังไม่มีไฟล์");
  });
});

describe("reminders in a group", () => {
  it("sets one for the group on the owner's limits", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เตือน พรุ่งนี้ 9 โมง ประชุม"), deps);
    expect(created).toEqual([
      { userId: "app-owner", body: "ประชุม", groupId: "g1", createdBy: "Uanna" },
    ]);
    const out = said(reply);
    expect(out).toContain("ตั้งเตือนกลุ่มแล้ว");
    expect(out).toContain("a=grmx&id=r-new");
    expect(out).toContain("/reminders?g=g1");
    // a free way to be reminded: the phone's own calendar
    expect(out).toContain(
      "https://app.test/api/calendar/r-new?t=tok&to=google&openExternalBrowser=1",
    );
    expect(out).toContain("https://app.test/api/calendar/r-new?t=tok&to=ics&openExternalBrowser=1");
  });

  it("keeps who it tags, and reads a command that tags พี่ฮูก first", async () => {
    const { deps } = setup();
    const t = "@พี่ฮูก เตือน 10 โมง บอกให้ @bot1 กับ @ต้น ส่งงานด้วย";
    await handleEvent(
      message("Uanna", {
        type: "text",
        id: "1",
        text: t,
        mention: {
          mentionees: [
            { index: 0, length: 7, type: "user", userId: "Ubot", isSelf: true },
            { index: t.indexOf("@bot1"), length: 5, type: "user", userId: "U1" },
            { index: t.indexOf("@ต้น"), length: 4, type: "user", userId: "U2" },
          ],
        },
      }),
      deps,
    );
    expect(created).toEqual([
      {
        userId: "app-owner",
        body: "บอกให้ @bot1 กับ @ต้น ส่งงานด้วย",
        groupId: "g1",
        createdBy: "Uanna",
        mentions: [
          { label: "@bot1", userId: "U1" },
          { label: "@ต้น", userId: "U2" },
        ],
      },
    ]);
  });

  it("stays quiet for chat with no time in it", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เตือน ด้วยนะ"), deps);
    expect(created).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });

  it("is refused when the owner's one-off reminders are full", async () => {
    activeCount = 100;
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "เตือน พรุ่งนี้ 9 โมง ประชุม"), deps);
    expect(created).toEqual([]);
    expect(said(reply)).toContain("ครบ 100 รายการแล้ว");
  });

  const waiting = (id: string, createdBy: string, body: string) => ({
    id,
    body,
    remindAt: "2026-10-19T02:00:00.000Z",
    repeat: null,
    status: "active" as const,
    category: null,
    createdBy,
    groupId: "g1",
  });

  it("lists them numbered, and cancels by number for whoever set it", async () => {
    reminders = [waiting("r1", "Uanna", "ประชุม"), waiting("r2", "Ubob", "จ่ายค่าห้อง")];
    const { deps, reply } = setup();
    await handleEvent(say("Ubob", "เตือนกลุ่ม"), deps);
    expect(said(reply)).toContain("1. ประชุม");
    expect(said(reply)).toContain("2. จ่ายค่าห้อง");

    const denied = setup();
    await handleEvent(say("Ubob", "ยกเลิกเตือน 1"), denied.deps);
    expect(said(denied.reply)).toContain("ยกเลิกได้เฉพาะคนที่ตั้ง");
    expect(reminders).toHaveLength(2);

    const ok = setup();
    await handleEvent(say("Ubob", "ยกเลิกเตือน 2"), ok.deps);
    expect(said(ok.reply)).toContain("ยกเลิกเตือนกลุ่มแล้ว: จ่ายค่าห้อง");
    expect(reminders.map((r) => r.id)).toEqual(["r1"]);
  });

  it("the owner may cancel anyone's, with the button too", async () => {
    reminders = [waiting("r1", "Uanna", "ประชุม")];
    const { deps, reply } = setup();
    await handleEvent(tap("Uowner", "a=grmx&id=r1"), deps);
    expect(said(reply)).toContain("ยกเลิกเตือนกลุ่มแล้ว");
    expect(reminders).toEqual([]);
  });
});

describe("พี่ฮูก in a group", () => {
  it("answers one question with the group's ledger only, on the owner's quota", async () => {
    const { deps, reply, asked } = setup();
    await handleEvent(say("Uanna", "ฮูก เดือนนี้กลุ่มใช้ไปเท่าไร"), deps);
    expect(said(reply)).toContain("ตอบแล้ว");
    expect(owlTaken).toBe(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.group).toBe(true);
    expect(asked[0]?.data).toMatch(/เดือนนี้ทั้งกลุ่ม: 450(\.00)? บาท/);
    expect(asked[0]?.data).toContain("แอน");
  });

  it("an everyday question sends no ledger", async () => {
    const { deps, asked } = setup();
    await handleEvent(say("Uanna", "ฮูก แมวกินอะไรได้บ้าง"), deps);
    expect(asked[0]?.data).toBe("");
  });

  it("explains how to ask when nothing follows the name", async () => {
    const { deps, reply, asked } = setup();
    await handleEvent(say("Uanna", "ถามพี่ฮูก"), deps);
    expect(said(reply)).toContain("ไม่เห็นข้อมูลส่วนตัวของใคร");
    expect(asked).toEqual([]);
  });

  it("says when the owner's quota is used up", async () => {
    owlAllowed = false;
    const { deps, reply, asked } = setup();
    await handleEvent(say("Uanna", "ฮูก สรุปเดือนนี้"), deps);
    expect(said(reply)).toContain("สิทธิ์ถามพี่ฮูกของเจ้าของสมุด");
    expect(asked).toEqual([]);
  });

  it("a member over their daily cap gets the owner's question back", async () => {
    const { deps, reply, asked } = setup();
    deps.limit = async (bucket) => ({ allowed: bucket !== "owl_day", hits: 1, limit: 30 });
    await handleEvent(say("Uanna", "ฮูก สรุปเดือนนี้"), deps);
    expect(asked).toEqual([]);
    expect(owlRefunded).toBe(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("gives the quota back when the AI fails", async () => {
    const { deps, reply } = setup();
    deps.owl = {
      name: "broken",
      answer: async () => {
        throw new Error("down");
      },
    };
    await handleEvent(say("Uanna", "ฮูก สรุปเดือนนี้"), deps);
    expect(owlRefunded).toBe(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe("notes in a group", () => {
  it("are written for the group, on the owner's note limit", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "โน้ต ซื้อน้ำแข็ง 2 ถุง"), deps);
    expect(noteCalls).toEqual([
      {
        userId: "app-owner",
        body: "ซื้อน้ำแข็ง 2 ถุง",
        group: { groupId: "g1", createdBy: "Uanna" },
      },
    ]);
    const out = said(reply);
    expect(out).toContain("จดโน้ตกลุ่มแล้ว");
    expect(out).toContain("a=gntx&id=n-new");
    expect(out).toContain("/vault?g=g1&tab=note");
  });

  it("warn that everyone in the group sees one that looks secret", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Uanna", "โน้ต รหัสไวไฟ 12345678"), deps);
    expect(said(reply)).toContain("ทุกคนในกลุ่มเห็นโน้ตนี้");
  });

  it("are refused when the owner's notes are full, or the owner is no longer on Elite", async () => {
    noteCount = 2000;
    const full = setup();
    await handleEvent(say("Uanna", "โน้ต ซื้อนม"), full.deps);
    expect(said(full.reply)).toContain("โน้ตของเจ้าของสมุดเต็ม 2,000 รายการแล้ว");

    noteCount = 0;
    ownerPlan = "free";
    const paused = setup();
    await handleEvent(say("Uanna", "โน้ต ซื้อนม"), paused.deps);
    expect(noteCalls.filter((c) => c.body)).toEqual([]);
  });

  it("stay quiet in a group with no open ledger, where they may be chat with a friend named โน้ต", async () => {
    group = null;
    const none = setup();
    await handleEvent(say("Uanna", "โน้ต ไปกินข้าวไหม"), none.deps);
    expect(none.reply).not.toHaveBeenCalled();
    group = { id: "g1", lineGroupId: GID, ownerUserId: "app-owner", isActive: false };
    const closed = setup();
    await handleEvent(say("Uanna", "โน้ตกลุ่ม"), closed.deps);
    expect(closed.reply).not.toHaveBeenCalled();
    expect(noteCalls).toEqual([]);
  });

  it("are listed and searched for anyone in the group", async () => {
    notes = [
      { id: "n1", body: "รหัสห้องประชุม", createdBy: "Uanna", userId: "app-owner" },
      { id: "n2", body: "ซื้อน้ำแข็ง", createdBy: "Ubob", userId: "app-owner" },
    ];
    const all = setup();
    await handleEvent(say("Ubob", "โน้ตกลุ่ม"), all.deps);
    expect(said(all.reply)).toContain("ซื้อน้ำแข็ง");
    expect(said(all.reply)).toContain("/vault?g=g1&tab=note");

    const found = setup();
    await handleEvent(say("Ubob", "หาโน้ต น้ำแข็ง"), found.deps);
    expect(noteCalls.at(-1)).toEqual({ q: "น้ำแข็ง" });
    expect(said(found.reply)).toContain("ซื้อน้ำแข็ง");
    expect(said(found.reply)).not.toContain("รหัสห้องประชุม");

    notes = [];
    const none = setup();
    await handleEvent(say("Ubob", "โน้ตกลุ่ม"), none.deps);
    expect(said(none.reply)).toContain("กลุ่มนี้ยังไม่มีโน้ต");
  });

  it("are undone by whoever wrote them, or the owner", async () => {
    notes = [{ id: "n1", body: "ซื้อนม", createdBy: "Uanna", userId: "app-owner" }];
    const denied = setup();
    await handleEvent(tap("Ubob", "a=gntx&id=n1"), denied.deps);
    expect(said(denied.reply)).toContain("ลบได้เฉพาะคนที่จดโน้ตนี้");
    expect(notes).toHaveLength(1);

    const owner = setup();
    await handleEvent(tap("Uowner", "a=gntx&id=n1"), owner.deps);
    expect(said(owner.reply)).toContain("ยกเลิกโน้ตแล้ว");
    expect(notes).toHaveLength(0);
  });
});

describe("a group's reminder riding on a message", () => {
  const due = (over: Partial<(typeof riders)[number]> = {}) => ({
    body: "บอกให้ @bot1 ส่งงานด้วย",
    repeat: null,
    mentions: [{ label: "@bot1", userId: "U1" }],
    dueAt: "2026-10-18T03:00:00.000Z",
    late: false,
    ...over,
  });

  it("answers ordinary chat near its time, tagging who it tags, for free", async () => {
    riders = [due()];
    const { deps, reply } = setup();
    await handleEvent(say("Ubob", "ใครว่างบ้าง"), deps);
    expect(reply.mock.calls).toEqual([
      [
        "rt",
        [
          {
            type: "textV2",
            text: "⏰ เตือนกลุ่ม: บอกให้ {m0} ส่งงานด้วย",
            substitution: { m0: { type: "mention", mentionee: { type: "user", userId: "U1" } } },
          },
        ],
      ],
    ]);
  });

  it("goes first in the answer to a command", async () => {
    riders = [due({ mentions: [] })];
    const { deps, reply } = setup();
    await handleEvent(say("Ubob", "เตือนกลุ่ม"), deps);
    const sent = reply.mock.calls[0]?.[1] as { text?: string }[];
    expect(sent[0]?.text).toContain("⏰ เตือนกลุ่ม: บอกให้ @bot1 ส่งงานด้วย");
    expect(sent[1]?.text).toContain("ยังไม่มีเตือน");
  });

  it("says when it was due, when it comes late, and rides on a sticker too", async () => {
    riders = [due({ mentions: [], late: true })];
    const { deps, reply } = setup();
    await handleEvent(message("Ubob", { type: "sticker", id: "s1" }), deps);
    expect(said(reply)).toContain("(เตือนตอน 10:00)");
  });

  it("is sent as plain text when the tagged form is refused, and kept for later when that fails too", async () => {
    riders = [due()];
    const plain = setup();
    plain.reply.mockRejectedValueOnce(new Error("LINE reply failed: 400"));
    await handleEvent(say("Ubob", "ok"), plain.deps);
    expect(plain.reply).toHaveBeenCalledTimes(2);
    expect(plain.reply.mock.calls[1]?.[1]).toEqual([
      { type: "text", text: "⏰ เตือนกลุ่ม: บอกให้ @bot1 ส่งงานด้วย" },
    ]);

    riders = [due()];
    const broken = setup();
    broken.reply.mockRejectedValue(new Error("LINE reply failed: 400"));
    await handleEvent(say("Ubob", "ok"), broken.deps);
    expect(broken.reply).toHaveBeenCalledTimes(2);
    expect(lateAdded).toHaveLength(1);
    expect(lateAdded[0]).toMatchObject({ groupId: "g1", body: "บอกให้ @bot1 ส่งงานด้วย" });
  });

  it("is taken only when the answer is about to go, so a slow answer that dies loses nothing", async () => {
    riders = [due()];
    const { deps } = setup();
    await handleEvent(say("Ubob", "เตือนกลุ่ม"), deps);
    // nothing was taken while the command was worked out; once, just before the answer went
    expect(takenWhenListed).toBe(0);
    expect(ridersTaken).toBe(1);
  });

  it("is not sent again as plain text when the answer failed for another reason", async () => {
    riders = [due()];
    const { deps, reply } = setup();
    reply.mockRejectedValue(new Error("LINE reply failed: 500"));
    await handleEvent(say("Ubob", "ok"), deps);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(lateAdded).toHaveLength(1);
  });

  it("leaves ordinary chat unanswered when nothing is due", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("Ubob", "ใครว่างบ้าง"), deps);
    expect(reply).not.toHaveBeenCalled();
  });
});
