import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore, type FileStore } from "./file-store";
import { saveFile, type SaveDeps } from "./file-save";
import { ImageError } from "./line/content";
import type { UserRow } from "./repo";

const order: string[] = [];
let reserved = true;
let dayLeft = true;
const reservations: Record<string, unknown>[] = [];
const refund = vi.fn(async () => undefined);
const take = vi.fn(async () => dayLeft);
const drop = vi.fn(async () => undefined);

vi.mock("@/lib/file-repo", () => ({
  reserveFile: async (_db: unknown, input: Record<string, unknown>) => {
    order.push("reserve");
    reservations.push(input);
    return reserved;
  },
  markFileReady: async () => void order.push("ready"),
  dropFileRow: (...a: unknown[]) => drop(...(a as [])),
}));
vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: (...a: unknown[]) => take(...(a as [])),
  refundUsage: (...a: unknown[]) => refund(...(a as [])),
}));

const NOW = new Date("2026-11-01T05:00:00Z");
const db = {} as SupabaseClient;
const user = { id: "u1", plan: "free", plan_expires_at: null } as unknown as UserRow;
const picture = { messageId: "m1", kind: "image" as const, fileName: null, fileSize: null };
const doc = { messageId: "m2", kind: "file" as const, fileName: "a.pdf", fileSize: 1 };

function deps(over: Partial<SaveDeps> = {}): SaveDeps {
  return {
    db,
    now: () => NOW,
    store: createMemoryStore(),
    fetchFile: async () => {
      order.push("download");
      return { bytes: new Uint8Array([1, 2]), mimeType: "image/png" };
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  reservations.length = 0;
  reserved = true;
  dayLeft = true;
});

describe("saveFile", () => {
  it("downloads, reserves, writes, then marks ready", async () => {
    const store = createMemoryStore();
    const put = vi.spyOn(store, "put");
    const r = await saveFile(deps({ store }), user, picture, null);
    expect(r.ok).toBe(true);
    expect(order).toEqual(["download", "reserve", "ready"]);
    expect(store.keys()[0]).toMatch(/^u\/u1\/[0-9a-f-]{36}$/);
    expect(put).toHaveBeenCalledOnce();
    expect(reservations[0]).toMatchObject({ sizeBytes: 2, mimeType: "image/png" });
  });

  it("uses the given name, else the file name, else a default", async () => {
    await saveFile(deps(), user, picture, "รูปบัตร");
    await saveFile(deps(), user, doc, null);
    await saveFile(deps(), user, picture, null);
    expect(reservations.map((r) => r.name)).toEqual(["รูปบัตร", "a.pdf", "รูป 1 พ.ย. 2569 12:00"]);
  });

  it("keeps the extension of the real file when given a name", async () => {
    await saveFile(deps(), user, doc, "สัญญา");
    expect(reservations[0]?.name).toBe("สัญญา.pdf");
  });

  it("does not double an extension that was typed", async () => {
    await saveFile(deps(), user, doc, "สัญญา.PDF");
    expect(reservations[0]?.name).toBe("สัญญา.PDF");
  });

  it("refuses a blocked file before downloading", async () => {
    const r = await saveFile(deps(), user, { ...doc, fileName: "a.exe" }, null);
    expect(r).toEqual({ ok: false, reason: "blocked" });
    expect(order).toEqual([]);
    expect(take).not.toHaveBeenCalled();
  });

  it("refuses a blocked file renamed by the person", async () => {
    const r = await saveFile(deps(), user, { ...doc, fileName: "a.exe" }, "งาน.pdf");
    expect(r).toEqual({ ok: false, reason: "blocked" });
  });

  it("refuses a declared size over 20 MB before downloading", async () => {
    const r = await saveFile(deps(), user, { ...doc, fileSize: 21 * 1024 * 1024 }, null);
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(order).toEqual([]);
  });

  it("says full and writes nothing when the reserve fails", async () => {
    reserved = false;
    const store = createMemoryStore();
    const r = await saveFile(deps({ store }), user, picture, null);
    expect(r).toEqual({ ok: false, reason: "full" });
    expect(store.keys()).toEqual([]);
    expect(refund).toHaveBeenCalledOnce();
  });

  it("still refuses when a plan was lowered below the space used", async () => {
    reserved = false;
    await expect(saveFile(deps(), user, doc, null)).resolves.toEqual({ ok: false, reason: "full" });
    expect(reservations[0]?.capacity).toBe(500 * 1024 * 1024);
  });

  it("drops the row when the write fails", async () => {
    const store: FileStore = {
      ...createMemoryStore(),
      put: async () => {
        throw new Error("r2 down");
      },
    };
    const r = await saveFile(deps({ store }), user, picture, null);
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(drop).toHaveBeenCalledOnce();
    expect(refund).toHaveBeenCalledOnce();
  });

  it("gives the day's use back when it fails", async () => {
    const fetchFile = async () => {
      throw new Error("timeout");
    };
    const r = await saveFile(deps({ fetchFile }), user, picture, null);
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(refund).toHaveBeenCalledWith(db, "u1", "file_save", "2026-11-01");
  });

  it("says gone when LINE no longer has the content", async () => {
    const fetchFile = async () => {
      throw new ImageError("gone", "gone");
    };
    await expect(saveFile(deps({ fetchFile }), user, picture, null)).resolves.toEqual({
      ok: false,
      reason: "gone",
    });
  });

  it("says too large when the real size is over", async () => {
    const fetchFile = async () => {
      throw new ImageError("too_large", "big");
    };
    await expect(saveFile(deps({ fetchFile }), user, picture, null)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("says unavailable without a store", async () => {
    const r = await saveFile(deps({ store: null }), user, picture, null);
    expect(r).toEqual({ ok: false, reason: "unavailable" });
    expect(order).toEqual([]);
    expect(take).not.toHaveBeenCalled();
  });

  it("takes the day's use by plan", async () => {
    await saveFile(deps(), user, picture, null);
    expect(take).toHaveBeenCalledWith(db, "u1", "file_save", 20, "2026-11-01");
  });

  it("stops at the day's limit", async () => {
    dayLeft = false;
    await expect(saveFile(deps(), user, picture, null)).resolves.toEqual({
      ok: false,
      reason: "day_limit",
    });
    expect(order).toEqual([]);
  });
});
