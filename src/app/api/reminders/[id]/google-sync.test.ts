import { beforeEach, describe, expect, it, vi } from "vitest";

const R = "44444444-4444-4444-8444-444444444444";
const current = {
  id: R,
  body: "กินยา",
  remindAt: "2099-11-05T02:00:00.000Z",
  repeat: null,
  status: "active",
  category: null,
};
const synced = vi.fn();
const skipped = vi.fn();
const removed = vi.fn();

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", async (o) => ({
  ...(await o<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/reminder-input", async (o) => ({
  ...(await o<typeof import("@/lib/reminder-input")>()),
  reminderRoomProblem: async () => null,
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  getReminder: async () => current,
  updateReminder: async (
    _db: unknown,
    _u: string,
    id: string,
    i: { body: string; remindAt: Date },
  ) => ({
    ...current,
    id,
    body: i.body,
    remindAt: i.remindAt.toISOString(),
  }),
  cancelReminder: async () => true,
  skipReminderRound: async () => true,
}));
vi.mock("@/lib/google/sync", () => ({
  syncReminderToGoogle: async (...a: unknown[]) => synced(...a),
  googleEventOf: async () => "ev1",
  removeGoogleEvent: async (...a: unknown[]) => removed(...a),
  skipGoogleRound: async (...a: unknown[]) => skipped(...a),
}));

const { PATCH, DELETE } = await import("./route");
const params = { params: Promise.resolve({ id: R }) };

beforeEach(() => vi.clearAllMocks());

describe("a reminder's Google event follows it", () => {
  it("an edit changes the event", async () => {
    const res = await PATCH(
      new Request(`https://app.test/api/reminders/${R}`, {
        method: "PATCH",
        body: JSON.stringify({
          body: "กินยาหลังอาหาร",
          remindAt: new Date(Date.now() + 86_400_000).toISOString(),
          repeat: null,
        }),
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(synced).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.objectContaining({ body: "กินยาหลังอาหาร" }),
      undefined,
      {},
    );
  });

  it("fixing only the words says so, so the series keeps its rounds", async () => {
    await PATCH(
      new Request(`https://app.test/api/reminders/${R}`, {
        method: "PATCH",
        body: JSON.stringify({ body: "กินยาก่อนนอน", remindAt: current.remindAt, repeat: null }),
      }),
      params,
    );
    expect(synced).toHaveBeenCalledWith(expect.anything(), "u1", expect.anything(), undefined, {
      onlyText: true,
    });
  });

  it("skipping a round of a repeat skips it on Google too", async () => {
    current.repeat = "daily" as never;
    current.remindAt = new Date(Date.now() + 3_600_000).toISOString();
    await PATCH(
      new Request(`https://app.test/api/reminders/${R}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "done", remindAt: current.remindAt }),
      }),
      params,
    );
    expect(skipped).toHaveBeenCalledWith(expect.anything(), "u1", R, current.remindAt);
    current.repeat = null as never;
  });

  it("cancelling removes the event", async () => {
    const res = await DELETE(
      new Request(`https://app.test/api/reminders/${R}`, { method: "DELETE" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(removed).toHaveBeenCalledWith(expect.anything(), "u1", "ev1");
  });
});
