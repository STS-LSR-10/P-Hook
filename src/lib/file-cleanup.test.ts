import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "./file-store";
import { cleanupFiles } from "./file-cleanup";

const NOW = new Date("2026-11-01T05:00:00Z");
const db = {} as SupabaseClient;
let stale: { id: string; userId: string; r2Key: string }[] = [];
let cutoff: Date | null = null;
const order: string[] = [];
const purge = vi.fn(async () => undefined);

vi.mock("@/lib/file-repo", () => ({
  listStalePending: async (_db: unknown, before: Date) => {
    cutoff = before;
    return stale;
  },
  dropFileRow: async (_db: unknown, _u: string, id: string) => void order.push(`row:${id}`),
  purgeExpiredMedia: (...a: unknown[]) => purge(...(a as [])),
}));

beforeEach(() => {
  stale = [];
  cutoff = null;
  order.length = 0;
  vi.clearAllMocks();
});

describe("cleanupFiles", () => {
  it("removes pending rows over an hour old, object first", async () => {
    stale = [{ id: "f1", userId: "u1", r2Key: "k1" }];
    const store = createMemoryStore();
    await store.put("k1", new Uint8Array([1]), "t");
    vi.spyOn(store, "delete").mockImplementation(async (keys) => {
      order.push(`object:${keys.join()}`);
    });
    await expect(cleanupFiles(db, store, NOW)).resolves.toEqual({ removed: 1 });
    expect(order).toEqual(["object:k1", "row:f1"]);
    expect(cutoff?.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("leaves a row when its object could not be removed", async () => {
    stale = [{ id: "f1", userId: "u1", r2Key: "k1" }];
    const store = createMemoryStore();
    vi.spyOn(store, "delete").mockRejectedValue(new Error("down"));
    await expect(cleanupFiles(db, store, NOW)).resolves.toEqual({ removed: 0 });
    expect(order).toEqual([]);
  });

  it("purges expired recent media, with no store too", async () => {
    await cleanupFiles(db, null, NOW);
    expect(purge).toHaveBeenCalledWith(db, NOW);
  });
});
