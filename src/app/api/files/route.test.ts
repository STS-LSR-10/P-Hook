import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore, type FileStore } from "@/lib/file-store";
import type { FileDto } from "@/lib/file";
import { signFileToken, signViewToken, verifyViewToken } from "@/lib/auth/file-token";

const F = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(32);
const file: FileDto & { r2Key: string } = {
  hasThumb: false,
  id: F,
  name: "สัญญา.pdf",
  mimeType: "application/pdf",
  sizeBytes: 3,
  createdAt: "2026-11-01T05:00:00Z",
  r2Key: "u/u1/key",
};
let signedIn = true;
let owned: (FileDto & { r2Key: string }) | null = file;
let store: FileStore | null = null;
let renamed = true;
const order: string[] = [];
const names: string[] = [];
const kinds: string[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () =>
    signedIn
      ? { userId: "u1", lineUserId: "U1" }
      : new Response(JSON.stringify({ error: "x" }), { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SESSION_JWT_SECRET: SECRET }) }));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan: "free", plan_expires_at: null }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/file-store", async (original) => ({
  ...(await original<typeof import("@/lib/file-store")>()),
  getFileStore: async () => store,
}));
vi.mock("@/lib/file-repo", () => ({
  listFiles: async (_db: unknown, _u: string, o: { kind?: string }) => {
    if (o.kind) kinds.push(o.kind);
    return { items: [file], hasMore: false };
  },
  fileUsage: async () => 3,
  getReadyFile: async (_db: unknown, userId: string) => (userId === "u1" ? owned : null),
  renameFile: async (_db: unknown, _u: string, _id: string, name: string) => {
    names.push(name);
    return renamed;
  },
  dropFileRow: async () => void order.push("row"),
}));

import { GET } from "./route";
import { DELETE, PATCH } from "./[id]/route";
import { POST as LINK } from "./[id]/link/route";
import { GET as DOWNLOAD } from "./[id]/download/route";
import { GET as VIEW } from "./[id]/view/route";

