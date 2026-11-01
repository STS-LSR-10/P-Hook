import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  fileUsage,
  getReadyFile,
  listFiles,
  rememberMedia,
  renameFile,
  reserveFile,
  takeFileWait,
  takeMediaById,
  takeRecentMedia,
} from "./file-repo";

const NOW = new Date("2026-11-01T05:00:00Z");

function fakeDb(result: { data?: unknown; count?: number } = {}) {
  const calls: unknown[][] = [];
  const done = { data: result.data ?? null, error: null, count: result.count ?? 0 };
  const note =
    (name: string) =>
    (...a: unknown[]) => (calls.push([name, ...a]), chain);
  const chain: Record<string, unknown> = {
    select: note("select"),
    insert: note("insert"),
    update: note("update"),
    upsert: note("upsert"),
    delete: note("delete"),
    eq: note("eq"),
    gt: note("gt"),
    lt: note("lt"),
    lte: note("lte"),
    in: note("in"),
    ilike: note("ilike"),
    order: note("order"),
    limit: note("limit"),
    maybeSingle: async () => done,
    single: async () => done,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(done).then(ok),
  };
  const db = {
    from: (t: string) => (calls.push(["from", t]), chain),
    rpc: async (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), done),
  } as unknown as SupabaseClient;
  return { db, calls };
}
const has = (calls: unknown[][], ...call: unknown[]) =>
  calls.some((c) => JSON.stringify(c) === JSON.stringify(call));

const row = {
  id: "f1",
  name: "a.pdf",
  mime_type: "application/pdf",
  size_bytes: 10,
  r2_key: "u/u1/f1",
  created_at: "2026-11-01T05:00:00Z",
};

describe("stored files", () => {
  it("reserves through the database function", async () => {
    const { db, calls } = fakeDb({ data: true });
    const ok = await reserveFile(db, {
      id: "f1",
      userId: "u1",
      name: "a",
      mimeType: "t",
      sizeBytes: 5,
      r2Key: "k",
      capacity: 100,
    });
    expect(ok).toBe(true);
    expect(calls[0]?.[1]).toBe("file_reserve");
    expect(calls[0]?.[2]).toMatchObject({ p_user: "u1", p_size: 5, p_capacity: 100 });
  });

  it("reads only their own finished file", async () => {
    const { db, calls } = fakeDb({ data: row });
    const file = await getReadyFile(db, "u1", "f1");
    expect(file).toMatchObject({ id: "f1", sizeBytes: 10, r2Key: "u/u1/f1" });
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
    expect(has(calls, "eq", "status", "ready")).toBe(true);
  });

  it("lists finished files, with % in a search matching itself", async () => {
    const { db, calls } = fakeDb({ data: [row] });
    const { items, hasMore } = await listFiles(db, "u1", { q: "50%", limit: 5 });
    expect(items).toHaveLength(1);
    expect(hasMore).toBe(false);
    expect(has(calls, "eq", "status", "ready")).toBe(true);
    expect(has(calls, "ilike", "name", "%50\\%%")).toBe(true);
  });

  it("counts every row in the space used, pending too", async () => {
    const { db, calls } = fakeDb({ data: [{ size_bytes: 5 }, { size_bytes: "7" }] });
    await expect(fileUsage(db, "u1")).resolves.toBe(12);
    expect(has(calls, "eq", "status", "ready")).toBe(false);
  });

  it("renames only their own file", async () => {
    const { db, calls } = fakeDb({ data: { id: "f1" } });
    await expect(renameFile(db, "u1", "f1", "b")).resolves.toBe(true);
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
  });
});

describe("the wait for a file", () => {
  it("is taken only before it expires", async () => {
    const { db, calls } = fakeDb({ data: { name: "บัตร" } });
    await expect(takeFileWait(db, "u1", NOW)).resolves.toEqual({ name: "บัตร" });
    expect(has(calls, "delete")).toBe(true);
    expect(has(calls, "gt", "expires_at", NOW.toISOString())).toBe(true);
  });
});

describe("recent media", () => {
  const media = {
    messageId: "m1",
    kind: "image" as const,
    fileName: null,
    fileSize: null,
  };

  it("is remembered for 30 minutes", async () => {
    const { db, calls } = fakeDb();
    await rememberMedia(db, "u1", media, NOW);
    const upsert = calls.find((c) => c[0] === "upsert");
    expect(upsert?.[1]).toMatchObject({
      user_id: "u1",
      message_id: "m1",
      expires_at: "2026-11-01T05:30:00.000Z",
    });
  });

  it("is taken oldest first, at most 5, and only once", async () => {
    const { db, calls } = fakeDb({
      data: [
        {
          id: "r1",
          message_id: "m1",
          kind: "image",
          file_name: null,
          file_size: null,
        },
      ],
    });
    const taken = await takeRecentMedia(db, "u1", NOW);
    expect(taken[0]).toMatchObject({ id: "r1", messageId: "m1" });
    expect(has(calls, "delete")).toBe(true);
    expect(has(calls, "gt", "expires_at", NOW.toISOString())).toBe(true);
  });

  it("is taken by id only by its owner", async () => {
    const { db, calls } = fakeDb({ data: null });
    await expect(takeMediaById(db, "u1", "r1", NOW)).resolves.toBeNull();
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
    expect(has(calls, "eq", "id", "r1")).toBe(true);
  });
});
