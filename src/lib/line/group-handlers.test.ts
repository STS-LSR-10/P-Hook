import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupEntryRow, GroupRow, TripRow } from "@/lib/group";
import { handleEvent, type HandlerDeps, type LineEvent } from "./handlers";

const GID = "C-group-1";
const NOW = new Date("2026-10-18T05:00:00Z");

let group: GroupRow | null = null;
let ownerPlan = "ultimate";
let ownerLine = "Uowner";
let entries: (GroupEntryRow & { deleted?: boolean })[] = [];
let members = new Map<string, { name: string; updatedAt: string }>();
let ownedCount = 0;
let todayCount = 0;
let userPlan = "ultimate";
let trip: TripRow | null = null;
let closedTripRows: TripRow[] = [];
let tripMemberIds: string[] = [];
let fxAnswer: { rate: number; sourceDay: string; stale: boolean } | null = null;
const startedTrips: { name: string; startedBy: string }[] = [];
const closedTripIds: string[] = [];
const opened: { lineGroupId: string; owner: string }[] = [];
const closed: string[] = [];
const upserts: { userId: string; name: string }[] = [];

vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  ensureUser: async (_db: unknown, lineUserId: string) => ({
    id: `app-${lineUserId}`,
    line_user_id: lineUserId,
    display_name: null,
    plan: userPlan,
    plan_expires_at: null,
  }),
}));
vi.mock("@/lib/group-repo", () => ({
  getGroup: async () => group,
  getChaseSchedule: async () => ({ everyDays: 1, window: "any" }),
  getOwner: async () => ({ lineUserId: ownerLine, plan: ownerPlan, planExpiresAt: null }),
  countOwnedGroups: async () => ownedCount,
  openGroup: async (_db: unknown, lineGroupId: string, owner: string) => {
    opened.push({ lineGroupId, owner });
    group = { id: "g1", lineGroupId, ownerUserId: owner, isActive: true };
    return group;
  },
  closeGroup: async (_db: unknown, lineGroupId: string) => {
    closed.push(lineGroupId);
    if (group) group = { ...group, isActive: false };
  },
  markGroupLeft: async (_db: unknown, lineGroupId: string) => {
    if (!group?.isActive) return false;
    closed.push(lineGroupId);
    group = { ...group, isActive: false };
    return true;
  },
  memberNames: async () => members,
  upsertMember: async (_db: unknown, _g: string, userId: string, name: string) => {
    upserts.push({ userId, name });
    members.set(userId, { name, updatedAt: NOW.toISOString() });
  },
  addEntries: async (
    _db: unknown,
    _g: string,
    payer: string,
    list: {
      title: string;
      amountSatang: number;
      occurredAt: Date;
      tripId?: string | null;
      splitUsers?: string[];
      foreign?: { currency: string; minor: number; rate: number } | null;
    }[],
  ) => {
    const rows = list.map((e, i) => ({
      id: `e${entries.length + i + 1}`,
      payerLineUserId: payer,
      title: e.title,
      amountSatang: e.amountSatang,
      occurredAt: e.occurredAt.toISOString(),
      tripId: e.tripId ?? null,
      splitUsers: e.splitUsers ?? [],
      origCurrency: e.foreign?.currency ?? null,
      origMinor: e.foreign?.minor ?? null,
      fxRate: e.foreign?.rate ?? null,
    }));
    entries.push(...rows);
    return rows;
  },
  recentEntries: async (_db: unknown, _g: string, limit: number, payer?: string) =>
    entries
      .filter((e) => !e.deleted && (!payer || e.payerLineUserId === payer))
      .slice()
      .reverse()
      .slice(0, limit),
  getEntry: async (_db: unknown, _g: string, id: string) =>
    entries.find((e) => e.id === id && !e.deleted) ?? null,
  deleteEntry: async (_db: unknown, _g: string, id: string) => {
    const e = entries.find((x) => x.id === id);
    if (!e || e.deleted) return false;
    e.deleted = true;
    return true;
  },
  payerTotals: async () => {
    const by = new Map<string, { totalSatang: number; entries: number }>();
    for (const e of entries.filter((x) => !x.deleted)) {
      const cur = by.get(e.payerLineUserId) ?? { totalSatang: 0, entries: 0 };
      by.set(e.payerLineUserId, {
        totalSatang: cur.totalSatang + e.amountSatang,
        entries: cur.entries + 1,
      });
    }
    return [...by]
      .map(([lineUserId, v]) => ({ lineUserId, ...v }))
      .sort((a, b) => b.totalSatang - a.totalSatang);
  },
  countEntriesSince: async () => todayCount,
  openTrip: async () => trip,
  createTrip: async (_db: unknown, groupId: string, name: string, startedBy: string) => {
    if (trip) return "exists";
    startedTrips.push({ name, startedBy });
    trip = {
      id: "t1",
      groupId,
      name,
      startedBy,
      status: "open",
      createdAt: NOW.toISOString(),
      closedAt: null,
    };
    return trip;
  },
  closeTrip: async (_db: unknown, id: string) => {
    closedTripIds.push(id);
    if (trip)
      closedTripRows = [
        { ...trip, status: "closed", closedAt: NOW.toISOString() },
        ...closedTripRows,
      ];
    trip = null;
  },
  closedTrips: async () => closedTripRows,
  joinTrip: async (_db: unknown, _t: string, userId: string) => {
    if (!tripMemberIds.includes(userId)) tripMemberIds.push(userId);
  },
  tripMembers: async () => tripMemberIds,
  tripEntries: async (_db: unknown, tripId: string) =>
    entries.filter((e) => !e.deleted && e.tripId === tripId),
}));
const ended: { groupId: string; exceptOwner?: string }[] = [];
vi.mock("@/lib/user-reminder-repo", async (original) => ({
  ...(await original<typeof import("@/lib/user-reminder-repo")>()),
  endGroupReminders: async (_db: unknown, groupId: string, exceptOwner?: string) => {
    ended.push({ groupId, exceptOwner });
  },
}));
const movedNotes: { groupId: string; owner: string }[] = [];
vi.mock("@/lib/note-repo", async (original) => ({
  ...(await original<typeof import("@/lib/note-repo")>()),
  moveGroupNotes: async (_db: unknown, groupId: string, owner: string) => {
    movedNotes.push({ groupId, owner });
  },
}));
vi.mock("@/lib/fx-repo", () => ({
  getHomeRate: async () => fxAnswer,
}));

