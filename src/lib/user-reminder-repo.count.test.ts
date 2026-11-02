import { describe, expect, it } from "vitest";
import { countActiveReminders } from "./user-reminder-repo";

/** A Supabase stand-in that records the filters of one count query. */
function fakeDb(count: number) {
  const calls: unknown[][] = [];
  const query = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), query),
    is: (...a: unknown[]) => (calls.push(["is", ...a]), query),
    not: (...a: unknown[]) => (calls.push(["not", ...a]), query),
    then: (done: (r: { count: number; error: null }) => unknown) => done({ count, error: null }),
  };
  return { db: { from: () => query }, calls };
}

describe("countActiveReminders", () => {
  it("one-offs are the waiting ones with no repeat", async () => {
    const { db, calls } = fakeDb(3);
    expect(await countActiveReminders(db as never, "u1", "once")).toBe(3);
    expect(calls).toContainEqual(["eq", "status", "active"]);
    expect(calls).toContainEqual(["is", "repeat", null]);
  });

  it("repeats are the waiting ones with a repeat", async () => {
    const { db, calls } = fakeDb(1);
    expect(await countActiveReminders(db as never, "u1", "repeat")).toBe(1);
    expect(calls).toContainEqual(["not", "repeat", "is", null]);
  });

  it("with no kind, every waiting one counts", async () => {
    const { db, calls } = fakeDb(4);
    expect(await countActiveReminders(db as never, "u1")).toBe(4);
    expect(calls.some((c) => c[0] === "is" || c[0] === "not")).toBe(false);
  });
});
