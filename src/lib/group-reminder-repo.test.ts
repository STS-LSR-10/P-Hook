import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  addLateReminder,
  purgeLateReminders,
  reminderTargets,
  takeGroupRiders,
} from "./group-reminder-repo";
import { refundUsageAmount, takeUsageAmount } from "./usage";
import { createReminder } from "./user-reminder-repo";

const NOW = new Date("2026-11-03T03:00:00Z");

function fakeDb(data: unknown = null) {
  const calls: unknown[][] = [];
  const done = { data, error: null };
  const note =
    (name: string) =>
    (...a: unknown[]) => (calls.push([name, ...a]), chain);
  const chain: Record<string, unknown> = {
    select: note("select"),
    insert: note("insert"),
    delete: note("delete"),
    eq: note("eq"),
    in: note("in"),
    lt: note("lt"),
    single: async () => done,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(done).then(ok),
  };
  const db = {
    from: (t: string) => (calls.push(["from", t]), chain),
    rpc: async (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), done),
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("a group's reminders that ride on a message", () => {
  it("are those within 5 minutes of now, and those waiting since a push could not go", async () => {
    const { db, calls } = fakeDb([
      {
        r_body: "ส่งงาน",
        r_repeat: null,
        r_mentions: [{ label: "@bot1", userId: "U1" }],
        r_due: "2026-11-03T03:02:00Z",
        r_late: false,
      },
      {
        r_body: "ประชุม",
        r_repeat: "daily",
        r_mentions: null,
        r_due: "2026-11-02T23:00:00Z",
        r_late: true,
      },
    ]);
    const riders = await takeGroupRiders(db, "C1", NOW);
    expect(calls[0]).toEqual([
      "rpc",
      "take_group_reminders_near",
      { p_line_group: "C1", p_now: NOW.toISOString(), p_window: "5 minutes" },
    ]);
    expect(riders).toEqual([
      {
        body: "ส่งงาน",
        repeat: null,
        mentions: [{ label: "@bot1", userId: "U1" }],
        dueAt: "2026-11-03T03:02:00Z",
        late: false,
      },
      { body: "ประชุม", repeat: "daily", mentions: [], dueAt: "2026-11-02T23:00:00Z", late: true },
    ]);
  });
});

describe("a reminder's group and tags", () => {
  it("are read for the reminders the cron took", async () => {
    const { db, calls } = fakeDb([
      { id: "r1", group_id: "g1", mentions: [{ label: "@All", all: true }] },
      { id: "r2", group_id: null, mentions: null },
    ]);
    const map = await reminderTargets(db, ["r1", "r2"]);
    expect(calls).toContainEqual(["in", "id", ["r1", "r2"]]);
    expect(map.get("r1")).toEqual({ groupId: "g1", mentions: [{ label: "@All", all: true }] });
    expect(map.get("r2")).toEqual({ groupId: null, mentions: [] });
  });

  it("are not asked for when there are none", async () => {
    const { db, calls } = fakeDb([]);
    expect((await reminderTargets(db, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("are kept with a reminder set in a group", async () => {
    const { db, calls } = fakeDb({
      id: "r1",
      body: "x",
      remind_at: NOW.toISOString(),
      repeat: null,
    });
    await createReminder(db, "u1", {
      body: "x",
      remindAt: NOW,
      repeat: null,
      groupId: "g1",
      createdBy: "Uanna",
      mentions: [{ label: "@bot1", userId: "U1" }],
    });
    const insert = calls.find((c) => c[0] === "insert");
    expect(insert?.[1]).toMatchObject({ mentions: [{ label: "@bot1", userId: "U1" }] });
  });
});

describe("a reminder waiting for the next message", () => {
  it("waits 12 hours from its time", async () => {
    const { db, calls } = fakeDb();
    await addLateReminder(db, {
      groupId: "g1",
      body: "ส่งงาน",
      repeat: null,
      mentions: [],
      dueAt: NOW,
    });
    const insert = calls.find((c) => c[0] === "insert");
    expect(insert?.[1]).toEqual({
      group_id: "g1",
      body: "ส่งงาน",
      repeat: null,
      mentions: [],
      due_at: NOW.toISOString(),
      expires_at: "2026-11-03T15:00:00.000Z",
    });
  });

  it("is forgotten once its 12 hours are over", async () => {
    const { db, calls } = fakeDb();
    await purgeLateReminders(db, NOW);
    expect(calls).toContainEqual(["from", "group_late_reminders"]);
    expect(calls).toContainEqual(["lt", "expires_at", NOW.toISOString()]);
  });
});

describe("a count taken several at a time", () => {
  it("takes and gives back the amount asked", async () => {
    const { db, calls } = fakeDb(true);
    await expect(takeUsageAmount(db, "u1", "group_push", 20, 300, "2026-11-01")).resolves.toBe(
      true,
    );
    await refundUsageAmount(db, "u1", "group_push", 20, "2026-11-01");
    expect(calls).toEqual([
      [
        "rpc",
        "take_usage_amount",
        { p_user: "u1", p_kind: "group_push", p_month: "2026-11-01", p_amount: 20, p_limit: 300 },
      ],
      [
        "rpc",
        "refund_usage_amount",
        { p_user: "u1", p_kind: "group_push", p_month: "2026-11-01", p_amount: 20 },
      ],
    ]);
  });
});