const inGroup = (userId: string | undefined, t: string): LineEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
  message: { type: "text", id: "1", text: t },
});
const tap = (userId: string, data: string): LineEvent => ({
  type: "postback",
  replyToken: "rt",
  source: { type: "group", groupId: GID, userId },
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
    getGroupMemberProfile: async (_g, u) => ({ displayName: u === "Uanna" ? "แอน" : "บ๊อบ" }),
    now: () => NOW,
    limit: async () => ({ allowed: true, hits: 1, limit: 30 }),
  };
  return { deps, reply };
}
const said = (reply: ReturnType<typeof setup>["reply"]) =>
  JSON.stringify(reply.mock.calls.map((c) => c[1]));
const openBook = () => {
  group = { id: "g1", lineGroupId: GID, ownerUserId: "app-Uowner", isActive: true };
};

beforeEach(() => {
  group = null;
  ownerPlan = "ultimate";
  ownerLine = "Uowner";
  entries = [];
  members = new Map();
  ownedCount = 0;
  todayCount = 0;
  userPlan = "ultimate";
  trip = null;
  closedTripRows = [];
  tripMemberIds = [];
  fxAnswer = { rate: 0.2335, sourceDay: "2026-10-16", stale: false };
  startedTrips.length = 0;
  closedTripIds.length = 0;
  opened.length = 0;
  closed.length = 0;
  upserts.length = 0;
  ended.length = 0;
  movedNotes.length = 0;
});