const params = (id = F) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request(`https://app.example.com/api/files/${F}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const download = (t: string) =>
  new Request(`https://app.example.com/api/files/${F}/download?t=${t}`);

beforeEach(async () => {
  signedIn = true;
  owned = file;
  renamed = true;
  order.length = 0;
  names.length = 0;
  kinds.length = 0;
  store = createMemoryStore();
  await store.put("u/u1/key", new Uint8Array([1, 2, 3]), "application/pdf");
});

describe("GET /api/files", () => {
  it("lists with the space used", async () => {
    const res = await GET(new Request("https://app.example.com/api/files?q=a"));
    expect(await res.json()).toMatchObject({
      hasMore: false,
      usedBytes: 3,
      capacityBytes: 500 * 1024 * 1024,
    });
  });

  it("passes the kind on, and a token for the pictures", async () => {
    const res = await GET(new Request("https://app.example.com/api/files?kind=image"));
    const body = (await res.json()) as { viewToken: string };
    expect(kinds).toEqual(["image"]);
    await expect(verifyViewToken(body.viewToken, SECRET)).resolves.toBe("u1");
  });

  it("refuses an unknown kind", async () => {
    const res = await GET(new Request("https://app.example.com/api/files?kind=x"));
    expect(res.status).toBe(400);
  });

  it("pages from a time as the database writes it", async () => {
    const before = encodeURIComponent("2026-11-01T05:00:00.123456+00:00");
    const res = await GET(new Request(`https://app.example.com/api/files?before=${before}`));
    expect(res.status).toBe(200);
  });

  it("needs a session", async () => {
    signedIn = false;
    const res = await GET(new Request("https://app.example.com/api/files"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/files/:id/view", () => {
  const view = async (query: string, user = "u1") => {
    const t = await signViewToken(user, SECRET);
    return VIEW(
      new Request(`https://app.example.com/api/files/${F}/view?t=${t}${query}`),
      params(),
    );
  };
  const picture = { ...file, mimeType: "image/png", hasThumb: true };

  it("shows their picture in the page, never as a script", async () => {
    owned = picture;
    const res = await view("");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
  });

  it("shows the preview when asked", async () => {
    owned = picture;
    await (store as FileStore).put("u/u1/key.thumb", new Uint8Array([7]), "image/jpeg");
    const res = await view("&size=thumb");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7]));
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("a video shows its preview, but not itself", async () => {
    owned = { ...file, mimeType: "video/mp4", hasThumb: true };
    await (store as FileStore).put("u/u1/key.thumb", new Uint8Array([7]), "image/jpeg");
    expect((await view("&size=thumb")).status).toBe(200);
    expect((await view("")).status).toBe(404);
  });

  it.each(["image/svg+xml", "text/html", "application/pdf"])("never shows %s", async (mimeType) => {
    owned = { ...file, mimeType };
    expect((await view("")).status).toBe(404);
  });

  it("is 404 without a preview", async () => {
    owned = { ...picture, hasThumb: false };
    expect((await view("&size=thumb")).status).toBe(404);
  });

  it("is 404 for a file that is not theirs", async () => {
    owned = picture;
    expect((await view("", "someone")).status).toBe(404);
  });

  it("is 404 for an id that is no id", async () => {
    const t = await signViewToken("u1", SECRET);
    const res = await VIEW(
      new Request(`https://app.example.com/api/files/x/view?t=${t}`),
      params("x"),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a bad token", async () => {
    const res = await VIEW(
      new Request(`https://app.example.com/api/files/${F}/view?t=x`),
      params(),
    );
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/files/:id", () => {
  it("tidies the name and keeps the extension", async () => {
    const res = await PATCH(req("PATCH", { name: "  สัญญาใหม่\n" }), params());
    expect(res.status).toBe(200);
    expect(names).toEqual(["สัญญาใหม่.pdf"]);
  });

  it("refuses an empty name", async () => {
    const res = await PATCH(req("PATCH", { name: "   " }), params());
    expect(res.status).toBe(400);
  });

  it("is 404 for a file that is not theirs", async () => {
    owned = null;
    const res = await PATCH(req("PATCH", { name: "a" }), params());
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/files/:id", () => {
  it("removes the preview with it", async () => {
    const del = vi.spyOn(store as FileStore, "delete");
    await DELETE(req("DELETE"), params());
    expect(del).toHaveBeenCalledWith(["u/u1/key", "u/u1/key.thumb"]);
  });

  it("removes the object first, then the row", async () => {
    const del = vi.spyOn(store as FileStore, "delete").mockImplementation(async () => {
      order.push("object");
    });
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledOnce();
    expect(order).toEqual(["object", "row"]);
  });

  it("keeps the row when R2 fails", async () => {
    vi.spyOn(store as FileStore, "delete").mockRejectedValue(new Error("down"));
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(500);
    expect(order).toEqual([]);
  });

  it("is 404 for a file that is not theirs", async () => {
    owned = null;
    expect((await DELETE(req("DELETE"), params())).status).toBe(404);
  });
});

describe("POST /api/files/:id/link", () => {
  it("gives a link for their own file", async () => {
    const res = await LINK(req("POST"), params());
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain(`/api/files/${F}/download?t=`);
  });

  it("is 404 for a file that is not theirs", async () => {
    owned = null;
    expect((await LINK(req("POST"), params())).status).toBe(404);
  });
});

describe("GET /api/files/:id/download", () => {
  it("sends the file as a download", async () => {
    const t = await signFileToken({ userId: "u1", fileId: F }, SECRET);
    const res = await DOWNLOAD(download(t), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses an expired token", async () => {
    const t = await signFileToken(
      { userId: "u1", fileId: F },
      SECRET,
      new Date(Date.now() - 3_600_000),
    );
    expect((await DOWNLOAD(download(t), params())).status).toBe(401);
  });

  it("refuses a token for another file", async () => {
    const t = await signFileToken({ userId: "u1", fileId: G }, SECRET);
    expect((await DOWNLOAD(download(t), params())).status).toBe(403);
  });

  it("is 404 for a file that is not theirs", async () => {
    const t = await signFileToken({ userId: "someone", fileId: F }, SECRET);
    expect((await DOWNLOAD(download(t), params())).status).toBe(404);
  });

  it("is 404 when the object has gone", async () => {
    await (store as FileStore).delete(["u/u1/key"]);
    const t = await signFileToken({ userId: "u1", fileId: F }, SECRET);
    expect((await DOWNLOAD(download(t), params())).status).toBe(404);
  });
});
