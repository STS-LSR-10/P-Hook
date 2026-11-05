import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentDecision } from "@/lib/ai/intent-router";
import type { GroupEntryRow, GroupRow } from "@/lib/group";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

const GID = "C-group-1";
const NOW = new Date("2026-11-04T03:00:00Z");

let group: GroupRow | null;
let entries: GroupEntryRow[] = [];
let quotaOk = true;
let notes: { id: string; body: string; createdAt: string; updatedAt: string }[] = [];
const taken: { user: string; kind: string; amount: number }[] = [];
const refunded: { user: string; kind: string; amount: number }[] = [];
const remindersMade: string[] = [];
const noteQueries: string[] = [];
const notesAdded: string[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async (_db: unknown, lineUserId: string) => ({
    id: `app-${lineUserId}`,
    line_user_id: lineUserId,
    display_name: null,
    plan: "free",
    plan_expires_at: null,
  }),
}));
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: async () => true,
  refundUsage: async () => undefined,
  takeUsageAmount: async (_db: unknown, user: string, kind: string, amount: number) => {
    taken.push({ user, kind, amount });
    return quotaOk;
  },
  refundUsageAmount: async (_db: unknown, user: string, kind: string, amount: number) => {
    refunded.push({ user, kind, amount });
  },
}));
vi.mock("@/lib/group-repo", () => ({
  getGroup: async () => group,
  getOwner: async () => ({ lineUserId: "Uowner", plan: "ultimate", planExpiresAt: null }),
  memberNames: async () => new Map(),
  upsertMember: async () => undefined,
  addEntries: async (
    _db: unknown,
    _g: string,
    payer: string,
    list: { title: string; amountSatang: number; occurredAt: Date }[],
  ) => {
    const rows = list.map((e, i) => ({
      id: `e${entries.length + i + 1}`,
      payerLineUserId: payer,
      title: e.title,
      amountSatang: e.amountSatang,
      occurredAt: e.occurredAt.toISOString(),
    }));
    entries.push(...rows);
    return rows;
  },
  countEntriesSince: async () => 0,
  openTrip: async () => null,
  recentEntries: async () => [],
  payerTotals: async () => [],
}));
vi.mock("@/lib/note-repo", async (original) => ({
  ...(await original<typeof import("@/lib/note-repo")>()),
  createNote: async (_db: unknown, _u: string, body: string) => {
    notesAdded.push(body);
    return { id: "n1", body, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
  },
  countNotes: async () => 0,
  listGroupNotes: async (_db: unknown, _g: string, o: { q?: string }) => {
    noteQueries.push(o.q ?? "");
    return { items: notes, hasMore: false };
  },
}));
vi.mock("@/lib/file-repo", async (original) => ({
  ...(await original<typeof import("@/lib/file-repo")>()),
  listGroupFiles: async () => ({ items: [], hasMore: false }),
}));
vi.mock("@/lib/user-reminder-repo", async (original) => ({
  ...(await original<typeof import("@/lib/user-reminder-repo")>()),
  countActiveReminders: async () => 0,
  createReminder: async (_db: unknown, _u: string, i: { body: string; remindAt: Date }) => {
    remindersMade.push(i.body);
    return { id: "r1", body: i.body, remindAt: i.remindAt.toISOString(), repeat: null };
  },
}));
vi.mock("@/lib/line/group-riders", () => ({
  withGroupRiders: async (
    _db: unknown,
    _g: string,
    _n: Date,
    reply: (m: unknown[]) => Promise<void>,
    handle: (r: (m: unknown[]) => Promise<void>) => Promise<void>,
  ) => handle(reply),
  remindIfDue: async () => undefined,
}));

const route = vi.fn();
const answer = vi.fn(async () => "ตอบจากพี่ฮูก");
const decision = (d: Partial<IntentDecision>): IntentDecision => ({
  intent: "unclear",
  confidence: 0.9,
  reminderText: null,
  reminderQuery: null,
  whenText: null,
  searchTerm: null,
  fileName: null,
  ...d,
});

const say = (text: string, over: { mentioned?: boolean } = {}): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId: "Uanna" },
  message: {
    type: "text",
    id: "1",
    text: over.mentioned ? `@พี่ฮูก ${text}` : text,
    ...(over.mentioned
      ? { mention: { mentionees: [{ index: 0, length: 7, type: "user", isSelf: true }] } }
      : {}),
  },
});
function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    getGroupMemberProfile: async () => ({ displayName: "แอน" }),
    now: () => NOW,
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
    router: { name: "t", route },
    owl: { name: "t", answer },
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));

