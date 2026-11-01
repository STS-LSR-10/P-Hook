import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { purgeExpiredIntents, putPendingIntent, takePendingIntent } from "./pending-intent-repo";

const NOW = new Date("2026-11-01T05:00:00Z");

function fakeDb(row: unknown = null) {
  const calls: unknown[][] = [];
  const chain = {
    delete: () => chain,
    select: () => chain,
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), chain),
    gt: (...a: unknown[]) => (calls.push(["gt", ...a]), chain),
    lte: (...a: unknown[]) => (calls.push(["lte", ...a]), { error: null }),
    upsert: async (...a: unknown[]) => (calls.push(["upsert", ...a]), { error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { db: { from: () => chain } as unknown as SupabaseClient, calls };
}

describe("pending intents", () => {
  it("live for 10 minutes and replace the person's last one", async () => {
    const { db, calls } = fakeDb();
    const id = await putPendingIntent(db, "u1", { text: "x", decision: null }, NOW);
    expect(calls[0]?.[1]).toMatchObject({
      user_id: "u1",
      id,
      input: "x",
      expires_at: "2026-11-01T05:10:00.000Z",
    });
    expect(calls[0]?.[2]).toEqual({ onConflict: "user_id" });
  });

  it("are taken only by their owner, by id, before they expire", async () => {
    const row = { id: "p1", input: "x", decision: null };
    const { db, calls } = fakeDb(row);
    await expect(takePendingIntent(db, "u1", "p1", NOW)).resolves.toEqual(row);
    expect(calls).toEqual([
      ["eq", "user_id", "u1"],
      ["eq", "id", "p1"],
      ["gt", "expires_at", NOW.toISOString()],
    ]);
  });

  it("are null when already taken", async () => {
    await expect(takePendingIntent(fakeDb(null).db, "u1", "p1", NOW)).resolves.toBeNull();
  });

  it("are purged once expired", async () => {
    const { db, calls } = fakeDb();
    await purgeExpiredIntents(db, NOW);
    expect(calls).toEqual([["lte", "expires_at", NOW.toISOString()]]);
  });
});
