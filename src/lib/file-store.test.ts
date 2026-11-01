import { describe, expect, it, vi } from "vitest";
import { createMemoryStore, createR2Store, getFileStore, type R2Like } from "./file-store";

function fakeBucket() {
  const bucket = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  };
  return bucket as unknown as R2Like & typeof bucket;
}

describe("the R2 store", () => {
  it("stores with the content type", async () => {
    const bucket = fakeBucket();
    await createR2Store(bucket).put("k", new Uint8Array([1]), "image/png");
    expect(bucket.put).toHaveBeenCalledWith("k", new Uint8Array([1]), {
      httpMetadata: { contentType: "image/png" },
    });
  });

  it("deletes in batches of 1000", async () => {
    const bucket = fakeBucket();
    await createR2Store(bucket).delete(Array.from({ length: 2500 }, (_, i) => `k${i}`));
    expect(bucket.delete).toHaveBeenCalledTimes(3);
  });

  it("does nothing for no keys", async () => {
    const bucket = fakeBucket();
    await createR2Store(bucket).delete([]);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("passes a missing object on as null", async () => {
    await expect(createR2Store(fakeBucket()).get("k")).resolves.toBeNull();
  });
});

describe("the memory store", () => {
  it("keeps, returns and forgets", async () => {
    const store = createMemoryStore();
    await store.put("k", new Uint8Array([1, 2]), "text/plain");
    expect(store.keys()).toEqual(["k"]);
    expect((await store.get("k"))?.size).toBe(2);
    await store.delete(["k"]);
    await expect(store.get("k")).resolves.toBeNull();
  });
});

describe("getFileStore", () => {
  it("is null without the binding", async () => {
    await expect(getFileStore()).resolves.toBeNull();
  });
});
