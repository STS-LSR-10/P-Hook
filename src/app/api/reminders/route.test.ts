import { beforeEach, describe, expect, it, vi } from "vitest";
import { reminderCapacity, repeatCapacity } from "@/lib/user-reminder";

let plan = "plus";
const FREE_ONCE = reminderCapacity("free");
const PRO_ONCE = reminderCapacity("plus");
const ULT_ONCE = reminderCapacity("ultimate");
const FREE_REPEAT = repeatCapacity("free");
const PRO_REPEAT = repeatCapacity("plus");
const ULT_REPEAT = repeatCapacity("ultimate");

let active = 0;
/** Repeating reminders waiting (their own limit); `active` is the one-offs. */
let repeating = 0;
const created: Record<string, unknown>[] = [];
const cancelled: string[] = [];
let found = true;
let limited = false;
const R = "11111111-1111-4111-8111-111111111111";
const edits: Record<string, unknown>[] = [];
const calls: string[] = [];
let pageItems: unknown[] = [];
let stored: Record<string, unknown> | null = null;

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () =>
    limited ? new Response(JSON.stringify({ error: "x" }), { status: 429 }) : null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
const OWN = "22222222-2222-4222-8222-222222222222";
vi.mock("@/lib/reminder-category-repo", () => ({
  listReminderCategories: async () => [{ id: OWN, name: "วิ่ง", emoji: "🏃" }],
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  listReminders: async () => Array.from({ length: active }, (_, i) => ({ id: `r${i}` })),
  countActiveReminders: async (_db: unknown, _u: string, kind?: string) =>
    kind === "repeat" ? repeating : active,
  createReminder: async (_db: unknown, _u: string, input: Record<string, unknown>) => {
    created.push(input);
    return { id: R, body: input.body, remindAt: String(input.remindAt), repeat: input.repeat };
  },
  listRemindersForPage: async () => pageItems,
  getReminder: async () => stored,
  updateReminder: async (_db: unknown, _u: string, id: string, input: Record<string, unknown>) => {
    edits.push({ id, ...input });
    return stored;
  },
  setReminderDone: async () => {
    calls.push("done");
    return found;
  },
  reopenReminder: async () => {
    calls.push("reopen");
    return found;
  },
  skipReminderRound: async (_db: unknown, _u: string, _id: string, from: string, to: Date) => {
    calls.push(`moved:${new Date(from).toISOString()}>${to.toISOString()}`);
    return found;
  },
  cancelReminder: async (_db: unknown, _u: string, id: string) => {
    cancelled.push(id);
    return found;
  },
}));

import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const soon = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const req = (method: string, body?: unknown) =>
  new Request("https://app.example.com/api/reminders", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  plan = "plus";
  active = 0;
  repeating = 0;
  found = true;
  limited = false;
  created.length = 0;
  cancelled.length = 0;
  edits.length = 0;
  calls.length = 0;
  pageItems = [];
  stored = {
    id: R,
    body: "กินยา",
    remindAt: new Date(Date.now() + 86_400_000).toISOString(),
    repeat: null,
    status: "active",
    category: null,
  };
});

describe("GET /api/reminders", () => {
  it("says what the plan allows", async () => {
    active = FREE_ONCE;
    plan = "free";
    expect(await (await GET(req("GET"))).json()).toMatchObject({
      limit: FREE_ONCE,
      canAddOnce: false,
    });
    repeating = FREE_REPEAT;
    expect(await (await GET(req("GET"))).json()).toMatchObject({ canAdd: false });
    plan = "plus";
    expect(await (await GET(req("GET"))).json()).toMatchObject({ limit: PRO_ONCE, canAdd: true });
  });
});

