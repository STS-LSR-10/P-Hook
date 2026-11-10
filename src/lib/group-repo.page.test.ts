import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { isEntryCursor, pageEntries } from "./group-repo";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, at: string) => ({
  id: ID(n),
  payer_line_user_id: "U1",
  title: `e${n}`,
  amount: 10,
  occurred_at: at,
});

/** A query builder that records what it is asked and answers with `rows`. */
function fakeDb(rows: unknown[]) {
  const asked: Record<string, unknown[]> = {};
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "limit"]) {
    q[m] = (...args: unknown[]) => {
      (asked[m] ??= []).push(args);
      return m === "limit" ? Promise.resolve({ data: rows, error: null }) : q;
    };
  }
  return { db: { from: () => q } as unknown as SupabaseClient, asked };
}

describe("pageEntries", () => {
  it("shows `limit` entries and a cursor to the next page when there are more", async () => {
    const { db, asked } = fakeDb([
      row(3, "2026-11-10T03:00:00.5+00:00"),
      row(2, "2026-11-10T02:00:00+00:00"),
      row(1, "2026-11-10T01:00:00+00:00"),
    ]);
    const page = await pageEntries(db, "g1", 2);
    expect(page.items.map((e) => e.title)).toEqual(["e3", "e2"]);
    expect(page.next).toBe(`2026-11-10T02:00:00+00:00|${ID(2)}`);
    expect(asked.limit).toEqual([[3]]); // one more than shown tells there is another page
    expect(asked.or).toBeUndefined(); // the first page has no cursor
  });

  it("the last page has no cursor", async () => {
    const { db } = fakeDb([row(1, "2026-11-10T01:00:00+00:00")]);
    expect((await pageEntries(db, "g1", 2)).next).toBeNull();
  });

  it("a cursor continues strictly after that entry, even among entries at the same moment", async () => {
    const { db, asked } = fakeDb([]);
    await pageEntries(db, "g1", 20, `2026-11-10T02:00:00+00:00|${ID(2)}`);
    expect(asked.or).toEqual([
      [
        `occurred_at.lt.2026-11-10T02:00:00+00:00,and(occurred_at.eq.2026-11-10T02:00:00+00:00,id.lt.${ID(2)})`,
      ],
    ]);
  });

  it("only a cursor of that exact shape is accepted, since it goes into a filter", async () => {
    expect(isEntryCursor(`2026-11-10T02:00:00+00:00|${ID(2)}`)).toBe(true);
    for (const bad of ["x", "a),id.gt.0", `2026-11-10|${ID(1)}`, `2026-11-10T02:00:00Z|nope`]) {
      expect(isEntryCursor(bad)).toBe(false);
    }
    const { db } = fakeDb([]);
    await expect(pageEntries(db, "g1", 20, "a),id.gt.0")).rejects.toThrow();
  });
});
