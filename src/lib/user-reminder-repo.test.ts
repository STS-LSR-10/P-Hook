import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { rescheduleReminder } from "./user-reminder-repo";

function fakeDb(row: unknown) {
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
