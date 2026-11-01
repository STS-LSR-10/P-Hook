import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getReminder,
  listRemindersForPage,
  reopenReminder,
  rescheduleReminder,
  setReminderDone,
  skipReminderRound,
  updateReminder,
} from "./user-reminder-repo";

function fakeDb(row: unknown, rows: unknown[] = []) {
  const filters: [string, unknown][] = [];
  const sets: Record<string, unknown>[] = [];
  const chain = {
    update(v: Record<string, unknown>) {
      sets.push(v);
      return chain;
    },
    eq(k: string, v: unknown) {
      filters.push([k, v]);
      return chain;
    },
    select: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { db: { from: () => chain } as unknown as SupabaseClient, filters, sets };
}

const when = new Date("2026-11-02T12:00:00Z");
const input = { remindAt: when, repeat: "daily" as const };

describe("rescheduleReminder", () => {
  it("moves only their own reminder that is still waiting", async () => {
    const { db, filters, sets } = fakeDb({
      id: "r1",
      body: "กินยา",
      remind_at: when.toISOString(),
      repeat: "daily",
    });
    const moved = await rescheduleReminder(db, "u1", "r1", input);
    expect(moved?.remindAt).toBe(when.toISOString());
    expect(filters).toEqual([
      ["id", "r1"],
      ["user_id", "u1"],
      ["status", "active"],
    ]);
    expect(sets[0]).toEqual({
      remind_at: when.toISOString(),
      repeat: "daily",
      last_sent_at: null,
    });
  });

  it("is null when the reminder has gone", async () => {
    await expect(rescheduleReminder(fakeDb(null).db, "u1", "r1", input)).resolves.toBeNull();
  });
});

describe("the reminders of the page", () => {
  const row = (id: string, status: string) => ({
    id,
    body: "a",
    remind_at: when.toISOString(),
    repeat: null,
    status,
    category: "work",
  });

  it("reads the status and the category", async () => {
    const { db } = fakeDb(null, [row("r1", "done")]);
    const items = await listRemindersForPage(db, "u1");
    expect(items[0]).toMatchObject({ status: "done", category: "work" });
  });

  it("has a default for what the old rows lack", async () => {
    const { db } = fakeDb({ id: "r1", body: "a", remind_at: when.toISOString(), repeat: null });
    await expect(getReminder(db, "u1", "r1")).resolves.toMatchObject({
      status: "active",
      category: null,
    });
  });
});

describe("skipping a round", () => {
  it("moves it only from the round the person saw", async () => {
    const row = { id: "r1" };
    const { db, filters, sets } = fakeDb(row);
    const seen = "2026-11-02T11:00:00+00:00";
    await expect(skipReminderRound(db, "u1", "r1", seen, when)).resolves.toBe(true);
    expect(filters).toEqual([
      ["id", "r1"],
      ["user_id", "u1"],
      ["status", "active"],
      ["remind_at", seen],
    ]);
    expect(sets[0]).toEqual({ remind_at: when.toISOString() });
  });

  it("is false when the round has moved", async () => {
    await expect(skipReminderRound(fakeDb(null).db, "u1", "r1", "x", when)).resolves.toBe(false);
  });
});

describe("changing a reminder", () => {
  const row = { id: "r1", body: "a", remind_at: when.toISOString(), repeat: null };

  it("an edit brings it back to waiting, as a new time", async () => {
    const { db, filters, sets } = fakeDb(row);
    await updateReminder(db, "u1", "r1", {
      body: "b",
      remindAt: when,
      repeat: null,
      category: "bill",
      status: "active",
    });
    expect(filters).toEqual([
      ["id", "r1"],
      ["user_id", "u1"],
    ]);
    expect(sets[0]).toEqual({
      body: "b",
      remind_at: when.toISOString(),
      repeat: null,
      category: "bill",
      status: "active",
      last_sent_at: null,
    });
  });

  it("an edit that keeps the tick leaves the rest alone", async () => {
    const { db, sets } = fakeDb(row);
    await updateReminder(db, "u1", "r1", {
      body: "b",
      remindAt: when,
      repeat: null,
      category: null,
      status: "done",
    });
    expect(sets[0]).toMatchObject({ status: "done" });
    expect(sets[0]).not.toHaveProperty("last_sent_at");
  });

  it("done applies only to one still waiting", async () => {
    const { db, filters, sets } = fakeDb(row);
    await expect(setReminderDone(db, "u1", "r1")).resolves.toBe(true);
    expect(filters).toContainEqual(["status", "active"]);
    expect(sets[0]).toEqual({ status: "done" });
  });

  it("reopening applies only to one done", async () => {
    const { db, filters, sets } = fakeDb(row);
    await expect(reopenReminder(db, "u1", "r1")).resolves.toBe(true);
    expect(filters).toContainEqual(["status", "done"]);
    expect(sets[0]).toEqual({ status: "active" });
  });

  it("is false when the job got there first", async () => {
    await expect(setReminderDone(fakeDb(null).db, "u1", "r1")).resolves.toBe(false);
  });
});
