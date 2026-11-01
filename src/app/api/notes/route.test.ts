import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "plus";
let count = 0;
const created: string[] = [];
const updated: { id: string; body: string }[] = [];
const deleted: string[] = [];
const linkLists: (boolean | undefined)[] = [];
let found = true;
const N = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/note-repo", () => ({
  listNotes: async (_db: unknown, _u: string, o: { links?: boolean }) => {
    linkLists.push(o.links);
    return { items: [], hasMore: false };
  },
  countNotes: async () => count,
  createNote: async (_db: unknown, _u: string, body: string) => {
    created.push(body);
    return { id: N, body, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  },
  updateNote: async (_db: unknown, _u: string, id: string, body: string) => {
    updated.push({ id, body });
    return found;
  },
  deleteNote: async (_db: unknown, _u: string, id: string) => {
    deleted.push(id);
    return found;
  },
}));

import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const req = (method: string, body?: unknown, url = "https://app.example.com/api/notes") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = { params: Promise.resolve({ id: N }) };

beforeEach(() => {
  plan = "plus";
  count = 0;
  found = true;
  created.length = 0;
  updated.length = 0;
  deleted.length = 0;
});

describe("GET /api/notes", () => {
  it("says what the plan allows", async () => {
    count = 29;
    plan = "free";
    expect(await (await GET(req("GET"))).json()).toMatchObject({
      count: 29,
      limit: 30,
      canAdd: true,
    });
    count = 30;
    expect(await (await GET(req("GET"))).json()).toMatchObject({ canAdd: false });
  });

  it("refuses a bad page cursor", async () => {
    expect(
      (await GET(req("GET", undefined, "https://app.example.com/api/notes?before=nope"))).status,
    ).toBe(400);
  });
});

describe("POST /api/notes", () => {
  it("saves the cleaned text", async () => {
    const res = await POST(req("POST", { body: "  ซื้อนม  \n\n\n\nไข่ " }));
    expect(res.status).toBe(201);
    expect(created).toEqual(["ซื้อนม\n\nไข่"]);
  });

  it.each([[{ body: "   " }], [{}], [{ body: "ก".repeat(2001) }]])(
    "%j is refused",
    async (body) => {
      expect((await POST(req("POST", body))).status).toBe(400);
      expect(created).toHaveLength(0);
    },
  );

  it("Free stops at 30, Pro at 500, Elite at 2,000 (upgrade offered below Elite)", async () => {
    plan = "free";
    count = 30;
    const free = await POST(req("POST", { body: "x" }));
    expect(free.status).toBe(409);
    expect(await free.json()).toMatchObject({ upgrade: true });
    plan = "plus";
    count = 499;
    expect((await POST(req("POST", { body: "x" }))).status).toBe(201);
    count = 500;
    expect((await POST(req("POST", { body: "x" }))).status).toBe(409);
    plan = "ultimate";
    count = 2000;
    const full = await POST(req("POST", { body: "x" }));
    expect(await full.json()).toMatchObject({ upgrade: false });
  });
});

describe("PATCH / DELETE /api/notes/:id", () => {
  it("rewrites and deletes the person's own note", async () => {
    expect((await PATCH(req("PATCH", { body: " ใหม่ " }), params)).status).toBe(200);
    expect(updated).toEqual([{ id: N, body: "ใหม่" }]);
    expect((await DELETE(req("DELETE"), params)).status).toBe(200);
    expect(deleted).toEqual([N]);
  });

  it("answers 404 for a note that is not theirs or an id that is not an id", async () => {
    found = false;
    expect((await PATCH(req("PATCH", { body: "x" }), params)).status).toBe(404);
    expect((await DELETE(req("DELETE"), params)).status).toBe(404);
    const bad = { params: Promise.resolve({ id: "../x" }) };
    expect((await PATCH(req("PATCH", { body: "x" }), bad)).status).toBe(404);
    expect((await DELETE(req("DELETE"), bad)).status).toBe(404);
  });

  it("refuses an empty rewrite", async () => {
    expect((await PATCH(req("PATCH", { body: " " }), params)).status).toBe(400);
  });
});

describe("paging notes", () => {
  it("accepts a time as the database writes it", async () => {
    const before = encodeURIComponent("2026-11-01T05:00:00.123456+00:00");
    const res = await GET(
      req("GET", undefined, `https://app.example.com/api/notes?before=${before}`),
    );
    expect(res.status).toBe(200);
  });
});

describe("notes with links", () => {
  it("asks for them only with links=1", async () => {
    linkLists.length = 0;
    await GET(req("GET", undefined, "https://app.example.com/api/notes?links=1"));
    await GET(req("GET", undefined, "https://app.example.com/api/notes"));
    expect(linkLists).toEqual([true, false]);
  });
});
