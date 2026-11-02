import { describe, expect, it } from "vitest";
import { readUsage } from "./usage";

/** A Supabase stand-in that answers one usage_counters query with `rows`. */
function fakeDb(rows: { kind: string; month: string; used: number }[], error: unknown = null) {
  const calls: unknown[][] = [];
  const query = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), query),
    in: (...a: unknown[]) => {
      calls.push(["in", ...a]);
      return calls.filter((c) => c[0] === "in").length === 2
        ? Promise.resolve({ data: rows, error })
        : query;
    },
  };
  return { db: { from: (t: string) => (calls.push(["from", t]), query) }, calls };
}

describe("readUsage", () => {
  it("matches each counter by kind and period, 0 when never taken", async () => {
    const { db, calls } = fakeDb([
      { kind: "owl", month: "2026-11-01", used: 8 },
      { kind: "owl", month: "2026-10-01", used: 40 }, // last month: not this one
      { kind: "router", month: "2026-11-02", used: 3 },
    ]);
    const used = await readUsage(db as never, "u1", [
      { kind: "owl", month: "2026-11-01" },
      { kind: "router", month: "2026-11-02" },
      { kind: "pdf", month: "2026-11-01" },
    ]);
    expect(used).toEqual([8, 3, 0]);
    expect(calls).toContainEqual(["from", "usage_counters"]);
    expect(calls).toContainEqual(["eq", "user_id", "u1"]);
  });

  it("asks nothing for no counters, and throws when the read fails", async () => {
    expect(await readUsage({} as never, "u1", [])).toEqual([]);
    const { db } = fakeDb([], { message: "down" });
    await expect(
      readUsage(db as never, "u1", [{ kind: "owl", month: "2026-11-01" }]),
    ).rejects.toThrow("read usage");
  });
});
