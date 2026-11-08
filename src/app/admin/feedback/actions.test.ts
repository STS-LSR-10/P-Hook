import { beforeEach, describe, expect, it, vi } from "vitest";

let admin = true;
const deleted: string[] = [];
const revalidated: string[] = [];

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin/access", () => ({ isAdminRequest: async () => admin }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/feedback-repo", () => ({
  deleteFeedback: async (_db: unknown, id: string) => {
    deleted.push(id);
    return true;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { deleteFeedbackAction } from "./actions";

const ID = "55555555-5555-4555-8555-555555555555";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  admin = true;
  deleted.length = 0;
  revalidated.length = 0;
});

describe("deleteFeedbackAction", () => {
  it("deletes that one entry and goes back to the same list", async () => {
    await expect(
      deleteFeedbackAction(form({ id: ID, back: "/admin/feedback?source=line&page=2" })),
    ).rejects.toThrow("REDIRECT /admin/feedback?source=line&page=2");
    expect(deleted).toEqual([ID]);
    expect(revalidated).toContain("/admin/feedback");
  });

  it("is a 404 for anyone who is not the admin, and deletes nothing", async () => {
    admin = false;
    await expect(deleteFeedbackAction(form({ id: ID, back: "/admin/feedback" }))).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(deleted).toEqual([]);
  });

  it("refuses an id that is not a uuid", async () => {
    await expect(
      deleteFeedbackAction(form({ id: "1 or 1=1", back: "/admin/feedback" })),
    ).rejects.toThrow("REDIRECT /admin/feedback");
    expect(deleted).toEqual([]);
  });

  it("only goes back to the feedback list, never to another address", async () => {
    for (const back of [
      "https://evil.example/x",
      "//evil.example",
      "/admin",
      "",
      "/admin/feedbackx",
    ]) {
      await expect(deleteFeedbackAction(form({ id: ID, back }))).rejects.toThrow(
        "REDIRECT /admin/feedback",
      );
    }
  });
});
