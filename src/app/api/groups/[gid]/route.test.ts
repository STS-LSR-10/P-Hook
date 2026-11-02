import { beforeEach, describe, expect, it, vi } from "vitest";
import { readViewToken, verifyFileToken } from "@/lib/auth/file-token";
import type { GroupViewer } from "@/lib/group-access";

const GID = "33333333-3333-4333-8333-333333333333";
const F = "11111111-1111-4111-8111-111111111111";
const R = "44444444-4444-4444-8444-444444444444";
const SECRET = "s".repeat(32);

let viewer: GroupViewer | null = null;
let viewerLine = "Uanna";
let fileSavedBy: string | null = "Uanna";
let fileFound = true;
let fileOwner = "app-owner";
const dropped: string[] = [];
const cancelled: string[] = [];
const scopes: unknown[] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: `app-${viewerLine}`, lineUserId: viewerLine }),
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SESSION_JWT_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "x" }),
}));
vi.mock("@/lib/group-access", () => ({ groupForViewer: async () => viewer }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/plan-server", () => ({ getPlanInfo: async () => ({ plan: "ultimate" }) }));
vi.mock("@/lib/file-store", () => ({
  getFileStore: async () => ({ delete: async () => undefined }),
}));
vi.mock("@/lib/file-repo", () => ({
  listGroupFiles: async (_db: unknown, groupId: string) => {
    scopes.push({ groupId });
    return {
      items: [
        {
          id: F,
          name: "a.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
          createdAt: "",
          hasThumb: false,
          savedBy: "Uanna",
        },
        {
          id: "f2",
          name: "b.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
          createdAt: "",
          hasThumb: false,
          savedBy: "Ubob",
        },
      ],
      hasMore: false,
    };
  },
  fileUsage: async () => 100,
  groupFileUsage: async () => 6,
  getGroupFile: async (_db: unknown, groupId: string, id: string) => {
    scopes.push({ groupId, id });
    return fileFound
      ? {
          id,
          name: "a.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
          createdAt: "",
          hasThumb: false,
          r2Key: "k",
          groupId: GID,
          savedBy: fileSavedBy,
          userId: fileOwner,
        }
      : null;
  },
  dropFileRow: async (_db: unknown, u: string, id: string) => void dropped.push(`${u}/${id}`),
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  listGroupReminders: async () => [
    {
      id: R,
      body: "ประชุม",
      remindAt: "",
      repeat: null,
      status: "active",
      category: null,
      createdBy: "Ubob",
    },
  ],
  cancelGroupReminder: async (_db: unknown, _g: string, id: string) => {
    cancelled.push(id);
    return true;
  },
}));

import { GET as FILES } from "./files/route";
import { DELETE as DELETE_FILE } from "./files/[id]/route";
import { POST as LINK } from "./files/[id]/link/route";
import { GET as REMINDERS } from "./reminders/route";
import { DELETE as CANCEL } from "./reminders/[id]/route";

const group = { id: GID, lineGroupId: "C1", ownerUserId: "app-owner", isActive: true };
const req = (method = "GET") => new Request(`https://app.test/api/groups/${GID}/x`, { method });
const at = (id?: string) => ({ params: Promise.resolve({ gid: GID, id: id ?? F }) });

beforeEach(() => {
  viewer = { group, isOwner: false };
  viewerLine = "Uanna";
  fileSavedBy = "Uanna";
  fileFound = true;
  fileOwner = "app-owner";
  dropped.length = 0;
  cancelled.length = 0;
  scopes.length = 0;
});

describe("a group's files", () => {
  it("are the owner's files of that group, with the owner's space", async () => {
    const res = await FILES(req(), at());
    const body = await res.json();
    expect(scopes).toEqual([{ groupId: GID }]);
    // a member never sees the owner's own figures
    expect(body).toMatchObject({
      usedBytes: null,
      groupBytes: null,
      capacityBytes: null,
      isOwner: false,
    });
    expect(body.items.map((f: { mine: boolean }) => f.mine)).toEqual([true, false]);
    expect(JSON.stringify(body.items)).not.toContain("savedBy");
    // the pictures' token reaches only this group
    await expect(readViewToken(body.viewToken, SECRET)).resolves.toEqual({
      userId: "app-owner",
      groupId: GID,
    });
  });

  it("are hidden from someone not in the group", async () => {
    viewer = null;
    expect((await FILES(req(), at())).status).toBe(404);
    expect((await LINK(req("POST"), at())).status).toBe(404);
  });

  it("give any member a link to one file of the group", async () => {
    viewerLine = "Ubob";
    const res = await LINK(req("POST"), at());
    const { url } = await res.json();
    const token = new URL(url).searchParams.get("t") ?? "";
    await expect(verifyFileToken(token, SECRET)).resolves.toEqual({
      userId: "app-owner",
      fileId: F,
    });
    expect(scopes).toEqual([{ groupId: GID, id: F }]);
  });

  it("are deleted only by who kept them, or the owner", async () => {
    viewerLine = "Ubob";
    expect((await DELETE_FILE(req("DELETE"), at())).status).toBe(403);
    expect(dropped).toEqual([]);

    viewer = { group, isOwner: true };
    expect((await DELETE_FILE(req("DELETE"), at())).status).toBe(200);
    expect(dropped).toEqual([`app-owner/${F}`]);
  });

  it("from before the ledger changed hands may be removed by whose space they take", async () => {
    viewerLine = "Uold";
    fileSavedBy = "Ubob";
    fileOwner = "app-Uold";
    expect((await DELETE_FILE(req("DELETE"), at())).status).toBe(200);
    expect(dropped).toEqual([`app-Uold/${F}`]);
  });

  it("show the owner the space", async () => {
    viewer = { group, isOwner: true };
    const body = await (await FILES(req(), at())).json();
    expect(body).toMatchObject({ usedBytes: 100, groupBytes: 6, isOwner: true, spaceLow: false });
  });
});

describe("a group's reminders", () => {
  it("show who may cancel each", async () => {
    const body = await (await REMINDERS(req(), at())).json();
    expect(body.items).toEqual([expect.objectContaining({ id: R, mine: false })]);
    expect(JSON.stringify(body.items)).not.toContain("createdBy");
  });

  it("are cancelled only by who set them, or the owner", async () => {
    expect((await CANCEL(req("DELETE"), at(R))).status).toBe(403);
    viewerLine = "Ubob";
    expect((await CANCEL(req("DELETE"), at(R))).status).toBe(200);
    expect(cancelled).toEqual([R]);
  });
});