beforeEach(() => {
  group = { id: "g1", lineGroupId: GID, ownerUserId: "app-Uowner", isActive: true };
  entries = [];
  notes = [];
  quotaOk = true;
  taken.length = 0;
  refunded.length = 0;
  remindersMade.length = 0;
  noteQueries.length = 0;
  notesAdded.length = 0;
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("the AI in a group reads only what calls the bot", () => {
  it("ordinary chat is never sent to the AI", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("ไปกินข้าวกันไหม 350"), deps);
    expect(route).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("an exact command is not sent to the AI and costs no use", async () => {
    const { deps } = setup();
    await handleEvent(say("จด ข้าวเที่ยง 350"), deps);
    expect(route).not.toHaveBeenCalled();
    expect(taken).toEqual([]);
    expect(entries).toHaveLength(1);
  });

  it("a message that tags the bot is read by the AI, on the quota of the one who typed it", async () => {
    route.mockResolvedValue(decision({ intent: "money" }));
    const { deps } = setup();
    await handleEvent(say("ช่วยจดค่าข้าวเมื่อกี้ 120 หน่อย", { mentioned: true }), deps);
    expect(route).toHaveBeenCalledOnce();
    expect(taken[0]).toMatchObject({ user: "app-Uanna", kind: "ai_chat", amount: 1 });
    expect(entries.map((e) => e.amountSatang)).toEqual([12000]);
  });

  it("sets a group reminder from what was said", async () => {
    route.mockResolvedValue(
      decision({ intent: "reminder_add", reminderText: "ส่งงาน พรุ่งนี้ 10 โมง" }),
    );
    const { deps } = setup();
    await handleEvent(say("ตั้งเตือนให้ส่งงานพรุ่งนี้สิบโมง", { mentioned: true }), deps);
    expect(remindersMade).toEqual(["ส่งงาน"]);
  });

  it("keeps a group note", async () => {
    route.mockResolvedValue(decision({ intent: "note_add" }));
    const { deps } = setup();
    await handleEvent(say("จดไว้ว่าต้องซื้อน้ำแข็ง", { mentioned: true }), deps);
    expect(notesAdded).toHaveLength(1);
  });

  it("a search looks in the group's notes (and files)", async () => {
    route.mockResolvedValue(decision({ intent: "search", searchTerm: "ไวไฟ" }));
    const { deps } = setup();
    await handleEvent(say("ไวไฟที่โน้ตไว้ว่าไงนะ", { mentioned: true }), deps);
    expect(noteQueries).toEqual(["ไวไฟ"]);
  });

  it("a question goes to พี่ฮูก with no second charge on the group's owner", async () => {
    route.mockResolvedValue(decision({ intent: "ask" }));
    const { deps, reply } = setup();
    await handleEvent(say("ทำไมฟ้าสีฟ้า", { mentioned: true }), deps);
    expect(said(reply)).toContain("ตอบจากพี่ฮูก");
    expect(taken).toHaveLength(1);
  });

  it("an answer that never came gives the typer's use back", async () => {
    route.mockResolvedValue(decision({ intent: "ask" }));
    answer.mockRejectedValueOnce(new Error("down"));
    const { deps } = setup();
    await handleEvent(say("ทำไมฟ้าสีฟ้า", { mentioned: true }), deps);
    expect(refunded).toEqual([{ user: "app-Uanna", kind: "ai_chat", amount: 1 }]);
  });

  it("'ฮูก …' is read by the AI too, so it can set a reminder", async () => {
    route.mockResolvedValue(
      decision({ intent: "reminder_add", reminderText: "ประชุม พรุ่งนี้ 9 โมง" }),
    );
    const { deps } = setup();
    await handleEvent(say("ฮูก ตั้งเตือนประชุมพรุ่งนี้เก้าโมง"), deps);
    expect(remindersMade).toEqual(["ประชุม"]);
  });

  it("when the AI is unsure the bot answers as พี่ฮูก instead of acting", async () => {
    route.mockResolvedValue(decision({ intent: "money", confidence: 0.4 }));
    const { deps } = setup();
    await handleEvent(say("อะไรสักอย่าง", { mentioned: true }), deps);
    expect(entries).toEqual([]);
  });
});

describe("when the typer's AI quota is used up", () => {
  it("'ฮูก …' still asks พี่ฮูก the way it did, on the owner's quota", async () => {
    quotaOk = false;
    const { deps, reply } = setup();
    await handleEvent(say("ฮูก ทำไมฟ้าสีฟ้า"), deps);
    expect(route).not.toHaveBeenCalled();
    expect(said(reply)).toContain("ตอบจากพี่ฮูก");
  });

  it("a tag that is not a command stays quiet", async () => {
    quotaOk = false;
    const { deps, reply } = setup();
    await handleEvent(say("ช่วยจดค่าข้าว 120 หน่อย", { mentioned: true }), deps);
    expect(entries).toEqual([]);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("secrets", () => {
  it("a message that looks like a password or a code is never sent to the AI", async () => {
    const { deps } = setup();
    await handleEvent(say("รหัสไวไฟคือ 12345678", { mentioned: true }), deps);
    expect(route).not.toHaveBeenCalled();
    expect(taken).toEqual([]);
  });
});

describe("the group is not open", () => {
  it("nothing is sent to the AI", async () => {
    group = null;
    const { deps } = setup();
    await handleEvent(say("ช่วยจดค่าข้าว 120", { mentioned: true }), deps);
    expect(route).not.toHaveBeenCalled();
    expect(taken).toEqual([]);
  });
});

describe("every group message", () => {
  it("is answered in one reply, even when it needs more than one message", async () => {
    route.mockResolvedValue(decision({ intent: "search", searchTerm: "สัญญา" }));
    const { deps, reply } = setup();
    await handleEvent(say("สัญญาเช่าอยู่ไหน", { mentioned: true }), deps);
    expect(reply.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
