import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStore } from "@/lib/file-store";

interface G {
  id: string;
  lineGroupId: string;
  ownerUserId: string;
  isActive: boolean;
}
let groups: G[] = [];
let due: G[] = [];
let filesOf: Record<string, string[]> = {};
let rowDeletable = true;
let remindersFail = false;
const log: string[] = [];

vi.mock("@/lib/group-repo", () => ({
  getGroup: async (_db: unknown, line: string) =>
    groups.find((g) => g.lineGroupId === line) ?? null,
  getOwner: async (_db: unknown, id: string) => ({
    lineUserId: `U-${id}`,
    plan: "ultimate",
    planExpiresAt: null,
  }),
  markGroupLeft: async (_db: unknown, line: string, now: Date) => {
    const g = groups.find((x) => x.lineGroupId === line);
    if (!g || !g.isActive) return false;
    g.isActive = false;
    log.push(`left ${line} ${now.toISOString()}`);
    return true;
  },
  listActiveGroups: async () => groups.filter((g) => g.isActive),
  listGroupsLeftBefore: async (_db: unknown, before: Date) => {
    log.push(`due-before ${before.toISOString()}`);
    return due;
  },
  deleteGroupRow: async (_db: unknown, id: string) => {
    if (!rowDeletable) return false;
    log.push(`row-deleted ${id}`);
    return true;
  },
}));
vi.mock("@/lib/file-repo", () => ({
  groupFileKeys: async (_db: unknown, id: string) => filesOf[id] ?? [],
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  endGroupReminders: async (_db: unknown, id: string) => {
    if (remindersFail) throw new Error("db blip");
    log.push(`reminders-ended ${id}`);
  },
}));

import {
  GROUP_KEEP_DAYS,
  handleBotLeft,
  purgeLeftGroups,
  reconcileGroups,
} from "./group-lifecycle";

const NOW = new Date("2026-11-08T05:00:00Z");
const db = {} as never;
const pushed: { to: string; text: string }[] = [];
const push = async (to: string, messages: { type: string; text?: string }[]) => {
  pushed.push({ to, text: messages[0]?.text ?? "" });
};
const group = (n: number, isActive = true): G => ({
  id: `g${n}`,
  lineGroupId: `C${n}`,
  ownerUserId: `o${n}`,
  isActive,
});
const storeOf = (fail = false) => {
  const deleted: string[][] = [];
  const store: FileStore = {
    put: async () => undefined,
    get: async () => null,
    delete: async (keys) => {
      if (fail) throw new Error("r2 down");
      deleted.push(keys);
    },
    deletePrefix: async () => 0,
  };
  return { store, deleted };
};

beforeEach(() => {
  groups = [group(1), group(2)];
  due = [];
  filesOf = {};
  rowDeletable = true;
  remindersFail = false;
  log.length = 0;
  pushed.length = 0;
});

