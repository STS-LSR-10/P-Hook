import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { countSlipsEver } from "./slip-repo";

const dbOf = (count: number | null, error: { message: string } | null = null) => {
  const seen: unknown[][] = [];
  const query = {
    select: () => query,
    eq: (...a: unknown[]) => (seen.push(a), Promise.resolve({ count, error })),
  };
  return { db: { from: () => query } as unknown as SupabaseClient, seen };
};

describe("countSlipsEver", () => {
  it("counts every slip of the person, with no date window (Free's ten are for life)", async () => {
    const { db, seen } = dbOf(7);
    expect(await countSlipsEver(db, "u1")).toBe(7);
    expect(seen).toEqual([["user_id", "u1"]]);
  });
  it("is zero when there are none, and fails loudly when the database does", async () => {
    expect(await countSlipsEver(dbOf(null).db, "u1")).toBe(0);
    await expect(countSlipsEver(dbOf(null, { message: "boom" }).db, "u1")).rejects.toThrow(
      /count slips/,
    );
  });
});
