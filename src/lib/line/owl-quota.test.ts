import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "@/lib/repo";

const takeAmount = vi.fn(async () => true);
const refundAmount = vi.fn(async () => undefined);
const take = vi.fn(async () => true);
vi.mock("@/lib/usage", async (o) => ({
  ...(await o<typeof import("@/lib/usage")>()),
  takeUsage: (...a: unknown[]) => take(...(a as [])),
  refundUsage: async () => undefined,
  takeUsageAmount: (...a: unknown[]) => takeAmount(...(a as [])),
  refundUsageAmount: (...a: unknown[]) => refundAmount(...(a as [])),
}));

const { owlAsk } = await import("./owl");

const user = {
  id: "u1",
  line_user_id: "U1",
  display_name: null,
  plan: "free",
  plan_expires_at: null,
} as UserRow;
const answer = vi.fn(async () => "เพราะแสงกระเจิง");
const deps = () => ({
  db: {} as SupabaseClient,
  now: () => new Date("2026-11-04T03:00:00Z"),
  owl: { name: "t", answer },
});

beforeEach(() => {
  vi.clearAllMocks();
  takeAmount.mockResolvedValue(true);
});

describe("questions to พี่ฮูก take from the one AI quota", () => {
  it("a question typed to พี่ฮูก takes one use of ถาม AI for this month", async () => {
    const out = await owlAsk(deps(), user, "ทำไมฟ้าสีฟ้า", false, "U1");
    expect(JSON.stringify(out)).toContain("เพราะแสงกระเจิง");
    expect(takeAmount).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "ai_chat",
      1,
      50,
      "2026-11-01",
    );
    expect(take).not.toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "owl",
      expect.anything(),
      expect.anything(),
    );
  });

  it("a message the AI already read is not charged again when it turns out a question", async () => {
    await owlAsk(deps(), user, "ทำไมฟ้าสีฟ้า", false, "U1", { prepaid: true });
    expect(refundAmount).not.toHaveBeenCalled();
    expect(takeAmount).not.toHaveBeenCalled();
    expect(answer).toHaveBeenCalledOnce();
  });

  it("the router's use is given back when พี่ฮูก gives no answer", async () => {
    answer.mockRejectedValueOnce(new Error("down"));
    await owlAsk(deps(), user, "ทำไมฟ้าสีฟ้า", false, "U1", {
      prepaid: { units: 2, month: "2026-11-01" },
    });
    expect(refundAmount).toHaveBeenCalledWith(expect.anything(), "u1", "ai_chat", 2, "2026-11-01");
  });

  it("…and when the question is too long to ask", async () => {
    await owlAsk(deps(), user, "ก".repeat(400), false, "U1", {
      prepaid: { units: 5, month: "2026-11-01" },
    });
    expect(refundAmount).toHaveBeenCalledWith(expect.anything(), "u1", "ai_chat", 5, "2026-11-01");
  });

  it("with the quota used up, it says so and the AI is not asked", async () => {
    takeAmount.mockResolvedValue(false);
    const out = await owlAsk(deps(), user, "ทำไมฟ้าสีฟ้า", false, "U1");
    expect(answer).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).toContain("ถาม AI");
  });

  it("an answer that never came gives the uses back", async () => {
    answer.mockRejectedValueOnce(new Error("down"));
    await owlAsk(deps(), user, "ทำไมฟ้าสีฟ้า", false, "U1");
    expect(refundAmount).toHaveBeenCalledWith(expect.anything(), "u1", "ai_chat", 1, "2026-11-01");
  });
});