describe("the bot joining and leaving", () => {
  it("greets the group when added, and closes the ledger when removed", async () => {
    let { deps, reply } = setup();
    await handleEvent(
      { type: "join", replyToken: "rt", source: { type: "group", groupId: GID } },
      deps,
    );
    const card = said(reply);
    expect(card).toContain('"type":"flex"');
    // two buttons: open the ledger (a LIFF page when the LIFF id is known), and how to use it
    expect(card).toContain('"label":"📒 เปิดสมุดกลุ่ม"');
    expect(card).toContain('"label":"📖 วิธีใช้งาน","text":"วิธีใช้งาน"');
    expect(card).toContain("Elite");
    expect(card).toContain('"type":"carousel"'); // small cards to swipe, not one tall card

    ({ deps, reply } = setup());
    // a ledger was opened in the group while the bot was there
    group = { id: "g1", lineGroupId: GID, ownerUserId: "app-Uowner", isActive: true };
    const pushed: { to: string; text: string }[] = [];
    deps.push = async (to, messages) => {
      pushed.push({ to, text: JSON.stringify(messages) });
    };
    await handleEvent({ type: "leave", source: { type: "group", groupId: GID } }, deps);
    expect(closed).toEqual([GID]);
    // the owner is told, and how long the data is kept
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.to).toBe(ownerLine);
    expect(pushed[0]?.text).toContain("เปิดสมุดกลุ่ม");
  });
});

describe("the welcome card's open button", () => {
  it("opens the LIFF page that checks friendship when the LIFF id is known", async () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "1234567890-abcdefgh";
    try {
      const { deps, reply } = setup();
      await handleEvent(
        { type: "join", replyToken: "rt", source: { type: "group", groupId: GID } },
        deps,
      );
      expect(said(reply)).toContain('"uri":"https://liff.line.me/1234567890-abcdefgh/group-open"');
    } finally {
      delete process.env.NEXT_PUBLIC_LIFF_ID;
    }
  });
});

describe("เปิดสมุดกลุ่ม", () => {
  it("an Elite member opens it and becomes the owner", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uowner", "เปิดสมุดกลุ่ม"), deps);
    expect(opened).toEqual([{ lineGroupId: GID, owner: "app-Uowner" }]);
    expect(said(reply)).toContain("เปิดสมุดกลุ่มแล้ว");
  });

  it("a member who is not Elite is told it needs Elite", async () => {
    userPlan = "plus";
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uplus", "เปิดสมุดกลุ่ม"), deps);
    expect(opened).toHaveLength(0);
    expect(said(reply)).toContain("Elite");
  });

  it("already open by the same person, or by someone else with a running plan", async () => {
    openBook();
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uowner", "เปิดสมุดกลุ่ม"), deps);
    expect(said(reply)).toContain("เปิดอยู่แล้ว");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uother", "เปิดสมุดกลุ่ม"), deps);
    expect(opened).toHaveLength(0);
    expect(said(reply)).toContain("มีเจ้าของสมุดอยู่แล้ว");
  });

  it("when the owner's Elite has run out another Elite member may take over", async () => {
    openBook();
    ownerPlan = "free";
    const { deps } = setup();
    await handleEvent(inGroup("Uother", "เปิดสมุดกลุ่ม"), deps);
    expect(opened).toEqual([{ lineGroupId: GID, owner: "app-Uother" }]);
    // the old owner's group reminders stop; the new owner's own stay
    expect(ended).toEqual([{ groupId: "g1", exceptOwner: "app-Uother" }]);
    // the group's notes go with the ledger, onto the new owner's limit
    expect(movedNotes).toEqual([{ groupId: "g1", owner: "app-Uother" }]);
  });

  it("an owner of five ledgers cannot open a sixth", async () => {
    ownedCount = 5;
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uowner", "เปิดสมุดกลุ่ม"), deps);
    expect(opened).toHaveLength(0);
    expect(said(reply)).toContain("ครบ 5 กลุ่ม");
  });

  it("no LINE user id on the message: asks them to add the bot", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup(undefined, "เปิดสมุดกลุ่ม"), deps);
    expect(said(reply)).toContain("เพิ่มบอทเป็นเพื่อน");
  });
});

