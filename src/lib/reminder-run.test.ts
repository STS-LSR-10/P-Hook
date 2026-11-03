import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { runReminders } from "./reminder-run";

/** Two Pro people who asked to be nudged at 20:00, one in Bangkok and one in Tokyo. */
function fakeDb() {
  const marked: { user: unknown; on: unknown }[] = [];
  const counted: { from: unknown; to: unknown }[] = [];
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => ((filters[k] = v), chain),
        not: () => chain,
        in: () => chain,
        gte: (_k: string, v: unknown) => ((filters.from = v), chain),
        lt: (_k: string, v: unknown) => ((filters.to = v), chain),
        order: () => chain,
        update: (v: Record<string, unknown>) => ((filters.update = v.last_reminded_on), chain),
        limit: async () =>
          table === "user_settings"
            ? {
                data: [
                  {
                    user_id: "bkk",
                    daily_reminder_time: "20:00:00",
                    last_reminded_on: null,
                    users: { timezone: "Asia/Bangkok" },
                  },
                  {
                    user_id: "tyo",
                    daily_reminder_time: "20:00:00",
                    last_reminded_on: null,
                    users: { timezone: "Asia/Tokyo" },
                  },
                ],
                error: null,
              }
            : { data: [], error: null },
        then: (ok: (v: unknown) => unknown) => {
          if (table === "users")
            return Promise.resolve({
              data: [
                { id: "bkk", line_user_id: "Ubkk", plan: "plus", plan_expires_at: null },
                { id: "tyo", line_user_id: "Utyo", plan: "plus", plan_expires_at: null },
              ],
              error: null,
            }).then(ok);
          if (table === "transactions") {
            counted.push({ from: filters.from, to: filters.to });
            return Promise.resolve({ count: 0, error: null }).then(ok);
          }
          if (table === "user_settings" && "update" in filters) {
            marked.push({ user: filters.user_id, on: filters.update });
          }
          return Promise.resolve({ data: [], error: null }).then(ok);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, marked, counted };
}

describe("the daily nudge", () => {
  it("comes at the chosen time in each person's own zone", async () => {
    const { db, marked, counted } = fakeDb();
    const push = vi.fn(async () => undefined);
    // 11:00 UTC: 18:00 in Bangkok, 20:00 in Tokyo
    const out = await runReminders(db, push, new Date("2026-11-03T11:00:00Z"));
    expect(out.due).toBe(1);
    expect(push.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["Utyo"]);
    // "today" is Tokyo's day: from its midnight, marked with its date
    expect(counted).toEqual([{ from: "2026-11-02T15:00:00.000Z", to: "2026-11-03T15:00:00.000Z" }]);
    expect(marked).toEqual([{ user: "tyo", on: "2026-11-03" }]);
  });
});
