import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "@/lib/repo";

vi.mock("@/lib/usage", async (o) => ({
  ...(await o<typeof import("@/lib/usage")>()),
  takeUsageAmount: async () => true,
  refundUsageAmount: async () => undefined,
}));

const { owlAsk } = await import("./owl");

const user = {
  id: "u1",
  line_user_id: "U1",
  display_name: null,
  plan: "pro",
  plan_expires_at: null,
} as unknown as UserRow;
const answer = vi.fn<(input: unknown) => Promise<string>>(async () => "เพราะแสงกระเจิง");
const deps = (extra: Record<string, unknown> = {}) => ({
  db: {} as SupabaseClient,
  now: () => new Date("2026-11-04T03:00:00Z"),
  owl: { name: "t", answer },
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("the AI answers in the manner the person chose", () => {
  it("passes the manner and call name to the AI", async () => {
    const manner = vi.fn(async () => ({ persona: "bestie" as const, name: "เจ้านาย" }));
    await owlAsk(deps({ manner }), user, "ทำไมฟ้าสีฟ้า", false, "U1");
    expect(manner).toHaveBeenCalledWith(user);
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ persona: "bestie", callName: "เจ้านาย" }),
    );
  });

  it("asks plainly when there is no way to know the manner", async () => {
    await owlAsk(deps(), user, "ทำไมฟ้าสีฟ้า", false, "U1");
    const arg = answer.mock.calls[0]?.[0] as { persona?: string };
    expect(arg.persona).toBeUndefined();
  });

  it("still answers when looking up the manner fails", async () => {
    const manner = vi.fn(async () => {
      throw new Error("db down");
    });
    const out = await owlAsk(deps({ manner }), user, "ทำไมฟ้าสีฟ้า", false, "U1");
    expect(JSON.stringify(out)).toContain("เพราะแสงกระเจิง");
  });
});
