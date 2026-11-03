import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupViewer } from "@/lib/group-access";

const GID = "33333333-3333-4333-8333-333333333333";
const N = "11111111-1111-4111-8111-111111111111";

let viewer: GroupViewer;
let viewerLine = "Uanna";
let ownerPlan = "ultimate";
let count = 0;
let note: { id: string; createdBy: string | null; userId: string } | null = null;
const created: { userId: string; body: string; group: unknown }[] = [];
const changed: string[] = [];
const dropped: string[] = [];

vi.mock("@/lib/group-api", () => ({
  requireGroupViewer: async () => ({
    auth: { userId: `app-${viewerLine}`, lineUserId: viewerLine },
    db: {},
    viewer,
  }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/plan-server", () => ({ getPlanInfo: async () => ({ plan: ownerPlan }) }));
vi.mock("@/lib/note-repo", () => ({
  countNotes: async () => count,
  createNote: async (_db: unknown, userId: string, body: string, group: unknown) => {
    created.push({ userId, body, group });
    return { id: N, body, createdAt: "", updatedAt: "" };
  },
  listGroupNotes: async () => ({
    items: [
      {
        id: "n1",
        body: "a",
        createdAt: "",
        updatedAt: "",
        createdBy: "Uanna",
        userId: "app-owner",
      },
      { id: "n2", body: "b", createdAt: "", updatedAt: "", createdBy: "Ubob", userId: "app-owner" },
    ],
    hasMore: false,
  }),
  getGroupNote: async () => (note ? { ...note, body: "a", createdAt: "", updatedAt: "" } : null),
  updateGroupNote: async (_db: unknown, _g: string, id: string) => (changed.push(id), true),
  deleteGroupNote: async (_db: unknown, _g: string, id: string) => (dropped.push(id), true),
}));

const list = await import("./route");
const one = await import("./[id]/route");
const ctx = { params: Promise.resolve({ gid: GID }) };
const ctxOne = { params: Promise.resolve({ gid: GID, id: N }) };
const req = (method: string, body?: unknown) =>
  new Request(`http://x/api/groups/${GID}/notes`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  viewerLine = "Uanna";
  viewer = {
    group: { id: GID, lineGroupId: "C1", ownerUserId: "app-owner", isActive: true },
    isOwner: false,
  };
  ownerPlan = "ultimate";
  count = 0;
  note = { id: N, createdBy: "Uanna", userId: "app-owner" };
  created.length = 0;
  changed.length = 0;
  dropped.length = 0;
});

describe("GET /api/groups/:gid/notes", () => {
  it("lists the group's notes, marking those this member may change, and never who wrote them", async () => {
    const res = await list.GET(req("GET"), ctx);
    const body = (await res.json()) as { items: Record<string, unknown>[]; canAdd: boolean };
    expect(body.items.map((n) => n.mine)).toEqual([true, false]);
    expect(body.items[0]).not.toHaveProperty("createdBy");
    expect(body.items[0]).not.toHaveProperty("userId");
    expect(body.canAdd).toBe(true);
  });

  it("says nothing can be added once the ledger is closed", async () => {
    viewer.group.isActive = false;
    const body = (await (await list.GET(req("GET"), ctx)).json()) as { canAdd: boolean };
    expect(body.canAdd).toBe(false);
  });
});

describe("POST /api/groups/:gid/notes", () => {
  it("writes a note for the group, on the owner's limit, as this member", async () => {
    const res = await list.POST(req("POST", { body: " ซื้อนม " }), ctx);
    expect(res.status).toBe(201);
    expect(created).toEqual([
      { userId: "app-owner", body: "ซื้อนม", group: { groupId: GID, createdBy: "Uanna" } },
    ]);
  });

  it("is refused when the owner's notes are full, the owner left Elite, or the ledger is closed", async () => {
    count = 2000;
    expect((await list.POST(req("POST", { body: "x" }), ctx)).status).toBe(409);
    count = 0;
    ownerPlan = "plus";
    expect((await list.POST(req("POST", { body: "x" }), ctx)).status).toBe(403);
    ownerPlan = "ultimate";
    viewer.group.isActive = false;
    expect((await list.POST(req("POST", { body: "x" }), ctx)).status).toBe(403);
    expect(created).toEqual([]);
  });
});

describe("PATCH and DELETE /api/groups/:gid/notes/:id", () => {
  it("are allowed to whoever wrote it, the owner, and whose limit it is on", async () => {
    expect((await one.PATCH(req("PATCH", { body: "y" }), ctxOne)).status).toBe(200);
    viewerLine = "owner";
    expect((await one.DELETE(req("DELETE"), ctxOne)).status).toBe(200);
    expect(changed).toEqual([N]);
    expect(dropped).toEqual([N]);
  });

  it("are refused to another member, and say so for a note not in the group", async () => {
    viewerLine = "Ubob";
    expect((await one.PATCH(req("PATCH", { body: "y" }), ctxOne)).status).toBe(403);
    expect((await one.DELETE(req("DELETE"), ctxOne)).status).toBe(403);
    note = null;
    viewerLine = "Uanna";
    expect((await one.DELETE(req("DELETE"), ctxOne)).status).toBe(404);
    expect(changed).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
