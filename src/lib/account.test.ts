import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE_CONFIRM_PHRASE, deleteAccountData, isDeleteConfirmed } from "./account";
import { createMemoryStore } from "./file-store";

let keys: string[] = [];
vi.mock("@/lib/file-repo", () => ({ listAllKeys: async () => keys }));
beforeEach(() => {
  keys = [];
});

describe("isDeleteConfirmed", () => {
  it("accepts the exact phrase, tolerating spaces", () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_PHRASE)).toBe(true);
    expect(isDeleteConfirmed("  ลบ ข้อมูล ทั้งหมด ")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("ลบข้อมูล")).toBe(false);
    expect(isDeleteConfirmed("ลบข้อมูลทั้งหมด!")).toBe(false);
    expect(isDeleteConfirmed("delete")).toBe(false);
  });
});

function fakeDb(pages: string[][], opts: { listError?: boolean; deleteError?: boolean } = {}) {
  const events: string[] = [];
  const queue = [...pages];
  const db = {
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          events.push(`list:${bucket}/${prefix}`);
          if (opts.listError) return { data: null, error: { message: "boom" } };
          return { data: (queue.shift() ?? []).map((name) => ({ name })), error: null };
        },
        remove: async (paths: string[]) => {
          events.push(`remove:${paths.join(",")}`);
          return { data: null, error: null };
        },
      }),
    },
    from: (table: string) => ({
      delete: () => ({
        eq: async (column: string, value: string) => {
          events.push(`delete:${table}.${column}=${value}`);
          return { error: opts.deleteError ? { message: "nope" } : null };
        },
      }),
    }),
  };
  return { db: db as unknown as SupabaseClient, events };
}

describe("deleteAccountData", () => {
  it("removes slip files first, then the user row", async () => {
    const { db, events } = fakeDb([["a.jpg", "b.png"]]);
    const res = await deleteAccountData(db, "user-1");
    expect(res).toEqual({ filesRemoved: 2 });
    expect(events).toEqual([
      "list:slips/user-1",
      "remove:user-1/a.jpg,user-1/b.png",
      "delete:users.id=user-1",
    ]);
  });

  it("works for a user with no files", async () => {
    const { db, events } = fakeDb([[]]);
    expect(await deleteAccountData(db, "u")).toEqual({ filesRemoved: 0 });
    expect(events).toEqual(["list:slips/u", "delete:users.id=u"]);
  });

  it("keeps listing until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => `f${i}.jpg`);
    const { db } = fakeDb([full, ["last.jpg"]]);
    expect(await deleteAccountData(db, "u")).toEqual({ filesRemoved: 101 });
  });

  it("does NOT delete the user row when storage fails (so the user can retry)", async () => {
    const { db, events } = fakeDb([[]], { listError: true });
    await expect(deleteAccountData(db, "u")).rejects.toThrow(/list slip files/);
    expect(events.some((e) => e.startsWith("delete:"))).toBe(false);
  });

  it("surfaces a database failure", async () => {
    const { db } = fakeDb([[]], { deleteError: true });
    await expect(deleteAccountData(db, "u")).rejects.toThrow(/delete user/);
  });
});

describe("deleteAccountData and kept files", () => {
  it("removes their R2 files before the user row", async () => {
    keys = ["u/u1/a", "u/u1/b"];
    const { db, events } = fakeDb([[]]);
    const store = createMemoryStore();
    vi.spyOn(store, "delete").mockImplementation(async (k) => {
      events.push(`r2:${k.join()}`);
    });
    await deleteAccountData(db, "u1", store);
    expect(events.indexOf("r2:u/u1/a,u/u1/b")).toBeGreaterThanOrEqual(0);
    expect(events[events.length - 1]).toBe("delete:users.id=u1");
    expect(events.indexOf("r2:u/u1/a,u/u1/b")).toBeLessThan(events.length - 1);
  });

  it("stops when R2 fails, so the account stays and can retry", async () => {
    keys = ["u/u1/a"];
    const { db, events } = fakeDb([[]]);
    const store = createMemoryStore();
    vi.spyOn(store, "delete").mockRejectedValue(new Error("down"));
    await expect(deleteAccountData(db, "u1", store)).rejects.toThrow("down");
    expect(events.some((e) => e.startsWith("delete:users"))).toBe(false);
  });

  it("stops when the store is missing but files exist", async () => {
    keys = ["u/u1/a"];
    const { db, events } = fakeDb([[]]);
    await expect(deleteAccountData(db, "u1", null)).rejects.toThrow();
    expect(events.some((e) => e.startsWith("delete:users"))).toBe(false);
  });

  it("needs no store when there are no files", async () => {
    const { db, events } = fakeDb([[]]);
    await deleteAccountData(db, "u1", null);
    expect(events[events.length - 1]).toBe("delete:users.id=u1");
  });
});
