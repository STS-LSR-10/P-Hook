import { describe, expect, it, vi } from "vitest";

const asked: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "Uowner" }),
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ LINE_CHANNEL_ACCESS_TOKEN: "x" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/line/client", () => ({
  createLineClient: () => ({ getGroupName: async (id: string) => `ชื่อ ${id}` }),
}));
vi.mock("@/lib/owned-groups", () => ({
  listOwnedGroups: async (
    _db: unknown,
    userId: string,
    nameOf: (line: string) => Promise<string | null>,
  ) => {
    asked.push(userId);
    return [{ id: "g1", name: (await nameOf("C1")) ?? "", isActive: true }];
  },
}));

const { GET } = await import("./route");

describe("GET /api/groups", () => {
  it("lists the signed-in person's own ledgers, named by LINE", async () => {
    const res = await GET(new Request("http://x/api/groups"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      items: [{ id: "g1", name: "ชื่อ C1", isActive: true }],
    });
    expect(asked).toEqual(["u1"]);
  });
});
