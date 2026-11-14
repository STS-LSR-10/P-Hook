import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
let plan = "plus";
let full = false;
let tx: { id: string; title: string; status: string; photo_path: string | null } | null;
const attached: unknown[][] = [];

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/slip-repo", async (original) => ({
  ...(await original<typeof import("@/lib/slip-repo")>()),
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/photo-repo", async (original) => ({
  ...(await original<typeof import("@/lib/photo-repo")>()),
  getPhotoTx: async () => tx,
}));
vi.mock("@/lib/photos", async (original) => ({
  ...(await original<typeof import("@/lib/photos")>()),
  attachPhotoBytes: async (...args: unknown[]) => {
    if (full) throw new PhotoStorageFull();
    attached.push(args);
  },
}));

import { POST } from "./route";
import { PhotoStorageFull } from "@/lib/photos";

const upload = (file: File | null) => {
  const form = new FormData();
  if (file) form.append("file", file);
  return POST(
    new Request("https://x/api/transactions/" + ID + "/photo", { method: "POST", body: form }),
    {
      params: Promise.resolve({ id: ID }),
    },
  );
};
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

beforeEach(() => {
  plan = "plus";
  full = false;
  attached.length = 0;
  tx = { id: ID, title: "กาแฟ", status: "confirmed", photo_path: null };
});

describe("POST /api/transactions/:id/photo", () => {
  it("stores the photo for a Pro entry", async () => {
    expect((await upload(png())).status).toBe(200);
    expect(attached).toHaveLength(1);
  });
  it("Free is refused (403) and nothing is stored", async () => {
    plan = "free";
    expect((await upload(png())).status).toBe(403);
    expect(attached).toHaveLength(0);
  });
  it("404 for an entry that is not theirs or is gone", async () => {
    tx = null;
    expect((await upload(png())).status).toBe(404);
  });
  it("full storage refuses the photo (413) and stores nothing", async () => {
    full = true;
    expect((await upload(png())).status).toBe(413);
    expect(attached).toHaveLength(0);
  });
  it("only pictures, and not too big", async () => {
    expect((await upload(null)).status).toBe(400);
    expect((await upload(new File(["x"], "a.pdf", { type: "application/pdf" }))).status).toBe(400);
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "b.png", { type: "image/png" });
    expect((await upload(big)).status).toBe(413);
    expect(attached).toHaveLength(0);
  });
});