describe("จด anywhere in the message", () => {
  beforeEach(openBook);

  it.each([
    ["จดค่าน้ำ 200", "ค่าน้ำ", 20_000],
    ["เครื่องเล่น 500 จด", "เครื่องเล่น", 50_000],
    ["ข้าว จด 300", "ข้าว", 30_000],
    ["จด ข้าว 300", "ข้าว", 30_000],
  ])("'%s' is recorded as %s", async (input, title, amount) => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", input), deps);
    expect(entries[0]).toMatchObject({ title, amountSatang: amount, payerLineUserId: "Uanna" });
    expect(said(reply)).toContain("จดแล้ว");
  });

  it("chat that merely contains the word, without an amount, is left alone", async () => {
    for (const chat of ["เดี๋ยวจดไว้นะ", "จดทะเบียนเสร็จแล้ว", "ข้าว จด ค่ะ"]) {
      const { deps, reply } = setup();
      await handleEvent(inGroup("Uanna", chat), deps);
      expect(said(reply), chat).toBe("[]");
    }
    expect(entries).toHaveLength(0);
  });
});

describe("จด", () => {
  beforeEach(openBook);

  it("records the entry to whoever typed it and names them", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าวเที่ยง 350"), deps);
    expect(entries[0]).toMatchObject({
      payerLineUserId: "Uanna",
      title: "ข้าวเที่ยง",
      amountSatang: 35_000,
    });
    expect(upserts).toEqual([{ userId: "Uanna", name: "แอน" }]);
    const text = said(reply);
    expect(text).toContain("จ่ายโดย แอน");
    expect(text).toContain("a=gdx&id=e1");
  });

  it("two people each get their own entries", async () => {
    const { deps } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าว 100"), deps);
    await handleEvent(inGroup("Ubob", "จด กาแฟ 50"), deps);
    expect(entries.map((e) => e.payerLineUserId)).toEqual(["Uanna", "Ubob"]);
  });

  it("the name is fetched once and then remembered", async () => {
    const { deps } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าว 100"), deps);
    await handleEvent(inGroup("Uanna", "จด ขนม 20"), deps);
    expect(upserts).toHaveLength(1);
  });

  it("several entries in one message", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด กาแฟ 90, ขนม 40"), deps);
    expect(entries).toHaveLength(2);
    expect(said(reply)).toContain("จดแล้ว 2 รายการ");
    expect(said(reply)).toContain("รวม ฿130");
  });

  it("ordinary chat with a number is never recorded, and gets no reply", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "กินข้าว 100 ไหม"), deps);
    await handleEvent(inGroup("Uanna", "55555 ตลกมาก"), deps);
    expect(entries).toHaveLength(0);
    expect(reply).not.toHaveBeenCalled();
  });

  it("refuses income, more than five entries, and nothing to record", async () => {
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด +500 ขายของ"), deps);
    expect(said(reply)).toContain("จดรายจ่ายเท่านั้น");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "จด a 1, b 2, c 3, d 4, e 5, f 6"), deps);
    expect(said(reply)).toContain("ไม่เกิน 5");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "จด ข้าวอร่อยมาก"), deps);
    expect(said(reply)).toContain("จด ข้าวเที่ยง 350");
    expect(entries).toHaveLength(0);
  });

  it("stops at 300 entries a day for the group", async () => {
    todayCount = 299;
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าว 100, กาแฟ 50"), deps);
    expect(entries).toHaveLength(0);
    expect(said(reply)).toContain("300 รายการ");
  });

  it("asks someone the bot cannot identify to add it as a friend", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup(undefined, "จด ข้าว 100"), deps);
    expect(entries).toHaveLength(0);
    expect(said(reply)).toContain("เพิ่มบอทเป็นเพื่อน");
  });

  it("a group that was never opened is told how to open it", async () => {
    group = null;
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าว 100"), deps);
    expect(said(reply)).toContain("เปิดสมุดกลุ่ม");
  });

  it("when the owner's Elite has run out, writing stops but the summary still works", async () => {
    entries = [
      {
        id: "e0",
        payerLineUserId: "Uanna",
        title: "เก่า",
        amountSatang: 10_000,
        occurredAt: NOW.toISOString(),
      },
    ];
    members.set("Uanna", { name: "แอน", updatedAt: NOW.toISOString() });
    ownerPlan = "free";
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าว 100"), deps);
    expect(said(reply)).toContain("หยุดจดชั่วคราว");
    expect(entries).toHaveLength(1);

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "สรุป"), deps);
    expect(said(reply)).toContain("รวมทั้งกลุ่ม");
  });
});

