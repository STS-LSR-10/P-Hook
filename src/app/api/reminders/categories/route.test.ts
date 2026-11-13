import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CUSTOM_REMINDER_CATEGORIES } from "@/lib/user-reminder";

const A = "11111111-1111-4111-8111-111111111111";
let own: { id: string; name: string; emoji: string }[] = [];
const created: unknown[] = [];
let updateResult: "ok" | "missing" | "taken" = "ok";
let deleted = true;
let createResult: "ok" | "taken" = "ok";

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/reminder-category-repo", () => ({
  listReminderCategories: async () => own,
  createReminderCategory: async (
    _db: unknown,
    _u: string,
    input: { name: string; emoji: string },
  ) => {
    created.push(input);
    return createResult === "taken" ? null : { id: A, ...input };
  },
  updateReminderCategory: async () => updateResult,
  deleteReminderCategory: async () => deleted,
}));

import { POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const req = (method: string, body?: unknown) =>
  new Request("https://app.example.com/api/reminders/categories", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const at = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  own = [];
  created.length = 0;
  updateResult = "ok";
  createResult = "ok";
  deleted = true;
});

describe("POST /api/reminders/categories", () => {
  it("makes one from a name and one emoji, trimmed", async () => {
    const res = await POST(req("POST", { name: "  วิ่ง  ", emoji: "🏃" }));
    expect(res.status).toBe(201);
    expect(created).toEqual([{ name: "วิ่ง", emoji: "🏃" }]);
  });

  it.each([
    [{ name: "", emoji: "🏃" }],
    [{ name: "ก".repeat(21), emoji: "🏃" }],
    [{ name: "วิ่ง", emoji: "" }],
    [{ name: "วิ่ง", emoji: "🏃🏃" }],
    [{ name: "วิ่ง", emoji: "ab" }],
    [{ name: "วิ่ง" }],
  ])("refuses %j", async (body) => {
    expect((await POST(req("POST", body))).status).toBe(400);
    expect(created).toEqual([]);
  });

  it("refuses a name the person already has, in any case", async () => {
    own = [{ id: A, name: "Gym", emoji: "🏋️" }];
    expect((await POST(req("POST", { name: "gym", emoji: "🏃" }))).status).toBe(409);
  });

  it("a name made at the same moment by another tap is a 409, not an error", async () => {
    createResult = "taken";
    expect((await POST(req("POST", { name: "วิ่ง", emoji: "🏃" }))).status).toBe(409);
  });

  it("stops at the limit", async () => {
    own = Array.from({ length: MAX_CUSTOM_REMINDER_CATEGORIES }, (_, i) => ({
      id: `id${i}`,
      name: `c${i}`,
      emoji: "🏃",
    }));
    expect((await POST(req("POST", { name: "ใหม่", emoji: "🏃" }))).status).toBe(409);
  });
});

describe("PATCH and DELETE /api/reminders/categories/:id", () => {
  it("renames it", async () => {
    const res = await PATCH(req("PATCH", { name: "เดิน", emoji: "🚶" }), at(A));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ category: { id: A, name: "เดิน", emoji: "🚶" } });
  });

  it("someone else's (or a gone one) is not found", async () => {
    updateResult = "missing";
    expect((await PATCH(req("PATCH", { name: "เดิน", emoji: "🚶" }), at(A))).status).toBe(404);
    deleted = false;
    expect((await DELETE(req("DELETE"), at(A))).status).toBe(404);
  });

  it("a name another of the person's categories has is a 409", async () => {
    updateResult = "taken";
    expect((await PATCH(req("PATCH", { name: "เดิน", emoji: "🚶" }), at(A))).status).toBe(409);
  });

  it("a bad id is not found without asking the database", async () => {
    expect((await DELETE(req("DELETE"), at("x"))).status).toBe(404);
  });

  it("deletes it", async () => {
    expect((await DELETE(req("DELETE"), at(A))).status).toBe(200);
  });
});
