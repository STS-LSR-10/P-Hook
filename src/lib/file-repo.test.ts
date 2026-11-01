import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  fileUsage,
  forgetMedia,
  getMediaById,
  getReadyFile,
  listFiles,
  markFileReady,
  rememberMedia,
  renameFile,
  reserveFile,
  hasFiles,
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
    like: note("like"),
    not: note("not"),
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

  it("tells whether a file has a preview", async () => {
    const { db } = fakeDb({ data: { ...row, has_thumb: true } });
    await expect(getReadyFile(db, "u1", "f1")).resolves.toMatchObject({ hasThumb: true });
  });

  it("lists pictures only", async () => {
    const { db, calls } = fakeDb({ data: [] });
    await listFiles(db, "u1", { kind: "image" });
    expect(has(calls, "like", "mime_type", "image/%")).toBe(true);
  });

  it("lists everything but pictures", async () => {
    const { db, calls } = fakeDb({ data: [] });
    await listFiles(db, "u1", { kind: "file" });
    expect(has(calls, "not", "mime_type", "like", "image/%")).toBe(true);
  });

  it("marks a file ready with its preview", async () => {
    const { db, calls } = fakeDb();
    await markFileReady(db, "u1", "f1", true);
    expect(has(calls, "update", { status: "ready", has_thumb: true })).toBe(true);
  });

  it("sums the space in the database, so no row limit can cut it short", async () => {
    const { db, calls } = fakeDb({ data: "12" });
    await expect(fileUsage(db, "u1")).resolves.toBe(12);
    expect(calls[0]?.[1]).toBe("file_usage");
  });

  it("renames only their own file", async () => {
    const { db, calls } = fakeDb({ data: { id: "f1" } });
    await expect(renameFile(db, "u1", "f1", "b")).resolves.toBe(true);
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
  });
});

describe("hasFiles", () => {
  it("counts without reading every row", async () => {
    const { db } = fakeDb({ count: 2 });
    await expect(hasFiles(db, "u1")).resolves.toBe(true);
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

  it("takes the newest 5, and hands them back oldest first, only once", async () => {
    const row = (id: string, at: string) => ({
      id,
      message_id: id,
      kind: "image",
      file_name: null,
      file_size: null,
      created_at: at,
    });
    const { db, calls } = fakeDb({
      data: [row("b", "2026-11-01T05:02:00Z"), row("a", "2026-11-01T05:01:00Z")],
    });
    const taken = await takeRecentMedia(db, "u1", NOW);
    expect(taken.map((t) => t.id)).toEqual(["a", "b"]);
    expect(has(calls, "delete")).toBe(true);
    expect(has(calls, "gt", "expires_at", NOW.toISOString())).toBe(true);
    expect(has(calls, "order", "created_at", { ascending: false })).toBe(true);
  });

  it("can be looked at without being taken", async () => {
    const { db, calls } = fakeDb({
      data: { id: "r1", message_id: "m", kind: "file", file_name: "a.pdf", file_size: 1 },
    });
    await expect(getMediaById(db, "u1", "r1", NOW)).resolves.toMatchObject({ messageId: "m" });
    expect(has(calls, "delete")).toBe(false);
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
  });

  it("can be forgotten by its owner", async () => {
    const { db, calls } = fakeDb();
    await forgetMedia(db, "u1", "r1");
    expect(has(calls, "delete")).toBe(true);
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
    expect(has(calls, "eq", "id", "r1")).toBe(true);
  });

  it("is taken by id only by its owner", async () => {
    const { db, calls } = fakeDb({ data: null });
    await expect(takeMediaById(db, "u1", "r1", NOW)).resolves.toBeNull();
    expect(has(calls, "eq", "user_id", "u1")).toBe(true);
    expect(has(calls, "eq", "id", "r1")).toBe(true);
  });
});
