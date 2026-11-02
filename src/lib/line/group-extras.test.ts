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
let saved: { owner: string; name: string | null; group?: { groupId: string; savedBy: string } }[] = [];
let saveOutcome: "ok" | "full" = "ok";
let groupFiles: { id: string; name: string }[] = [];
let listCalls: { userId: string; groupId?: string; q?: string }[] = [];
let reminders: (GroupReminder & { groupId: string })[] = [];
let activeCount = 0;
let created: { userId: string; body: string; groupId?: string; createdBy?: string }[] = [];
let owlTaken = 0;
let owlRefunded = 0;
let owlAllowed = true;
let slipChecks = 0;

vi.mock("@/lib/group-repo", () => ({
  getGroup: async () => group,
  getOwner: async () => ({ lineUserId: "Uowner", plan: ownerPlan, planExpiresAt: null }),
  memberNames: async () => new Map([["Uanna", { name: "แอน", updatedAt: NOW.toISOString() }]]),
  upsertMember: async () => undefined,
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
  listFiles: async (
    _db: unknown,
    userId: string,
    options: { groupId?: string; q?: string },
  ) => {
    listCalls.push({ userId, groupId: options.groupId, q: options.q });
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
    input: { body: string; remindAt: Date; repeat: null; groupId?: string; createdBy?: string },
  ) => {
    created.push({
      userId,
      body: input.body,
      groupId: input.groupId,
      createdBy: input.createdBy,
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
  listGroupReminders: async (_db: unknown, groupId: string) =>
    reminders.filter((r) => r.groupId === groupId),
  cancelGroupReminder: async (_db: unknown, groupId: string, id: string) => {
    const before = reminders.length;
    reminders = reminders.filter((r) => !(r.id === id && r.groupId === groupId));
    return reminders.length < before;
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
    expect(said(reply)).toContain("/group?id=g1");
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
    expect(listCalls).toEqual([{ userId: "app-owner", groupId: "g1", q: "สัญญา" }]);
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
