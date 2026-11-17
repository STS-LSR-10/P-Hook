import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageError } from "@/lib/line/content";
import {
  ERROR_TEXT,
  IMAGE_TOO_LARGE_TEXT,
  NOT_FOUND_TEXT,
  PHOTO_ATTACHED_TEXT,
  PHOTO_EXPIRED_TEXT,
  PHOTO_LIMIT_TEXT,
  PHOTO_LOCKED_TEXT,
} from "@/lib/line/messages";
import type { UserRow } from "@/lib/repo";
import { handlePhotoImage, photoPathFor } from "./photos";

let plan = "plus";
let spaceUsed = 0;
let tx: {
  id: string;
  title: string;
  status: string;
  photo_path: string | null;
  photo_bytes?: number | null;
} | null = null;
const setPhoto = vi.fn(async () => undefined);
const clearPhotoWait = vi.fn(async () => undefined);

vi.mock("@/lib/slip-repo", async (original) => ({
  ...(await original<typeof import("@/lib/slip-repo")>()),
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/file-repo", () => ({ fileUsage: async () => spaceUsed }));
vi.mock("@/lib/addons-repo", () => ({ loadBonus: async () => ({ storageBytes: 0 }) }));
vi.mock("@/lib/photo-repo", () => ({
  getPhotoTx: async () => tx,
  setPhoto: (...args: unknown[]) => (setPhoto as unknown as (...a: unknown[]) => unknown)(...args),
  clearPhotoWait: (...args: unknown[]) =>
    (clearPhotoWait as unknown as (...a: unknown[]) => unknown)(...args),
}));

const upload = vi.fn<(...a: unknown[]) => Promise<{ error: { message: string } | null }>>(
  async () => ({ error: null }),
);
const remove = vi.fn<(...a: unknown[]) => Promise<{ error: null }>>(async () => ({ error: null }));
const db = { storage: { from: () => ({ upload, remove }) } } as unknown as SupabaseClient;

const fetchImage = vi.fn(async () => ({
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/jpeg",
}));
const deps = { db, now: () => new Date("2026-10-17T08:00:00Z"), fetchImage };
const user = { id: "u1" } as UserRow;
const live = { tx_id: "t1", expired: false };
const textOf = (m: unknown[]) => (m[0] as { text?: string }).text;

beforeEach(() => {
  plan = "plus";
  spaceUsed = 0;
  tx = { id: "t1", title: "ข้าวมันไก่", status: "confirmed", photo_path: null };
  for (const f of [setPhoto, clearPhotoWait, upload, remove, fetchImage]) f.mockClear();
  fetchImage.mockImplementation(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "image/jpeg",
  }));
  upload.mockImplementation(async () => ({ error: null }));
});

describe("handlePhotoImage", () => {
  it("stores the image under the entry's own path and tells the person", async () => {
    const out = await handlePhotoImage(deps, user, "m1", live);
    expect(textOf(out)).toBe(PHOTO_ATTACHED_TEXT("ข้าวมันไก่"));
    expect(upload.mock.calls[0]?.[0]).toBe("u1/photo-t1.jpg");
    expect(setPhoto).toHaveBeenCalledTimes(1);
    expect(clearPhotoWait).toHaveBeenCalledTimes(1);
  });

  it("works on Elite too", async () => {
    plan = "ultimate";
    expect(textOf(await handlePhotoImage(deps, user, "m1", live))).toBe(
      PHOTO_ATTACHED_TEXT("ข้าวมันไก่"),
    );
  });

  it("Free gets the upsell, nothing is downloaded, and the wait is cleared", async () => {
    plan = "free";
    const out = await handlePhotoImage(deps, user, "m1", live);
    expect(textOf(out)).toBe(PHOTO_LOCKED_TEXT);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(clearPhotoWait).toHaveBeenCalledTimes(1);
  });

  it("there is no monthly cap on photos", async () => {
    const out = await handlePhotoImage(deps, user, "m1", live);
    expect(textOf(out)).toBe(PHOTO_ATTACHED_TEXT("ข้าวมันไก่"));
  });

  it("when the space is full nothing is uploaded and the person is told", async () => {
    spaceUsed = 5 * 1024 ** 3 - 2; // Pro has 15 GB, so this is Starter's size: use Starter
    plan = "starter";
    const out = await handlePhotoImage(deps, user, "m1", live);
    expect(textOf(out)).toBe(PHOTO_LIMIT_TEXT);
    expect(upload).not.toHaveBeenCalled();
    expect(setPhoto).not.toHaveBeenCalled();
  });

  it("replacing a photo gives its space back first", async () => {
    spaceUsed = 5 * 1024 ** 3 - 2;
    plan = "starter";
    tx = { ...(tx as NonNullable<typeof tx>), photo_path: "u1/photo-t1.jpg", photo_bytes: 100 };
    const out = await handlePhotoImage(deps, user, "m1", live);
    expect(textOf(out)).toBe(PHOTO_ATTACHED_TEXT("ข้าวมันไก่"));
  });

  it("the size of the photo is kept on the entry", async () => {
    await handlePhotoImage(deps, user, "m1", live);
    expect((setPhoto.mock.calls[0] as unknown[])[5]).toBe(3);
  });

  it("an expired wait asks to tap the button again", async () => {
    const out = await handlePhotoImage(deps, user, "m1", { tx_id: "t1", expired: true });
    expect(textOf(out)).toBe(PHOTO_EXPIRED_TEXT);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(clearPhotoWait).toHaveBeenCalledTimes(1);
  });

  it("an entry that was deleted meanwhile is not found", async () => {
    tx = null;
    expect(textOf(await handlePhotoImage(deps, user, "m1", live))).toBe(NOT_FOUND_TEXT);
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the old file when the new one has another extension", async () => {
    tx = { id: "t1", title: "x", status: "confirmed", photo_path: "u1/photo-t1.png" };
    await handlePhotoImage(deps, user, "m1", live);
    expect(remove).toHaveBeenCalledWith(["u1/photo-t1.png"]);
  });

  it("keeps the file when replacing one with the same extension (it was overwritten)", async () => {
    tx = { id: "t1", title: "x", status: "confirmed", photo_path: "u1/photo-t1.jpg" };
    await handlePhotoImage(deps, user, "m1", live);
    expect(remove).not.toHaveBeenCalled();
  });

  it("explains an oversized image", async () => {
    fetchImage.mockImplementation(async () => {
      throw new ImageError("too_large", "big");
    });
    expect(textOf(await handlePhotoImage(deps, user, "m1", live))).toBe(IMAGE_TOO_LARGE_TEXT);
    expect(clearPhotoWait).toHaveBeenCalledTimes(1);
  });

  it("a failed upload gives the friendly error and does not record a photo", async () => {
    upload.mockImplementation(async () => ({ error: { message: "boom" } }));
    expect(textOf(await handlePhotoImage(deps, user, "m1", live))).toBe(ERROR_TEXT);
    expect(setPhoto).not.toHaveBeenCalled();
    expect(clearPhotoWait).toHaveBeenCalledTimes(1);
  });

  it("removes the uploaded file when saving the entry fails", async () => {
    setPhoto.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    expect(textOf(await handlePhotoImage(deps, user, "m1", live))).toBe(ERROR_TEXT);
    expect(remove).toHaveBeenCalledWith(["u1/photo-t1.jpg"]);
  });
});

describe("photoPathFor", () => {
  it("keeps one file per entry and picks the extension from the type", () => {
    expect(photoPathFor("u", "t", "image/png")).toBe("u/photo-t.png");
    expect(photoPathFor("u", "t", "image/webp")).toBe("u/photo-t.webp");
    expect(photoPathFor("u", "t", "image/jpeg")).toBe("u/photo-t.jpg");
  });
});
