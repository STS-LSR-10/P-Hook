import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { giveAi, takeAi } from "./ai-pack";

/** A db whose usage counter takes what is left of `planLeft`, and whose pack rpc holds `packLeft`. */
function fakeDb(planLeft: number, packLeft: number | "broken") {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "take_usage_amount") {
      const ok = (args.p_amount as number) <= planLeft;
      return { data: ok, error: null };
    }
    if (name === "take_push_pack") {
      if (packLeft === "broken") return { data: null, error: { message: "no function" } };
      return { data: (args.p_amount as number) <= packLeft, error: null };
    }
    return { data: null, error: null };
  });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe("takeAi", () => {
  it("pays from the plan first", async () => {
    const { db } = fakeDb(10, 100);
    expect(await takeAi(db, "u", "starter", 2, "2026-11-01")).toBe("plan");
  });

  it("falls back to a pack when the plan is out", async () => {
    const { db, rpc } = fakeDb(0, 100);
    expect(await takeAi(db, "u", "starter", 2, "2026-11-01")).toBe("pack");
    expect(rpc).toHaveBeenCalledWith("take_push_pack", { p_user: "u", p_kind: "ai", p_amount: 2 });
  });

  it("is null when neither can pay", async () => {
    const { db } = fakeDb(0, 1);
    expect(await takeAi(db, "u", "starter", 2, "2026-11-01")).toBeNull();
  });

  it("counts an unreachable pack as none instead of failing", async () => {
    const { db } = fakeDb(0, "broken");
    expect(await takeAi(db, "u", "starter", 2, "2026-11-01")).toBeNull();
  });
});

describe("giveAi", () => {
  it("returns a pack's use to the pack", async () => {
    const { db, rpc } = fakeDb(0, 10);
    await giveAi(db, "u", 3, "2026-11-01", "pack");
    expect(rpc).toHaveBeenCalledWith("refund_push_pack", { p_user: "u", p_kind: "ai", p_amount: 3 });
  });

  it("returns a plan use to the monthly counter, also when no source is known", async () => {
    const { db, rpc } = fakeDb(0, 10);
    await giveAi(db, "u", 3, "2026-11-01");
    expect(rpc.mock.calls.some(([name]) => name !== "refund_push_pack")).toBe(true);
    expect(rpc.mock.calls.some(([name]) => name === "refund_push_pack")).toBe(false);
  });
});
