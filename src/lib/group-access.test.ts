import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupRow } from "@/lib/group";
import { groupForViewer } from "./group-access";

let group: GroupRow | null = null;
let known = new Map<string, { name: string; updatedAt: string }>();
const remembered: string[] = [];

vi.mock("@/lib/group-repo", () => ({
  getGroupById: async () => group,
  memberNames: async () => known,
  upsertMember: async (_db: unknown, _g: string, id: string) => {
    remembered.push(id);
  },
}));

const db = {} as SupabaseClient;
const anna = { userId: "app-anna", lineUserId: "Uanna" };

beforeEach(() => {
  group = { id: "g1", lineGroupId: "C1", ownerUserId: "app-owner", isActive: true };
  known = new Map();
  remembered.length = 0;
});

describe("groupForViewer", () => {
  it("lets the owner in without asking LINE", async () => {
    const check = vi.fn();
    const out = await groupForViewer(db, "g1", { userId: "app-owner", lineUserId: "Uo" }, check);
    expect(out?.isOwner).toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("lets a member seen in the last day in without asking LINE", async () => {
    known.set("Uanna", { name: "แอน", updatedAt: new Date().toISOString() });
    const check = vi.fn(async () => null);
    const out = await groupForViewer(db, "g1", anna, check);
    expect(out).toEqual({ group, isOwner: false });
    expect(check).not.toHaveBeenCalled();
  });

  it("asks LINE again about a member seen long ago, who may have left", async () => {
    known.set("Uanna", { name: "แอน", updatedAt: "2026-01-01T00:00:00Z" });
    expect(await groupForViewer(db, "g1", anna, async () => null)).toBeNull();
    // LINE down: the member the bot knows keeps access
    const out = await groupForViewer(db, "g1", anna, async () => {
      throw new Error("down");
    });
    expect(out?.isOwner).toBe(false);
  });

  it("asks LINE about anyone else, and remembers a member", async () => {
    const out = await groupForViewer(db, "g1", anna, async () => ({ displayName: "แอน" }));
    expect(out?.isOwner).toBe(false);
    expect(remembered).toEqual(["Uanna"]);
  });

  it("keeps out someone LINE says is not in the group, or when LINE cannot be asked", async () => {
    expect(await groupForViewer(db, "g1", anna, async () => null)).toBeNull();
    expect(
      await groupForViewer(db, "g1", anna, async () => {
        throw new Error("down");
      }),
    ).toBeNull();
  });

  it("keeps a closed ledger reachable, so what it kept can be removed", async () => {
    group = { id: "g1", lineGroupId: "C1", ownerUserId: "app-owner", isActive: false };
    const out = await groupForViewer(db, "g1", { userId: "app-owner", lineUserId: "Uo" }, vi.fn());
    expect(out?.isOwner).toBe(true);
  });

  it("keeps everyone out of a ledger never opened", async () => {
    group = null;
    expect(await groupForViewer(db, "g1", anna, async () => ({}))).toBeNull();
  });
});