describe("สรุป / ล่าสุด / ลบล่าสุด", () => {
  beforeEach(() => {
    openBook();
    members.set("Uanna", { name: "แอน", updatedAt: NOW.toISOString() });
    members.set("Ubob", { name: "บ๊อบ", updatedAt: NOW.toISOString() });
    entries = [
      {
        id: "e1",
        payerLineUserId: "Uanna",
        title: "ข้าว",
        amountSatang: 30_000,
        occurredAt: NOW.toISOString(),
      },
      {
        id: "e2",
        payerLineUserId: "Ubob",
        title: "แท็กซี่",
        amountSatang: 70_000,
        occurredAt: NOW.toISOString(),
      },
    ];
  });

  it("the summary says who paid how much", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "สรุป"), deps);
    const text = said(reply);
    expect(text).toContain("฿1,000");
    expect(text).toContain("บ๊อบ");
    expect(text).toContain("฿700 · 70%");
    expect(text).toContain("แอน");
  });

  it("an empty period says so", async () => {
    entries = [];
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "สรุปวันนี้"), deps);
    expect(said(reply)).toContain("ยังไม่มีรายการ");
  });

  it("recent lists the entries with the payer's name", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "ล่าสุด"), deps);
    expect(said(reply)).toContain('"text":"แท็กซี่"');
    expect(said(reply)).toContain("฿700");
    expect(said(reply)).toContain('"text":"บ๊อบ"');
  });

  it("ลบล่าสุด removes the sender's own latest entry, not somebody else's", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "ลบล่าสุด"), deps);
    expect(entries.find((e) => e.id === "e1")?.deleted).toBe(true);
    expect(entries.find((e) => e.id === "e2")?.deleted).toBeUndefined();
    expect(said(reply)).toContain("ลบแล้ว: ข้าว");
  });

  it("someone with no entries has nothing to delete", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Ucarl", "ลบล่าสุด"), deps);
    expect(said(reply)).toContain("ไม่มีรายการของคุณให้ลบ");
  });
});

describe("the undo button", () => {
  beforeEach(() => {
    openBook();
    entries = [
      {
        id: "e1",
        payerLineUserId: "Uanna",
        title: "ข้าว",
        amountSatang: 30_000,
        occurredAt: NOW.toISOString(),
      },
    ];
  });

  it("the writer can remove it", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap("Uanna", "a=gdx&id=e1"), deps);
    expect(entries[0]?.deleted).toBe(true);
    expect(said(reply)).toContain("ลบแล้ว");
  });

  it("the owner can remove anybody's", async () => {
    const { deps } = setup();
    await handleEvent(tap("Uowner", "a=gdx&id=e1"), deps);
    expect(entries[0]?.deleted).toBe(true);
  });

  it("another member cannot", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap("Ubob", "a=gdx&id=e1"), deps);
    expect(entries[0]?.deleted).toBeUndefined();
    expect(said(reply)).toContain("ลบได้เฉพาะรายการของตัวเอง");
  });

  it("a second tap says it is gone", async () => {
    const { deps, reply } = setup();
    await handleEvent(tap("Uanna", "a=gdx&id=e1"), deps);
    await handleEvent(tap("Uanna", "a=gdx&id=e1"), deps);
    expect(said(reply)).toContain("ไม่พบรายการนี้แล้ว");
  });
});

describe("ปิดสมุดกลุ่ม / ช่วยเหลือ", () => {
  beforeEach(openBook);

  it("only the owner can close it", async () => {
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "ปิดสมุดกลุ่ม"), deps);
    expect(closed).toHaveLength(0);
    expect(said(reply)).toContain("เฉพาะเจ้าของสมุด");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uowner", "ปิดสมุดกลุ่ม"), deps);
    expect(closed).toEqual([GID]);
    expect(ended).toEqual([{ groupId: "g1", exceptOwner: undefined }]);
  });

  it("help lists the commands", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "ช่วยเหลือ"), deps);
    expect(said(reply)).toContain("จด ข้าวเที่ยง 350");
  });
});

