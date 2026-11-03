import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  countGroupNotes,
  createNote,
  deleteGroupNote,
  deleteNote,
  escapeLike,
  getGroupNote,
  listGroupNotes,
  listNotes,
  moveGroupNotes,
  updateGroupNote,
  updateNote,
} from "./note-repo";

function fakeDb(rows: unknown[] = [], single: unknown = null) {
  const calls: { op: string; args: unknown[] }[] = [];
  const result = { data: rows, error: null };
  const chain: Record<string, unknown> = {};
  for (const op of [
    "select",
    "eq",
    "is",
    "not",
    "order",
    "limit",
    "ilike",
    "lt",
    "insert",
    "update",
    "delete",
  ]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return chain;
    };
  }
  chain.single = async () => ({ data: single, error: null });
  chain.maybeSingle = async () => ({ data: single, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { db: { from: () => chain } as unknown as SupabaseClient, calls };
}

const row = (n: number) => ({
  id: `n${n}`,
  body: `โน้ต ${n}`,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

describe("escapeLike", () => {
  it("makes %, _ and \\ match themselves", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("listNotes", () => {
  it("asks for one more than the page to know whether there is more", async () => {
    const { db, calls } = fakeDb([row(1), row(2), row(3)]);
    const out = await listNotes(db, "u1", { limit: 2 });
    expect(out.items.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(out.hasMore).toBe(true);
    expect(calls).toContainEqual({ op: "limit", args: [3] });
    expect(calls).toContainEqual({ op: "eq", args: ["user_id", "u1"] });
  });

  it("searches case-insensitively with the typed text escaped, and pages back from a moment", async () => {
    const { db, calls } = fakeDb([]);
    await listNotes(db, "u1", { q: " ไวไฟ_100% ", before: "2026-10-01T00:00:00Z" });
    expect(calls).toContainEqual({ op: "ilike", args: ["body", "%ไวไฟ\\_100\\%%"] });
    expect(calls).toContainEqual({ op: "lt", args: ["created_at", "2026-10-01T00:00:00Z"] });
  });
});

describe("writes", () => {
  it("create returns the note", async () => {
    const { db } = fakeDb([], row(1));
    expect((await createNote(db, "u1", "x")).body).toBe("โน้ต 1");
  });
  it("update and delete say whether the note was theirs", async () => {
    expect(await updateNote(fakeDb([], { id: "n1" }).db, "u1", "n1", "x")).toBe(true);
    expect(await updateNote(fakeDb([], null).db, "u1", "n1", "x")).toBe(false);
    expect(await deleteNote(fakeDb([], { id: "n1" }).db, "u1", "n1")).toBe(true);
    expect(await deleteNote(fakeDb([], null).db, "u1", "n1")).toBe(false);
  });
});

describe("a group's notes", () => {
  it("are kept apart from the owner's own", async () => {
    const own = fakeDb([]);
    await listNotes(own.db, "u1");
    expect(own.calls).toContainEqual({ op: "is", args: ["group_id", null] });
    const edit = fakeDb([], { id: "n1" });
    await updateNote(edit.db, "u1", "n1", "x");
    expect(edit.calls).toContainEqual({ op: "is", args: ["group_id", null] });
    const gone = fakeDb([], { id: "n1" });
    await deleteNote(gone.db, "u1", "n1");
    expect(gone.calls).toContainEqual({ op: "is", args: ["group_id", null] });
  });

  it("are written for the group with who wrote them", async () => {
    const { db, calls } = fakeDb([], row(1));
    await createNote(db, "u1", "x", { groupId: "g1", createdBy: "Uanna" });
    expect(calls).toContainEqual({
      op: "insert",
      args: [{ user_id: "u1", body: "x", group_id: "g1", created_by: "Uanna" }],
    });
  });

  it("are listed by group, whoever owned the ledger, with who wrote each", async () => {
    const { db, calls } = fakeDb([{ ...row(1), created_by: "Uanna", user_id: "old" }]);
    const { items } = await listGroupNotes(db, "g1", { q: "ไวไฟ" });
    expect(calls).toContainEqual({ op: "eq", args: ["group_id", "g1"] });
    expect(calls.some((c) => c.op === "eq" && c.args[0] === "user_id")).toBe(false);
    expect(items[0]).toMatchObject({ id: "n1", createdBy: "Uanna" });
  });

  it("are read, changed and removed only within their group", async () => {
    const one = fakeDb([], { ...row(1), created_by: "Uanna", user_id: "old" });
    await expect(getGroupNote(one.db, "g1", "n1")).resolves.toMatchObject({
      userId: "old",
      createdBy: "Uanna",
    });
    expect(one.calls).toContainEqual({ op: "eq", args: ["group_id", "g1"] });
    const edit = fakeDb([], { id: "n1" });
    expect(await updateGroupNote(edit.db, "g1", "n1", "y")).toBe(true);
    expect(edit.calls).toContainEqual({ op: "eq", args: ["group_id", "g1"] });
    const gone = fakeDb([], null);
    expect(await deleteGroupNote(gone.db, "g1", "n1")).toBe(false);
    expect(gone.calls).toContainEqual({ op: "eq", args: ["group_id", "g1"] });
  });
});

describe("a group's notes and their owner", () => {
  it("are counted apart, for the owner's own page", async () => {
    const { db, calls } = fakeDb([]);
    await countGroupNotes(db, "u1");
    expect(calls).toContainEqual({ op: "eq", args: ["user_id", "u1"] });
    expect(calls).toContainEqual({ op: "not", args: ["group_id", "is", null] });
  });

  it("move with the ledger to its new owner", async () => {
    const { db, calls } = fakeDb([]);
    await moveGroupNotes(db, "g1", "u2");
    expect(calls).toContainEqual({ op: "update", args: [{ user_id: "u2" }] });
    expect(calls).toContainEqual({ op: "eq", args: ["group_id", "g1"] });
  });
});
