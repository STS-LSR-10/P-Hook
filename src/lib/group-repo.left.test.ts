import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { closeGroup, deleteGroupRow, markGroupLeft, openGroup } from "./group-repo";

/** A database client that records what was written and refuses `left_at` as an unknown column when asked. */
function fake(opts: { noColumn?: string; rows?: unknown[] } = {}) {
  const writes: { op: string; patch?: Record<string, unknown>; filters: unknown[][] }[] = [];
  const chain = (op: string, patch?: Record<string, unknown>) => {
    const entry = { op, patch, filters: [] as unknown[][] };
    writes.push(entry);
    const refused =
      opts.noColumn && patch && "left_at" in patch
        ? { code: opts.noColumn, message: "no column left_at" }
        : null;
    const q: Record<string, unknown> = {};
    const add =
      (name: string) =>
      (...a: unknown[]) => (entry.filters.push([name, ...a]), q);
    for (const n of ["eq", "not", "lt", "order", "limit"]) q[n] = add(n);
    q.select = () => q;
    q.single = () =>
      Promise.resolve({
        data: refused
          ? null
          : { id: "g1", line_group_id: "C1", owner_user_id: "o", is_active: true },
        error: refused,
      });
    q.then = (done: (r: unknown) => unknown) =>
      Promise.resolve({
        data: refused ? null : (opts.rows ?? [{ id: "g1" }]),
        error: refused,
      }).then(done);
    return q;
  };
  const db = {
    from: () => ({
      update: (patch: Record<string, unknown>) => chain("update", patch),
      upsert: (patch: Record<string, unknown>) => chain("upsert", patch),
      delete: () => chain("delete"),
    }),
  } as unknown as SupabaseClient;
  return { db, writes };
}

const NOW = new Date("2026-11-08T05:00:00Z");

describe("markGroupLeft", () => {
  it("closes an open ledger and stamps when the bot left", async () => {
    const { db, writes } = fake();
    expect(await markGroupLeft(db, "C1", NOW)).toBe(true);
    expect(writes[0]?.patch).toMatchObject({ is_active: false, left_at: NOW.toISOString() });
    expect(writes[0]?.filters).toContainEqual(["eq", "is_active", true]); // only an open one
  });
  it("says false when nothing was open", async () => {
    expect(await markGroupLeft(fake({ rows: [] }).db, "C1", NOW)).toBe(false);
  });
  for (const code of ["42703", "PGRST204"]) {
    it(`before migration 0062 (${code}) it still closes, without the date`, async () => {
      const { db, writes } = fake({ noColumn: code });
      expect(await markGroupLeft(db, "C1", NOW)).toBe(true);
      expect(writes).toHaveLength(2);
      expect(writes[1]?.patch).not.toHaveProperty("left_at");
    });
  }
});

describe("the owner's own opening and closing end any countdown", () => {
  it("openGroup writes left_at: null in the same upsert, and still works without the column", async () => {
    const a = fake();
    await openGroup(a.db, "C1", "o");
    expect(a.writes[0]?.patch).toMatchObject({ is_active: true, left_at: null });
    const b = fake({ noColumn: "PGRST204" });
    await openGroup(b.db, "C1", "o");
    expect(b.writes[1]?.patch).not.toHaveProperty("left_at");
  });
  it("closeGroup clears left_at too", async () => {
    const { db, writes } = fake();
    await closeGroup(db, "C1");
    expect(writes[0]?.patch).toMatchObject({ is_active: false, left_at: null });
  });
});

describe("deleteGroupRow", () => {
  it("only removes a closed group the bot left before the cut-off", async () => {
    const { db, writes } = fake();
    expect(await deleteGroupRow(db, "g1", NOW)).toBe(true);
    expect(writes[0]?.filters).toEqual([
      ["eq", "id", "g1"],
      ["eq", "is_active", false],
      ["not", "left_at", "is", null],
      ["lt", "left_at", NOW.toISOString()],
    ]);
  });
  it("is false when nothing matched (it was opened again, say)", async () => {
    expect(await deleteGroupRow(fake({ rows: [] }).db, "g1", NOW)).toBe(false);
  });
});