describe("what the group can never see", () => {
  it("personal commands typed in a group get no answer and touch nothing", async () => {
    openBook();
    const { deps, reply } = setup();
    for (const t of [
      "กระเป๋า",
      "หนี้",
      "เป้าหมาย",
      "บิล",
      "สรุปเดือนนี้ของฉัน",
      "เหรียญสะสม",
      "ค้นหา กาแฟ",
    ]) {
      await handleEvent(inGroup("Uanna", t), deps);
    }
    expect(reply).not.toHaveBeenCalled();
    expect(entries).toHaveLength(0);
  });

  it("a room (multi-person chat) is not handled", async () => {
    const { deps, reply } = setup();
    await handleEvent(
      {
        type: "message",
        replyToken: "rt",
        source: { type: "room", userId: "Uanna" },
        message: { type: "text", text: "จด ข้าว 100" },
      },
      deps,
    );
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("trips: เริ่มทริป / ร่วมทริป", () => {
  beforeEach(() => {
    openBook();
    members.set("Uanna", { name: "แอน", updatedAt: NOW.toISOString() });
    members.set("Ubob", { name: "บ๊อบ", updatedAt: NOW.toISOString() });
    members.set("Ucarl", { name: "คาร์ล", updatedAt: NOW.toISOString() });
  });

  it("any member can start a trip; the starter is on it, and there is a join button", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "เริ่มทริป เที่ยวเชียงใหม่"), deps);
    expect(startedTrips).toEqual([{ name: "เที่ยวเชียงใหม่", startedBy: "Uanna" }]);
    expect(tripMemberIds).toEqual(["Uanna"]);
    const text = said(reply);
    expect(text).toContain("เที่ยวเชียงใหม่");
    expect(text).toContain("แล้ว 🧳");
    expect(text).toContain("a=gtj&t=t1");
  });

  it("only one open trip at a time", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "เริ่มทริป หนึ่ง"), deps);
    await handleEvent(inGroup("Ubob", "เริ่มทริป สอง"), deps);
    expect(startedTrips).toHaveLength(1);
    expect(said(reply)).toContain("มีทริปที่เปิดอยู่แล้ว");
  });

  it("people join by typing or by the button", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "เริ่มทริป ทริป"), deps);
    await handleEvent(inGroup("Ubob", "ร่วมทริป"), deps);
    await handleEvent(tap("Ucarl", "a=gtj&t=t1"), deps);
    expect(tripMemberIds).toEqual(["Uanna", "Ubob", "Ucarl"]);
    expect(said(reply)).toContain("คาร์ล ร่วมทริป");
    expect(said(reply)).toContain("ตอนนี้ 3 คน");
  });

  it("joining with no trip open, or an old button, says there is no trip", async () => {
    let { deps, reply } = setup();
    await handleEvent(inGroup("Ubob", "ร่วมทริป"), deps);
    expect(said(reply)).toContain("ยังไม่มีทริปที่เปิดอยู่");

    trip = {
      id: "t9",
      groupId: "g1",
      name: "x",
      startedBy: "Uanna",
      status: "open",
      createdAt: NOW.toISOString(),
      closedAt: null,
    };
    ({ deps, reply } = setup());
    await handleEvent(tap("Ubob", "a=gtj&t=old"), deps);
    expect(tripMemberIds).toHaveLength(0);
    expect(said(reply)).toContain("ยังไม่มีทริปที่เปิดอยู่");
  });

  it("the owner's lapsed plan stops starting a trip", async () => {
    ownerPlan = "free";
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "เริ่มทริป x"), deps);
    expect(startedTrips).toHaveLength(0);
    expect(said(reply)).toContain("หยุดจดชั่วคราว");
  });
});

