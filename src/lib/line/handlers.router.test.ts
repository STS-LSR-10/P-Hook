import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentDecision } from "@/lib/ai/intent-router";
import type { PendingIntent } from "@/lib/pending-intent-repo";
import type { ReminderDto } from "@/lib/user-reminder";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";
import {
  INTENT_CANCELLED_TEXT,
  INTENT_EXPIRED_TEXT,
  MONEY_HINT_TEXT,
  REMINDER_GONE_TEXT,
  REMINDER_NOT_MATCHED_TEXT,
  ROUTER_REMINDER_HINT_TEXT,
  SECRET_ASK_TEXT,
} from "./messages";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const PENDING = "33333333-3333-4333-8333-333333333333";

let plan = "free";
let quota = true;
let reminders: ReminderDto[] = [];
let moved: ReminderDto | null = null;
let pending: PendingIntent | null = null;
const entries: string[] = [];
const notes: string[] = [];
const searched: (string | undefined)[] = [];
const madeReminders: { body: string; remindAt: Date }[] = [];
const moves: { id: string; remindAt: Date; repeat: unknown }[] = [];
const putPending = vi.fn();
const asked = vi.fn();
let owlMode = false;

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async () => ({
    id: "u1",
    line_user_id: "U1",
    display_name: null,
    plan,
    plan_expires_at: null,
  }),
  getSettings: async () => ({ confirm_style: "off", budget_cycle: "monthly", cycle_start_day: 1 }),
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
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: async () => quota,
  refundUsage: async () => undefined,
}));
vi.mock("@/lib/note-repo", () => ({
  countNotes: async () => 0,
  createNote: async (_db: unknown, _u: string, body: string) => {
    notes.push(body);
    return { id: "n", body, createdAt: "", updatedAt: "" };
  },
  listNotes: async (_db: unknown, _u: string, o: { q?: string }) => {
    searched.push(o.q);
    return { items: [], hasMore: false };
  },
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  countActiveReminders: async () => 0,
  listReminders: async () => reminders,
  createReminder: async (_db: unknown, _u: string, i: { body: string; remindAt: Date }) => {
    madeReminders.push(i);
    return { id: ID, body: i.body, remindAt: i.remindAt.toISOString(), repeat: null };
  },
  rescheduleReminder: async (
    _db: unknown,
    _u: string,
    id: string,
    i: { remindAt: Date; repeat: unknown },
  ) => {
    moves.push({ id, ...i });
    return moved;
  },
}));
vi.mock("@/lib/pending-intent-repo", () => ({
  putPendingIntent: async (...a: unknown[]) => {
    putPending(...a);
    return PENDING;
  },
  takePendingIntent: async () => {
    const p = pending;
    pending = null;
    return p;
  },
}));
vi.mock("./owl", async (original) => ({
  ...(await original<typeof import("./owl")>()),
  inOwlMode: async () => owlMode,
  owlAsk: async (_d: unknown, _u: unknown, q: string) => {
    asked(q);
    return [{ type: "text", text: "ตอบแล้ว" }];
  },
}));

const USER = "U" + "a".repeat(32);
const say = (t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: USER },
  message: { type: "text", id: "1", text: t },
});
const tap = (data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "user", userId: USER },
  postback: { data },
});

const route = vi.fn();
function setup() {
  const reply = vi.fn<(token: string, messages: unknown[]) => Promise<undefined>>(
    async () => undefined,
  );
  const deps: HandlerDeps = {
    db: {} as SupabaseClient,
    reply,
    getProfile: async () => null,
    now: () => new Date("2026-11-01T05:00:00Z"),
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
    router: { name: "t", route },
  };
  return { deps, reply };
}
type Sent = { text?: string; quickReply?: { items: { action: { data?: string } }[] } };
const sent = (reply: ReturnType<typeof setup>["reply"]) => (reply.mock.calls[0]?.[1] ?? []) as Sent[];
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  sent(reply)
    .map((m) => m.text)
    .join("\n");
const buttons = (reply: ReturnType<typeof setup>["reply"]) =>
  sent(reply).flatMap((m) => m.quickReply?.items.map((i) => i.action.data) ?? []);

const decision = (d: Partial<IntentDecision>): IntentDecision => ({
  intent: "unclear",
  confidence: 0.9,
  reminderText: null,
  reminderQuery: null,
  whenText: null,
  searchTerm: null,
  ...d,
});
const reminder = (id: string, body: string, repeat: ReminderDto["repeat"] = null): ReminderDto => ({
  id,
  body,
  remindAt: "2026-11-02T11:00:00Z",
  repeat,
});

