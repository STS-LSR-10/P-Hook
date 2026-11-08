import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { deleteFeedback } from "./feedback-repo";

const dbOf = (rows: unknown[] | null, error: { message: string } | null = null) => {
  const seen: unknown[][] = [];
  const query = {
    delete: () => query,
    eq: (...a: unknown[]) => (seen.push(a), query),
    select: () => Promise.resolve({ data: rows, error }),
  };
  return { db: { from: () => query } as unknown as SupabaseClient, seen };
};

describe("deleteFeedback", () => {
  it("removes just that row and says so", async () => {
    const { db, seen } = dbOf([{ id: "f1" }]);
    expect(await deleteFeedback(db, "f1")).toBe(true);
    expect(seen).toEqual([["id", "f1"]]);
  });
  it("says false when it was already gone", async () => {
    expect(await deleteFeedback(dbOf([]).db, "f1")).toBe(false);
  });
  it("fails loudly when the database does", async () => {
    await expect(deleteFeedback(dbOf(null, { message: "boom" }).db, "f1")).rejects.toThrow(
      /delete feedback/,
    );
  });
});