describe("จด during a trip", () => {
  beforeEach(() => {
    openBook();
    members.set("Uanna", { name: "แอน", updatedAt: NOW.toISOString() });
    members.set("Ubob", { name: "บ๊อบ", updatedAt: NOW.toISOString() });
    members.set("Ucarl", { name: "คาร์ล", updatedAt: NOW.toISOString() });
    trip = {
      id: "t1",
      groupId: "g1",
      name: "ทริป",
      startedBy: "Uanna",
      status: "open",
      createdAt: NOW.toISOString(),
      closedAt: null,
    };
    tripMemberIds = ["Uanna", "Ubob", "Ucarl"];
  });

  it("is shared equally by everyone on the trip, and the card says so", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าวเย็น 900"), deps);
    expect(entries[0]).toMatchObject({
      tripId: "t1",
      splitUsers: ["Uanna", "Ubob", "Ucarl"],
      amountSatang: 90_000,
    });
    expect(said(reply)).toContain("หาร 3 คน คนละ ฿300");
  });

  it("writing in a trip puts you on it", async () => {
    const { deps } = setup();
    await handleEvent(inGroup("Udan", "จด กาแฟ 90"), deps);
    expect(tripMemberIds).toContain("Udan");
    expect(entries[0]?.splitUsers).toContain("Udan");
  });

  it("หาร: only the named people", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ไวน์ 900 หาร แอน บ๊อบ"), deps);
    expect(entries[0]).toMatchObject({
      title: "ไวน์",
      amountSatang: 90_000,
      splitUsers: ["Uanna", "Ubob"],
    });
    expect(said(reply)).toContain("หาร แอน, บ๊อบ คนละ ฿450");
  });

  it("ไม่หาร: everyone except the named", async () => {
    const { deps } = setup();
    await handleEvent(inGroup("Uanna", "จด ค่าห้อง 3000 ไม่หาร คาร์ล"), deps);
    expect(entries[0]?.splitUsers).toEqual(["Uanna", "Ubob"]);
  });

  it("odd satang: the card says about", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ขนม 100"), deps); // 100.00 / 3
    expect(said(reply)).toContain("คนละประมาณ ฿33.34");
  });

  it("a name nobody on the trip has: nothing is recorded and it says who", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ไวน์ 900 หาร แอน นก"), deps);
    expect(entries).toHaveLength(0);
    expect(said(reply)).toContain("ไม่รู้จัก นก");
  });

  it("outside a trip หาร is refused with the way to start one", async () => {
    trip = null;
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ไวน์ 900 หาร แอน บ๊อบ"), deps);
    expect(entries).toHaveLength(0);
    expect(said(reply)).toContain("เริ่มทริป ชื่อทริป");
  });

  it("outside a trip an entry has no trip and no split", async () => {
    trip = null;
    const { deps } = setup();
    await handleEvent(inGroup("Uanna", "จด ข้าว 100"), deps);
    expect(entries[0]).toMatchObject({ tripId: null, splitUsers: [] });
  });
});

describe("currency in the group", () => {
  beforeEach(() => {
    openBook();
    members.set("Uanna", { name: "แอน", updatedAt: NOW.toISOString() });
  });

  it("a currency after the amount is converted to baht at that day's rate and the original kept", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ราเมน 1500 JPY"), deps);
    expect(entries[0]).toMatchObject({
      title: "ราเมน",
      amountSatang: 35_025,
      origCurrency: "JPY",
      origMinor: 150_000,
      fxRate: 0.2335,
    });
    expect(said(reply)).toContain("1,500 JPY @ 0.2335");
  });

  it("an amount with no currency is baht", async () => {
    const { deps } = setup();
    await handleEvent(inGroup("Uanna", "จด ราเมน 1500"), deps);
    expect(entries[0]).toMatchObject({ amountSatang: 150_000, origCurrency: null });
  });

  it("works together with a split in a trip", async () => {
    trip = {
      id: "t1",
      groupId: "g1",
      name: "ญี่ปุ่น",
      startedBy: "Uanna",
      status: "open",
      createdAt: NOW.toISOString(),
      closedAt: null,
    };
    tripMemberIds = ["Uanna", "Ubob"];
    members.set("Ubob", { name: "บ๊อบ", updatedAt: NOW.toISOString() });
    const { deps } = setup();
    await handleEvent(inGroup("Uanna", "จด ตั๋ว 3000 JPY ไม่หาร บ๊อบ"), deps);
    expect(entries[0]).toMatchObject({
      amountSatang: 70_050,
      splitUsers: ["Uanna"],
      origCurrency: "JPY",
    });
  });

  it("no rate, or VND/TWD: nothing is recorded", async () => {
    fxAnswer = null;
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จด ราเมน 1500 JPY"), deps);
    expect(said(reply)).toContain("ดึงอัตราแลกเปลี่ยนไม่ได้");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "จด ข้าว 50000 VND"), deps);
    expect(said(reply)).toContain("ยังไม่รองรับสกุล VND");
    expect(entries).toHaveLength(0);
  });
});

