import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "plus";
let active = 0;
const created: Record<string, unknown>[] = [];
const cancelled: string[] = [];
let found = true;
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
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/user-reminder-repo", () => ({
  listReminders: async () => Array.from({ length: active }, (_, i) => ({ id: `r${i}` })),
  countActiveReminders: async () => active,
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
  rescheduleReminder: async (_db: unknown, _u: string, _id: string, input: { remindAt: Date }) => {
    calls.push(`moved:${input.remindAt.toISOString()}`);
    return found ? stored : null;
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
  found = true;
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
    active = 3;
    plan = "free";
    expect(await (await GET(req("GET"))).json()).toMatchObject({ limit: 3, canAdd: false });
    plan = "plus";
    expect(await (await GET(req("GET"))).json()).toMatchObject({ limit: 30, canAdd: true });
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

  it("Free stops at 3 waiting reminders, Pro at 30, Elite at 100", async () => {
    plan = "free";
    active = 3;
    const free = await POST(req("POST", { body: "ก", remindAt: soon() }));
    expect(free.status).toBe(409);
    expect(await free.json()).toMatchObject({ upgrade: true });
    plan = "plus";
    active = 29;
    expect((await POST(req("POST", { body: "ก", remindAt: soon() }))).status).toBe(201);
    active = 30;
    expect((await POST(req("POST", { body: "ก", remindAt: soon() }))).status).toBe(409);
    plan = "ultimate";
    active = 100;
    expect(await (await POST(req("POST", { body: "ก", remindAt: soon() }))).json()).toMatchObject({
      upgrade: false,
    });
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
      limit: 30,
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
    active = 3;
    expect((await patch({ body: "a", remindAt: future() })).status).toBe(409);
    expect(edits).toEqual([]);
  });

  it("a one-off that is ticked is done", async () => {
    expect((await patch({ action: "done" })).status).toBe(200);
    expect(calls).toEqual(["done"]);
  });

  it("a repeat that is ticked skips its round, and goes on", async () => {
    const remindAt = "2030-01-01T02:00:00.000Z";
    stored = { ...stored, repeat: "daily", remindAt };
    expect((await patch({ action: "done" })).status).toBe(200);
    expect(calls).toEqual(["moved:2030-01-02T02:00:00.000Z"]);
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
    active = 3;
    expect((await patch({ action: "undo" })).status).toBe(409);
  });

  it("is 404 for a reminder that is not theirs", async () => {
    stored = null;
    expect((await patch({ action: "done" })).status).toBe(404);
  });

  it("is 404 when the job sent it first", async () => {
    found = false;
    expect((await patch({ action: "done" })).status).toBe(404);
  });

  it("refuses what it does not know", async () => {
    expect((await patch({ action: "x" })).status).toBe(400);
  });
});
