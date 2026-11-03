import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listOwnedGroups } from "./owned-groups";

interface Row {
  id: string;
  line_group_id: string;
  is_active: boolean;
}

/** bot_groups answers with `groups`; stored_files counts `files[group_id]`. */
function fakeDb(groups: Row[], files: Record<string, number>) {
  const calls: unknown[][] = [];
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: (...a: unknown[]) => (calls.push([table, "select", ...a]), chain),
        eq: (col: string, v: unknown) => (
          (filters[col] = v),
          calls.push([table, "eq", col, v]),
          chain
        ),
        order: () => chain,
        limit: (n: number) => (calls.push([table, "limit", n]), chain),
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve(
            table === "bot_groups"
              ? { data: groups, error: null }
              : { count: files[filters.group_id as string] ?? 0, error: null },
          ).then(ok),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const open = { id: "g1", line_group_id: "C1", is_active: true };
const closedWithFiles = { id: "g2", line_group_id: "C2", is_active: false };
const closedEmpty = { id: "g3", line_group_id: "C3", is_active: false };

describe("the groups an owner can switch to", () => {
  it("are the open ledgers, and the closed ones that still keep files", async () => {
    const { db, calls } = fakeDb([open, closedWithFiles, closedEmpty], { g2: 2 });
    const names: Record<string, string> = { C1: "บ้านเรา", C2: "ทริปเชียงใหม่" };
    const items = await listOwnedGroups(db, "u1", async (line) => names[line] ?? null);
    expect(items).toEqual([
      { id: "g1", name: "บ้านเรา", isActive: true },
      { id: "g2", name: "ทริปเชียงใหม่", isActive: false },
    ]);
    expect(calls).toContainEqual(["bot_groups", "eq", "owner_user_id", "u1"]);
  });

  it("are numbered when LINE cannot say their name", async () => {
    const { db } = fakeDb([open, closedWithFiles], { g2: 1 });
    const items = await listOwnedGroups(db, "u1", async (line) => {
      if (line === "C1") throw new Error("down");
      return null;
    });
    expect(items.map((g) => g.name)).toEqual(["กลุ่ม 1", "กลุ่ม 2"]);
  });

  it("are none for someone who owns no ledger, without asking LINE", async () => {
    const { db } = fakeDb([], {});
    let asked = 0;
    await expect(listOwnedGroups(db, "u1", async () => (asked++, "x"))).resolves.toEqual([]);
    expect(asked).toBe(0);
  });
});