describe("สรุปทริป / จบทริป / ทริปเก่า / ทริป", () => {
  const baht = (n: number) => n * 100;
  beforeEach(() => {
    openBook();
    members.set("Uanna", { name: "แอน", updatedAt: NOW.toISOString() });
    members.set("Ubob", { name: "บ๊อบ", updatedAt: NOW.toISOString() });
    members.set("Ucarl", { name: "คาร์ล", updatedAt: NOW.toISOString() });
    trip = {
      id: "t1",
      groupId: "g1",
      name: "เชียงใหม่",
      startedBy: "Uanna",
      status: "open",
      createdAt: NOW.toISOString(),
      closedAt: null,
    };
    tripMemberIds = ["Uanna", "Ubob", "Ucarl"];
    entries = [
      {
        id: "e1",
        payerLineUserId: "Uanna",
        title: "ข้าว",
        amountSatang: baht(900),
        occurredAt: NOW.toISOString(),
        tripId: "t1",
        splitUsers: ["Uanna", "Ubob", "Ucarl"],
      },
      {
        id: "e2",
        payerLineUserId: "Ubob",
        title: "แท็กซี่",
        amountSatang: baht(200),
        occurredAt: NOW.toISOString(),
        tripId: "t1",
        splitUsers: ["Uanna", "Ubob"],
      },
    ];
  });

  it("says who must transfer whom, and how much", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Ubob", "สรุปทริป"), deps);
    const text = said(reply);
    expect(text).toContain("เชียงใหม่");
    expect(text).toContain("฿1,100"); // total
    expect(text).toContain("คาร์ล → แอน");
    expect(text).toContain("฿300");
    expect(text).toContain("บ๊อบ → แอน");
    expect(text).toContain("฿200");
    expect(text).toContain("ทริปกำลังดำเนินอยู่");
  });

  it("the trip status lists who is on it and the total", async () => {
    const { deps, reply } = setup();
    await handleEvent(inGroup("Ubob", "ทริป"), deps);
    expect(said(reply)).toContain("ร่วมทริป 3 คน: แอน, บ๊อบ, คาร์ล");
    expect(said(reply)).toContain("2 รายการ รวม ฿1,100");
  });

  it("the starter or the owner can close it; nobody else", async () => {
    let { deps, reply } = setup();
    await handleEvent(inGroup("Ubob", "จบทริป"), deps);
    expect(closedTripIds).toHaveLength(0);
    expect(said(reply)).toContain("เฉพาะคนที่เริ่มทริปหรือเจ้าของสมุด");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "จบทริป"), deps);
    expect(closedTripIds).toEqual(["t1"]);
    expect(said(reply)).toContain("จบทริป");
    expect(said(reply)).toContain("ปิดทริปแล้ว");
  });

  it("the owner can close a trip somebody else started", async () => {
    const { deps } = setup();
    await handleEvent(inGroup("Uowner", "จบทริป"), deps);
    expect(closedTripIds).toEqual(["t1"]);
  });

  it("after closing, new entries are not part of the trip and สรุปทริป shows the closed one", async () => {
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จบทริป"), deps);
    await handleEvent(inGroup("Uanna", "จด ข้าว 50"), deps);
    expect(entries.at(-1)).toMatchObject({ tripId: null });

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Ubob", "สรุปทริป"), deps);
    expect(said(reply)).toContain("ปิดทริปแล้ว");
  });

  it("ทริปเก่า lists closed trips with totals", async () => {
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "จบทริป"), deps);
    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "ทริปเก่า"), deps);
    expect(said(reply)).toContain("เชียงใหม่");
    expect(said(reply)).toContain("฿1,100");
  });

  it("with no trip ever: says how to start one; no open trip: closing says so", async () => {
    trip = null;
    let { deps, reply } = setup();
    await handleEvent(inGroup("Uanna", "สรุปทริป"), deps);
    expect(said(reply)).toContain("ยังไม่เคยมีทริป");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "จบทริป"), deps);
    expect(said(reply)).toContain("ยังไม่มีทริปที่เปิดอยู่");

    ({ deps, reply } = setup());
    await handleEvent(inGroup("Uanna", "ทริปเก่า"), deps);
    expect(said(reply)).toContain("ยังไม่มีทริปที่จบแล้ว");
  });
});