describe("the bot is taken out of a group", () => {
  it("closes the ledger, stops its reminders, and tells the owner how long the data is kept", async () => {
    await handleBotLeft(db, "C1", NOW, push);
    expect(log).toEqual(["left C1 2026-11-08T05:00:00.000Z", "reminders-ended g1"]);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.to).toBe("U-o1");
    expect(pushed[0]?.text).toContain("8 ธ.ค. 2569"); // 30 days on
    expect(GROUP_KEEP_DAYS).toBe(30);
  });

  it("does nothing for a ledger already closed, or a group that never had one", async () => {
    groups = [group(1, false)];
    await handleBotLeft(db, "C1", NOW, push);
    await handleBotLeft(db, "Cnone", NOW, push);
    expect(log).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it("a failure while stopping the reminders is only logged", async () => {
    remindersFail = true;
    await handleBotLeft(db, "C1", NOW, push);
    expect(pushed).toHaveLength(1); // the owner is still told
  });

  it("a push that fails does not undo the closing", async () => {
    await handleBotLeft(db, "C1", NOW, async () => {
      throw new Error("LINE down");
    });
    expect(log).toContain("left C1 2026-11-08T05:00:00.000Z");
  });
});

describe("the hourly check of open ledgers", () => {
  it("closes the ones LINE says the bot is no longer in, and leaves the rest", async () => {
    await reconcileGroups(db, async (line) => (line === "C1" ? false : true), push, NOW);
    expect(groups.map((g) => g.isActive)).toEqual([false, true]);
    expect(pushed).toHaveLength(1);
  });

  it("an answer it cannot trust (null) changes nothing", async () => {
    await reconcileGroups(db, async () => null, push, NOW);
    expect(groups.every((g) => g.isActive)).toBe(true);
    expect(pushed).toEqual([]);
  });

  it("one failing lookup does not stop the others", async () => {
    await reconcileGroups(
      db,
      async (line) => {
        if (line === "C1") throw new Error("timeout");
        return false;
      },
      push,
      NOW,
    );
    expect(groups.map((g) => g.isActive)).toEqual([true, false]);
  });
});

describe("the check is spread over the hours", () => {
  it("asks about 40 groups a run and moves on, so every group is asked in turn", async () => {
    groups = Array.from({ length: 100 }, (_, n) => group(n));
    const asked = new Set<string>();
    const ask = async (line: string) => (asked.add(line), true);
    const hour = 3_600_000;
    await reconcileGroups(db, ask, push, new Date(NOW.getTime()));
    expect(asked.size).toBe(40);
    await reconcileGroups(db, ask, push, new Date(NOW.getTime() + hour));
    await reconcileGroups(db, ask, push, new Date(NOW.getTime() + 2 * hour));
    expect(asked.size).toBe(100);
  });
});

describe("removing what was kept for good", () => {
  it("only looks at groups left 30 days ago or more", async () => {
    await purgeLeftGroups(db, storeOf().store, NOW);
    expect(log).toEqual(["due-before 2026-10-09T05:00:00.000Z"]);
  });

  it("deletes the group, then its files and their previews", async () => {
    due = [group(1, false)];
    filesOf = { g1: ["a/1", "a/2"] };
    const { store, deleted } = storeOf();
    expect(await purgeLeftGroups(db, store, NOW)).toEqual({ purged: 1, skipped: 0 });
    expect(deleted.flat().sort()).toEqual(["a/1", "a/1.thumb", "a/2", "a/2.thumb"].sort());
    expect(log).toContain("row-deleted g1");
  });

  it("if the group was opened again in the meantime, nothing is touched, files included", async () => {
    due = [group(1, false)];
    filesOf = { g1: ["a/1"] };
    rowDeletable = false; // the guarded delete finds it open again
    const { store, deleted } = storeOf();
    expect(await purgeLeftGroups(db, store, NOW)).toEqual({ purged: 0, skipped: 1 });
    expect(deleted).toEqual([]);
  });

  it("leaves a group alone while the bot is back in it", async () => {
    due = [group(1, false)];
    filesOf = { g1: ["a/1"] };
    const { store, deleted } = storeOf();
    expect(await purgeLeftGroups(db, store, NOW, async () => true)).toEqual({
      purged: 0,
      skipped: 1,
    });
    expect(deleted).toEqual([]);
    expect(log.some((l) => l.startsWith("row-deleted"))).toBe(false);
    // not in it (or LINE not sure): the 30 days stand
    expect((await purgeLeftGroups(db, store, NOW, async () => false)).purged).toBe(1);
  });

  it("when the objects cannot be removed the group is still gone (a leak of space, never of someone's data)", async () => {
    due = [group(1, false)];
    filesOf = { g1: ["a/1"] };
    expect(await purgeLeftGroups(db, storeOf(true).store, NOW)).toEqual({ purged: 1, skipped: 0 });
  });

  it("with files but no file store, waits rather than leave objects behind", async () => {
    due = [group(1, false)];
    filesOf = { g1: ["a/1"] };
    expect(await purgeLeftGroups(db, null, NOW)).toEqual({ purged: 0, skipped: 1 });
    expect(log.some((l) => l.startsWith("row-deleted"))).toBe(false);
  });

  it("a group with no files goes even without a file store", async () => {
    due = [group(1, false)];
    expect(await purgeLeftGroups(db, null, NOW)).toEqual({ purged: 1, skipped: 0 });
  });
});
