import { beforeEach, describe, expect, it, vi } from "vitest";

let plan = "free";
const createAddonCheckout = vi.fn(async () => ({
  status: "redirect" as const,
  url: "https://pay.example/x",
  reference: "cs_1",
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/slip-repo", () => ({
  getUserPlanRow: async () => ({ plan, plan_expires_at: null }),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/payments/billing-state", () => ({
  loadBillingState: async () => ({ customerId: "cus_1" }),
}));
vi.mock("@/lib/payments", () => ({
  getPaymentProvider: () => ({ createAddonCheckout }),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("https://app.example.com/api/addons/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  plan = "free";
  createAddonCheckout.mockClear();
});

describe("POST /api/addons/checkout", () => {
  it("is for paid plans: Free is sent to upgrade and nothing is created", async () => {
    const res = await post({ sku: "slips_100" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ available: false, upgrade: true });
    expect(createAddonCheckout).not.toHaveBeenCalled();
  });

  it.each(["starter", "plus", "ultimate"])(
    "%s can buy, and the price comes from the catalogue",
    async (p) => {
      plan = p;
      const res = await post({ sku: "storage_30", method: "promptpay", price: 1 });
      expect(await res.json()).toMatchObject({ available: true, url: "https://pay.example/x" });
      expect(createAddonCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u1",
          method: "promptpay",
          customerId: "cus_1",
          addon: expect.objectContaining({ sku: "storage_30", baht: 29 }),
        }),
      );
    },
  );

  it("an unknown add-on is refused", async () => {
    plan = "plus";
    expect((await post({ sku: "free_money" })).status).toBe(400);
    expect(createAddonCheckout).not.toHaveBeenCalled();
  });
});
