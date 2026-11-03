import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { RESET_CONFIRM_PHRASE, monthDeletePhrase, phraseMatches } from "./account-confirm";
import { eraseData, monthRange, monthsWithData, previewErase } from "./data-reset";

describe("monthRange", () => {
  it("is the Bangkok month: 1 Oct 00:00 up to 1 Nov 00:00", () => {
    const r = monthRange("2026-10");
    expect(r?.from.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r?.to.toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  it("December runs into January", () => {
    expect(monthRange("2026-12")?.to.toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });

  it.each(["2026-13", "2026-00", "26-10", "2026-1", "abcd-ef", "1999-10", ""])(
    "%s is not a month",
    (m) => {
      expect(monthRange(m)).toBeNull();
    },
  );
});

describe("the confirmation phrases", () => {
  it("one for everything, one naming the month in Thai with the Buddhist year", () => {
    expect(RESET_CONFIRM_PHRASE).toBe("ล้างประวัติ");
    expect(monthDeletePhrase("2026-10")).toBe("ลบเดือน ต.ค. 2569");
    expect(monthDeletePhrase("2027-01")).toBe("ลบเดือน ม.ค. 2570");
  });

  it("forgiving about spaces, strict about the words", () => {
    expect(phraseMatches(" ล้าง ประวัติ ", RESET_CONFIRM_PHRASE)).toBe(true);
    expect(phraseMatches("ลบเดือนต.ค.2569", monthDeletePhrase("2026-10"))).toBe(true);
    expect(phraseMatches("ล้างประวัติ!", RESET_CONFIRM_PHRASE)).toBe(false);
    expect(phraseMatches("ลบเดือน ก.ย. 2569", monthDeletePhrase("2026-10"))).toBe(false);
    expect(phraseMatches("", RESET_CONFIRM_PHRASE)).toBe(false);
    expect(phraseMatches(RESET_CONFIRM_PHRASE, monthDeletePhrase("2026-10"))).toBe(false);
  });
});

/** The calls the erase makes, in order, against a fake client. */
function fakeDb(opts: { paths?: string[]; removeError?: boolean; eraseError?: boolean } = {}) {
  const events: string[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      events.push(`rpc:${fn}`);
      calls.push({ fn, args });
      if (fn === "data_erase_paths") {
        return { data: (opts.paths ?? []).map((path) => ({ path })), error: null };
      }
      if (fn === "data_erase") {
        if (opts.eraseError) return { data: null, error: { message: "nope" } };
        return { data: [{ entries: 3, transfers: 1, debts: 0, goal_deposits: 0 }], error: null };
      }
      if (fn === "data_erase_preview") {
        return {
          data: [
            { entries: "12", transfers: 2, debts: 1, goal_deposits: 4, files: 5, kept_shared: 6 },
          ],
          error: null,
        };
      }
      if (fn === "months_with_data") {
        return { data: [{ month: "2026-10", entries: "7", transfers: 1 }], error: null };
      }
      return { data: null, error: { message: "unknown" } };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          events.push(`remove:${bucket}:${paths.length}`);
          return { data: null, error: opts.removeError ? { message: "boom" } : null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { db, events, calls };
}

describe("previewErase / monthsWithData", () => {
  it("reads the counts the database reports", async () => {
    const { db, calls } = fakeDb();
    expect(await previewErase(db, "u1", { kind: "all", keepBalance: true })).toEqual({
      entries: 12,
      transfers: 2,
      debts: 1,
      goalDeposits: 4,
      files: 5,
      keptShared: 6,
    });
    expect(calls[0]).toEqual({
      fn: "data_erase_preview",
      args: { p_user: "u1", p_from: null, p_to: null, p_all: true },
    });
  });

  it("a month asks for exactly that Bangkok month", async () => {
    const { db, calls } = fakeDb();
    await previewErase(db, "u1", { kind: "month", month: "2026-10" });
    expect(calls[0]?.args).toMatchObject({
      p_all: false,
      p_from: "2026-09-30T17:00:00.000Z",
      p_to: "2026-10-31T17:00:00.000Z",
    });
  });

  it("a bad month never reaches the database", async () => {
    const { db, calls } = fakeDb();
    await expect(previewErase(db, "u1", { kind: "month", month: "2026-13" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("lists months with their counts, in the zone of the request", async () => {
    const { db, calls } = fakeDb();
    expect(await monthsWithData(db, "u1")).toEqual([
      { month: "2026-10", entries: 7, transfers: 1 },
    ]);
    expect(calls[0]?.args).toEqual({ p_user: "u1", p_tz: "Asia/Bangkok" });
  });
});

describe("eraseData", () => {
  it("removes the files first, then erases in the database, and tells what went", async () => {
    const { db, events } = fakeDb({ paths: ["u1/a.jpg", "u1/b.jpg"] });
    const r = await eraseData(db, "u1", { kind: "all", keepBalance: true });
    expect(r).toEqual({ entries: 3, transfers: 1, debts: 0, goalDeposits: 0, filesRemoved: 2 });
    expect(events).toEqual(["rpc:data_erase_paths", "remove:slips:2", "rpc:data_erase"]);
  });

  it("removes files in batches of 100", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `u1/${i}.jpg`);
    const { db, events } = fakeDb({ paths });
    await eraseData(db, "u1", { kind: "all", keepBalance: false });
    expect(events.filter((e) => e.startsWith("remove"))).toEqual([
      "remove:slips:100",
      "remove:slips:100",
      "remove:slips:50",
    ]);
  });

  it("no files: nothing is removed from storage", async () => {
    const { db, events } = fakeDb();
    await eraseData(db, "u1", { kind: "month", month: "2026-10" });
    expect(events).toEqual(["rpc:data_erase_paths", "rpc:data_erase"]);
  });

  it("a failure removing files stops before any row is erased, so it can be tried again", async () => {
    const { db, events } = fakeDb({ paths: ["u1/a.jpg"], removeError: true });
    await expect(eraseData(db, "u1", { kind: "all", keepBalance: true })).rejects.toThrow(
      /remove files/,
    );
    expect(events).not.toContain("rpc:data_erase");
  });

  it("passes keep-balance only for a full reset; a month never keeps balances", async () => {
    const full = fakeDb();
    await eraseData(full.db, "u1", { kind: "all", keepBalance: true });
    expect(full.calls.find((c) => c.fn === "data_erase")?.args).toMatchObject({
      p_all: true,
      p_keep_balance: true,
    });

    const off = fakeDb();
    await eraseData(off.db, "u1", { kind: "all", keepBalance: false });
    expect(off.calls.find((c) => c.fn === "data_erase")?.args).toMatchObject({
      p_keep_balance: false,
    });

    const month = fakeDb();
    await eraseData(month.db, "u1", { kind: "month", month: "2026-10" });
    expect(month.calls.find((c) => c.fn === "data_erase")?.args).toMatchObject({
      p_all: false,
      p_keep_balance: false,
    });
  });

  it("an error from the database is reported", async () => {
    const { db } = fakeDb({ eraseError: true });
    await expect(eraseData(db, "u1", { kind: "all", keepBalance: true })).rejects.toThrow(
      /erase data/,
    );
  });
});
