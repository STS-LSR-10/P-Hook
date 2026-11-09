import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SLIP_LOCKED_TEXT, slipQuotaText } from "@/lib/line/messages";
import type { UserRow } from "@/lib/repo";
import { handleSlipImage, type SlipDeps } from "./slips";

let plan = "free";
let used = 0;
let usedEver = 0;
vi.mock("@/lib/upsell", () => ({ claimUpsellCard: async () => false }));
vi.mock("@/lib/slip-repo", async (original) => ({
  ...(await original<typeof import("@/lib/slip-repo")>()),
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
  countSlipsThisMonth: async () => used,
  countSlipsEver: async () => usedEver,
}));

const fetchImage = vi.fn(async () => {
  throw new Error("stop after the quota check");
});

const deps: SlipDeps = {
  db: {} as SupabaseClient,
  now: () => new Date("2026-10-17T08:00:00Z"),
  fetchImage,
  ocr: { name: "t", extract: async () => ({ kind: "not_slip" }) } as unknown as SlipDeps["ocr"],
};
const user = { id: "u1" } as UserRow;

const run = async () => {
  const reply = await handleSlipImage(deps, user, "m1");
  return (reply[0] as { text?: string }).text;
};

beforeEach(() => {
  plan = "free";
  used = 0;
  usedEver = 0;
  fetchImage.mockClear();
});

describe("slip quota by plan", () => {
  it("Free reads its first ten slips, ever", async () => {
    for (usedEver = 0; usedEver < 10; usedEver++) {
      fetchImage.mockClear();
      await expect(run()).rejects.toThrow("stop after the quota check");
      expect(fetchImage).toHaveBeenCalledTimes(1);
    }
  });

  it("Free with ten slips already read is pitched an upgrade, and nothing is downloaded", async () => {
    usedEver = 10;
    expect(await run()).toBe(SLIP_LOCKED_TEXT);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("Free's slips never reset with the month: only the lifetime count matters", async () => {
    used = 0; // none this month, but ten ever
    usedEver = 10;
    expect(await run()).toBe(SLIP_LOCKED_TEXT);
  });

  it.each([
    ["starter", 60],
    ["plus", 250],
    ["ultimate", 600],
  ] as const)(
    "%s is stopped at %i slips a month, and told what the next plan has",
    async (p, n) => {
      plan = p;
      used = n;
      expect(await run()).toBe(slipQuotaText(p, n));
      expect(fetchImage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["starter", 59],
    ["plus", 249],
    ["ultimate", 599],
  ] as const)("%s can still read its last slip (the %ith)", async (p, n) => {
    plan = p;
    used = n;
    await expect(run()).rejects.toThrow("stop after the quota check");
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("the wording points at the next plan, and Elite has none above it", () => {
    expect(slipQuotaText("starter", 60)).toContain("Pro");
    expect(slipQuotaText("plus", 250)).toContain("Elite");
    expect(slipQuotaText("ultimate", 600)).not.toContain("อัปเกรด");
  });
});
