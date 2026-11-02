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

  it("lets a known member in", async () => {
    known.set("Uanna", { name: "แอน", updatedAt: "" });
    const out = await groupForViewer(db, "g1", anna, async () => null);
    expect(out).toEqual({ group, isOwner: false });
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

  it("keeps everyone out of a closed ledger", async () => {
    group = { id: "g1", lineGroupId: "C1", ownerUserId: "app-owner", isActive: false };
    expect(
      await groupForViewer(db, "g1", { userId: "app-owner", lineUserId: "Uo" }, vi.fn()),
    ).toBeNull();
  });
});