describe("POST /api/reminders", () => {
  it("saves a one-off or a repeating reminder", async () => {
    expect((await POST(req("POST", { body: " จ่ายค่าไฟ ", remindAt: soon() }))).status).toBe(201);
    expect(created[0]).toMatchObject({ body: "จ่ายค่าไฟ", repeat: null });
    expect(
      (await POST(req("POST", { body: "กินยา", remindAt: soon(), repeat: "daily" }))).status,
    ).toBe(201);
    expect(created[1]).toMatchObject({ repeat: "daily" });
  });

  it.each([
    [{ body: "", remindAt: "x" }],
    [{ body: "ก", remindAt: "not a date" }],
    [{ body: "ก", remindAt: "2026-10-29T02:00:00Z", repeat: "yearly" }],
    [{ body: "ก".repeat(201), remindAt: "2026-10-29T02:00:00Z" }],
    [{}],
  ])("%j is refused", async (body) => {
    expect((await POST(req("POST", body))).status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("refuses a time that has gone by and one more than a year ahead", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString();
    expect((await POST(req("POST", { body: "ก", remindAt: past }))).status).toBe(400);
    expect((await POST(req("POST", { body: "ก", remindAt: far }))).status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it("each plan stops at its own number of waiting reminders (Free 10, Pro 100, Elite 250)", async () => {
    plan = "free";
    active = FREE_ONCE;
    const free = await POST(req("POST", { body: "ก", remindAt: soon() }));
    expect(free.status).toBe(409);
    expect(await free.json()).toMatchObject({ upgrade: true });
    plan = "plus";
    active = PRO_ONCE - 1;
    expect((await POST(req("POST", { body: "ก", remindAt: soon() }))).status).toBe(201);
    active = PRO_ONCE;
    expect((await POST(req("POST", { body: "ก", remindAt: soon() }))).status).toBe(409);
    plan = "ultimate";
    active = ULT_ONCE;
    expect(await (await POST(req("POST", { body: "ก", remindAt: soon() }))).json()).toMatchObject({
      upgrade: false,
    });
  });
});

describe("repeating reminders have their own limit", () => {
  it("each plan has its own number of repeating ones (Free 1, Pro 50, Elite 100), apart from the one-offs", async () => {
    plan = "free";
    repeating = FREE_REPEAT;
    const full = await POST(req("POST", { body: "ก", remindAt: soon(), repeat: "daily" }));
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: string }).error).toContain("เตือนประจำ");
    // a one-off still fits
    expect((await POST(req("POST", { body: "ก", remindAt: soon() }))).status).toBe(201);
    plan = "plus";
    repeating = PRO_REPEAT - 1;
    expect(
      (await POST(req("POST", { body: "ก", remindAt: soon(), repeat: "weekly" }))).status,
    ).toBe(201);
    repeating = PRO_REPEAT;
    expect(
      (await POST(req("POST", { body: "ก", remindAt: soon(), repeat: "weekly" }))).status,
    ).toBe(409);
    plan = "ultimate";
    repeating = ULT_REPEAT;
    expect(
      (await POST(req("POST", { body: "ก", remindAt: soon(), repeat: "monthly" }))).status,
    ).toBe(409);
  });

  it("one-offs full do not stop a repeating one", async () => {
    plan = "free";
    active = FREE_ONCE;
    expect((await POST(req("POST", { body: "ก", remindAt: soon(), repeat: "daily" }))).status).toBe(
      201,
    );
  });

  it("GET gives each kind's count and limit; it can add while either has room", async () => {
    plan = "free";
    active = FREE_ONCE;
    repeating = 0;
    expect(await (await GET(req("GET"))).json()).toMatchObject({
      limit: FREE_ONCE,
      repeatLimit: FREE_REPEAT,
      active: FREE_ONCE,
      repeating: 0,
      canAdd: true,
      canAddOnce: false,
      canAddRepeat: true,
    });
  });

  it("turning a waiting one-off into a repeat needs room among the repeats", async () => {
    plan = "free";
    repeating = FREE_REPEAT;
    const res = await PATCH(
      new Request(`https://app.example.com/api/reminders/${R}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "กินยา", remindAt: soon(), repeat: "daily" }),
      }),
      { params: Promise.resolve({ id: R }) },
    );
    expect(res.status).toBe(409);
    expect(edits).toEqual([]);
  });

  it("an edit that keeps a waiting repeat a repeat needs no more room", async () => {
    plan = "free";
    repeating = FREE_REPEAT;
    stored = { ...stored, repeat: "daily" };
    const res = await PATCH(
      new Request(`https://app.example.com/api/reminders/${R}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "กินยาเย็น", remindAt: soon(), repeat: "daily" }),
      }),
      { params: Promise.resolve({ id: R }) },
    );
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/reminders/:id", () => {
  it("cancels the person's own reminder, 404 otherwise", async () => {
    const ok = await DELETE(req("DELETE"), { params: Promise.resolve({ id: R }) });
    expect(ok.status).toBe(200);
    expect(cancelled).toEqual([R]);
    found = false;
    expect((await DELETE(req("DELETE"), { params: Promise.resolve({ id: R }) })).status).toBe(404);
    expect((await DELETE(req("DELETE"), { params: Promise.resolve({ id: "../x" }) })).status).toBe(
      404,
    );
  });
});

describe("reminders on the page", () => {
  const params = { params: Promise.resolve({ id: R }) };
  const patch = (body: unknown) => PATCH(req("PATCH", body), params);
  const future = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
  const past = () => new Date(Date.now() - 3_600_000).toISOString();

  it("lists done ones too, and counts only those waiting", async () => {
    active = 1;
    pageItems = [
      { id: "a", status: "active" },
      { id: "b", status: "done" },
    ];
    const res = await GET(req("GET"));
    expect(await res.json()).toMatchObject({
      items: pageItems,
      active: 1,
      limit: PRO_ONCE,
      canAdd: true,
    });
  });

  it("keeps the category of a new reminder", async () => {
    const res = await POST(req("POST", { body: "a", remindAt: soon(), category: "health" }));
    expect(res.status).toBe(201);
    expect(created[0]?.category).toBe("health");
  });

  it("refuses an unknown category", async () => {
    const res = await POST(req("POST", { body: "a", remindAt: soon(), category: "x" }));
    expect(res.status).toBe(400);
  });

  it("takes a new built-in category and one of the person's own", async () => {
    expect(
      (await POST(req("POST", { body: "a", remindAt: soon(), category: "travel" }))).status,
    ).toBe(201);
    expect((await POST(req("POST", { body: "a", remindAt: soon(), category: OWN }))).status).toBe(
      201,
    );
    expect(created.map((c) => c.category)).toEqual(["travel", OWN]);
    expect(created.every((c) => c.via === "page")).toBe(true);
  });

  it("refuses an id that is not one of the person's categories", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const res = await POST(req("POST", { body: "a", remindAt: soon(), category: other }));
    expect(res.status).toBe(400);
  });

  it("GET gives the person's own categories", async () => {
    const res = await GET(req("GET"));
    expect(await res.json()).toMatchObject({
      categories: [{ id: OWN, name: "วิ่ง", emoji: "🏃" }],
    });
  });

  it("edits a reminder", async () => {
    const remindAt = future();
    const res = await patch({ body: "ใหม่", remindAt, repeat: "daily", category: "work" });
    expect(res.status).toBe(200);
    expect(edits[0]).toMatchObject({ id: R, body: "ใหม่", repeat: "daily", category: "work" });
  });

  it("refuses an edit to a time that has passed", async () => {
    expect((await patch({ body: "a", remindAt: past() })).status).toBe(400);
    expect(edits).toEqual([]);
  });

  it("an edit that brings a done one back needs room in the plan", async () => {
    stored = { ...stored, status: "done" };
    plan = "free";
    active = FREE_ONCE;
    expect((await patch({ body: "a", remindAt: future() })).status).toBe(409);
    expect(edits).toEqual([]);
  });

  const seen = () => String(stored?.remindAt);

  it("a one-off that is ticked is done", async () => {
    expect((await patch({ action: "done", remindAt: seen() })).status).toBe(200);
    expect(calls).toEqual(["done"]);
  });

  it("a repeat that is ticked skips its round, and goes on", async () => {
    const remindAt = "2030-01-01T02:00:00.000Z";
    stored = { ...stored, repeat: "daily", remindAt };
    expect((await patch({ action: "done", remindAt })).status).toBe(200);
    expect(calls).toEqual(["moved:2030-01-01T02:00:00.000Z>2030-01-02T02:00:00.000Z"]);
  });

  it("a tick needs to say which round", async () => {
    expect((await patch({ action: "done" })).status).toBe(400);
  });

  it("a tick on a round that has moved skips nothing", async () => {
    stored = { ...stored, repeat: "daily", remindAt: "2030-01-02T02:00:00.000Z" };
    const res = await patch({ action: "done", remindAt: "2030-01-01T02:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("the same moment in another form is the same round", async () => {
    stored = { ...stored, repeat: "daily", remindAt: "2030-01-01T02:00:00+00:00" };
    const res = await patch({ action: "done", remindAt: "2030-01-01T02:00:00.000Z" });
    expect(res.status).toBe(200);
  });

  it("a tick the job got to first says so", async () => {
    found = false;
    const res = await patch({ action: "done", remindAt: seen() });
    expect(res.status).toBe(409);
  });

  it("fixing the name of a ticked one keeps the tick", async () => {
    stored = { ...stored, status: "done" };
    const res = await patch({ body: "แก้คำ", remindAt: seen() });
    expect(res.status).toBe(200);
    expect(edits[0]?.status).toBe("done");
  });

  it("fixing the name of one that has gone by needs no new time", async () => {
    stored = { ...stored, status: "done", remindAt: past() };
    const res = await patch({ body: "แก้คำ", remindAt: seen() });
    expect(res.status).toBe(200);
  });

  it("a new time brings a ticked one back", async () => {
    stored = { ...stored, status: "done" };
    await patch({ body: "a", remindAt: future() });
    expect(edits[0]?.status).toBe("active");
  });

  it("deleting has the write limit", async () => {
    limited = true;
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(429);
    expect(cancelled).toEqual([]);
  });

  it("taking a tick back reopens one still ahead", async () => {
    stored = { ...stored, status: "done" };
    expect((await patch({ action: "undo" })).status).toBe(200);
    expect(calls).toEqual(["reopen"]);
  });

  it("a tick cannot be taken back once its time has gone", async () => {
    stored = { ...stored, status: "done", remindAt: past() };
    expect((await patch({ action: "undo" })).status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("taking a tick back needs room in the plan", async () => {
    stored = { ...stored, status: "done" };
    plan = "free";
    active = FREE_ONCE;
    expect((await patch({ action: "undo" })).status).toBe(409);
  });

  it("a done one-off edited into a repeat needs room among the repeats", async () => {
    stored = { ...stored, status: "done" };
    plan = "free";
    repeating = FREE_REPEAT;
    expect((await patch({ body: "a", remindAt: future(), repeat: "daily" })).status).toBe(409);
    repeating = 0;
    active = FREE_ONCE; // the one-offs being full does not matter for a repeat
    expect((await patch({ body: "a", remindAt: future(), repeat: "daily" })).status).toBe(200);
  });

  it("taking a tick back on a repeat needs room among the repeats", async () => {
    stored = { ...stored, status: "done", repeat: "weekly" };
    plan = "free";
    repeating = FREE_REPEAT;
    expect((await patch({ action: "undo" })).status).toBe(409);
    repeating = 0;
    active = FREE_ONCE;
    expect((await patch({ action: "undo" })).status).toBe(200);
  });

  it("fixing the name of a ticked one needs no room, even when full", async () => {
    stored = { ...stored, status: "done" };
    plan = "free";
    active = FREE_ONCE;
    repeating = FREE_REPEAT;
    const res = await patch({ body: "ชื่อใหม่", remindAt: String(stored?.remindAt) });
    expect(res.status).toBe(200);
    expect(edits[0]).toMatchObject({ status: "done" });
  });

  it("is 404 for a reminder that is not theirs", async () => {
    stored = null;
    expect((await patch({ action: "done", remindAt: future() })).status).toBe(404);
  });

  it("refuses what it does not know", async () => {
    expect((await patch({ action: "x" })).status).toBe(400);
  });
});
