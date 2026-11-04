import { describe, expect, it, vi } from "vitest";

const unlinkGoogle = vi.fn(async () => undefined);
vi.mock("@/lib/google/sync", () => ({ unlinkGoogle }));
vi.mock("@/lib/file-repo", () => ({ hasFiles: async () => false }));

const { deleteAccountData } = await import("./account");

describe("deleting an account", () => {
  it("gives the Google access back first (the row going does not tell Google)", async () => {
    const db = {
      storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
      from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
    };
    await deleteAccountData(db as never, "u1");
    expect(unlinkGoogle).toHaveBeenCalledWith(db, "u1");
  });
});