beforeEach(() => {
  plan = "free";
  quota = true;
  owlMode = false;
  reminders = [];
  moved = null;
  pending = null;
  entries.length = 0;
  notes.length = 0;
  searched.length = 0;
  madeReminders.length = 0;
  moves.length = 0;
  vi.clearAllMocks();
  route.mockReset();
  process.env.NEXT_PUBLIC_LIFF_ID = "1234-abcd";
});

describe("plain messages", () => {
  it("clear money skips the AI", async () => {
    const { deps } = setup();
    await handleEvent(say("กินข้าว50"), deps);
    expect(route).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  it("sets a reminder", async () => {
    route.mockResolvedValue(decision({ intent: "reminder_add", reminderText: "กินยา 6 โมงเย็น" }));
    const { deps } = setup();
    await handleEvent(say("กินยา 6 โมงเย็น"), deps);
    expect(madeReminders[0]?.body).toBe("กินยา");
    expect(madeReminders[0]?.remindAt.toISOString()).toBe("2026-11-01T11:00:00.000Z");
    expect(entries).toEqual([]);
  });

  it("saves the typed text as the note", async () => {
    route.mockResolvedValue(decision({ intent: "note_add" }));
    const { deps } = setup();
    await handleEvent(say("ไปเที่ยวต้องซื้อครีม 2 หลอด"), deps);
    expect(notes).toEqual(["ไปเที่ยวต้องซื้อครีม 2 หลอด"]);
    expect(entries).toEqual([]);
  });

  it("searches notes", async () => {
    route.mockResolvedValue(decision({ intent: "search", searchTerm: "หอ" }));
    const { deps } = setup();
    await handleEvent(say("ที่อยู่หอจดไว้ไหม"), deps);
    expect(searched).toEqual(["หอ"]);
  });

  it("hands questions to the owl", async () => {
    route.mockResolvedValue(decision({ intent: "ask" }));
    const { deps } = setup();
    await handleEvent(say("ทำไมฟ้าสีฟ้า"), deps);
    expect(asked).toHaveBeenCalledWith("ทำไมฟ้าสีฟ้า");
  });

  it("asks first when unsure", async () => {
    route.mockResolvedValue(decision({ intent: "note_add", confidence: 0.5 }));
    const { deps, reply } = setup();
    await handleEvent(say("ค่าน้ำพรุ่งนี้"), deps);
    expect(notes).toEqual([]);
    expect(putPending).toHaveBeenCalledOnce();
    expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=yes`);
  });

  it("unclear offers the groups", async () => {
    route.mockResolvedValue(decision({ intent: "unclear", confidence: 0.2 }));
    const { deps, reply } = setup();
    await handleEvent(say("จดไว้"), deps);
    for (const p of ["money", "note", "reminder"]) {
      expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=${p}`);
    }
  });

  it("falls back when the AI fails", async () => {
    route.mockRejectedValue(new Error("down"));
    const { deps } = setup();
    await handleEvent(say("ค่าที่อยู่ 500"), deps);
    expect(entries).toHaveLength(1);
  });

  it("money with a past time word stays with the rules", async () => {
    const { deps } = setup();
    await handleEvent(say("กาแฟ 50 เมื่อเช้า"), deps);
    expect(entries).toHaveLength(1);
  });

  it("secret text never reaches the AI", async () => {
    const { deps, reply } = setup();
    await handleEvent(say("รหัสไวไฟ 12345678"), deps);
    expect(route).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
    expect(said(reply)).toBe(SECRET_ASK_TEXT);
    expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=note`);
    expect(buttons(reply)).toContain(`a=irp&id=${PENDING}&p=no`);
  });

  it("clock words without the AI do not become money", async () => {
    quota = false;
    const { deps, reply } = setup();
    await handleEvent(say("กินยา 6 โมงเย็น"), deps);
    expect(entries).toEqual([]);
    expect(said(reply)).toBe(ROUTER_REMINDER_HINT_TEXT);
  });

  it("money for Free with nothing readable shows a hint", async () => {
    route.mockResolvedValue(decision({ intent: "money" }));
    const { deps, reply } = setup();
    await handleEvent(say("จ่ายค่าหมอไปแล้วเมื่อวาน"), deps);
    expect(said(reply)).toBe(MONEY_HINT_TEXT);
  });

  it("money for Elite uses the smart reader", async () => {
    plan = "ultimate";
    route.mockResolvedValue(decision({ intent: "money" }));
    const structure = vi.fn(async () => ({ entries: [] }));
    const { deps } = setup();
    deps.structurer = { name: "s", structure };
    await handleEvent(say("เมื่อวานพาแม่ไปโรงพยาบาลแล้วจ่ายค่าหมอกับค่ายาไปทั้งหมด 800 บาท"), deps);
    expect(structure).toHaveBeenCalledOnce();
  });

  it("owl mode still wins", async () => {
    owlMode = true;
    const { deps } = setup();
    await handleEvent(say("กินยา 6 โมงเย็น"), deps);
    expect(route).not.toHaveBeenCalled();
    expect(asked).toHaveBeenCalled();
  });
});

describe("moving a reminder", () => {
  const edit = decision({
    intent: "reminder_edit",
    reminderQuery: "กินยา",
    whenText: "1 ทุ่ม",
  });

  it("moves a reminder and keeps its repeat", async () => {
    reminders = [reminder(ID, "กินยา", "daily")];
    moved = reminder(ID, "กินยา", "daily");
    route.mockResolvedValue(edit);
    const { deps } = setup();
    await handleEvent(say("เลื่อนเตือนกินยาเป็น 1 ทุ่ม"), deps);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: ID, repeat: "daily" });
    expect(moves[0]?.remindAt.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });

  it("asks which one when several match", async () => {
    reminders = [reminder(ID, "กินยาเช้า"), reminder(ID2, "กินยาเย็น")];
    route.mockResolvedValue(edit);
    const { deps, reply } = setup();
    await handleEvent(say("เลื่อนเตือนกินยาเป็น 1 ทุ่ม"), deps);
    expect(moves).toEqual([]);
    expect(buttons(reply)).toEqual([
      `a=irp&id=${PENDING}&p=rm:${ID}`,
      `a=irp&id=${PENDING}&p=rm:${ID2}`,
    ]);
  });

  it("says so when none matches", async () => {
    route.mockResolvedValue(edit);
    const { deps, reply } = setup();
    await handleEvent(say("เลื่อนเตือนกินยาเป็น 1 ทุ่ม"), deps);
    expect(said(reply)).toBe(REMINDER_NOT_MATCHED_TEXT);
  });

  it("says so when the reminder fired meanwhile", async () => {
    reminders = [reminder(ID, "กินยา")];
    moved = null;
    route.mockResolvedValue(edit);
    const { deps, reply } = setup();
    await handleEvent(say("เลื่อนเตือนกินยาเป็น 1 ทุ่ม"), deps);
    expect(said(reply)).toBe(REMINDER_GONE_TEXT);
  });
});

describe("answering the buttons", () => {
  it("a second tap does nothing", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=yes`), deps);
    expect(said(reply)).toBe(INTENT_EXPIRED_TEXT);
    expect(notes).toEqual([]);
  });

  it("yes carries out the stored decision", async () => {
    pending = { id: PENDING, input: "ซื้อนม", decision: decision({ intent: "note_add" }) };
    const { deps } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=yes`), deps);
    expect(notes).toEqual(["ซื้อนม"]);
  });

  it("note saves the message", async () => {
    pending = { id: PENDING, input: "รหัสไวไฟ 1234", decision: null };
    const { deps } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=note`), deps);
    expect(notes).toEqual(["รหัสไวไฟ 1234"]);
  });

  it("money records the message", async () => {
    pending = { id: PENDING, input: "กาแฟ 50", decision: null };
    const { deps } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=money`), deps);
    expect(entries).toHaveLength(1);
    expect(route).not.toHaveBeenCalled();
  });

  it("no says cancelled and saves nothing", async () => {
    pending = { id: PENDING, input: "ซื้อนม", decision: decision({ intent: "note_add" }) };
    const { deps, reply } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=no`), deps);
    expect(said(reply)).toBe(INTENT_CANCELLED_TEXT);
    expect(notes).toEqual([]);
  });

  it("rejects a pick it does not know", async () => {
    pending = { id: PENDING, input: "ซื้อนม", decision: decision({ intent: "note_add" }) };
    const { deps, reply } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=delete`), deps);
    expect(said(reply)).toBe(INTENT_EXPIRED_TEXT);
    expect(notes).toEqual([]);
  });

  it("picks the reminder to move", async () => {
    reminders = [reminder(ID, "กินยาเช้า", "weekly"), reminder(ID2, "กินยาเย็น")];
    moved = reminders[0] ?? null;
    pending = {
      id: PENDING,
      input: "เลื่อนเตือนกินยาเป็น 1 ทุ่ม",
      decision: decision({
        intent: "reminder_edit",
        reminderQuery: "กินยา",
        whenText: "1 ทุ่ม",
      }),
    };
    const { deps } = setup();
    await handleEvent(tap(`a=irp&id=${PENDING}&p=rm:${ID}`), deps);
    expect(moves[0]).toMatchObject({ id: ID, repeat: "weekly" });
  });
});
