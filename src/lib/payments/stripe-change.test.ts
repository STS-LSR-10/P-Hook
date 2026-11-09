import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChangeFields } from "./stripe-checkout";
import { createStripeProvider } from "./stripe";

const USER = "11111111-1111-1111-1111-111111111111";

describe("buildChangeFields", () => {
  it("a switch to Starter is charged Starter's price", () => {
    const f = buildChangeFields({
      userId: USER,
      itemId: "si_1",
      productId: "prod_1",
      plan: "starter",
      period: "monthly",
      now: new Date("2026-11-01T00:00:00Z"),
    });
    expect(f["items[0][price_data][unit_amount]"]).toBe("4900");
    expect(f["metadata[plan]"]).toBe("starter");
  });

  it("swaps the item for the new price and settles the difference immediately", () => {
    const f = buildChangeFields({
      userId: USER,
      itemId: "si_1",
      productId: "prod_1",
      plan: "ultimate",
      period: "yearly",
      now: new Date("2027-02-01T00:00:00Z"),
    });
    expect(f["items[0][id]"]).toBe("si_1");
    expect(f["items[0][price_data][product]"]).toBe("prod_1");
    expect(f["items[0][price_data][unit_amount]"]).toBe("199000");
    expect(f["items[0][price_data][recurring][interval]"]).toBe("year");
    expect(f.proration_behavior).toBe("always_invoice");
    // if the card fails the subscription must stay as it was
    expect(f.payment_behavior).toBe("error_if_incomplete");
    expect(f["metadata[plan]"]).toBe("ultimate");
    expect(f["metadata[period]"]).toBe("yearly");
  });
});

afterEach(() => vi.unstubAllGlobals());

function fakeDb() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const config = {
  secretKey: "sk_test_x",
  webhookSecret: "whsec_x",
  baseUrl: "https://app.example.com",
};

function stubStripe(subscription: Record<string, unknown>) {
  const sent: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      sent.push({ url, method, body: String(init?.body ?? "") });
      if (url.endsWith("/products")) return Response.json({ id: "prod_new" });
      if (method === "GET") {
        return Response.json({
          metadata: { user_id: USER },
          items: { data: [{ id: "si_1" }] },
          ...subscription,
        });
      }
      return Response.json({
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        current_period_end: 1_900_000_000,
        metadata: { user_id: USER, plan: "ultimate", period: "yearly", method: "card" },
      });
    }),
  );
  return sent;
}

describe("changeSubscription", () => {
  it("updates the subscription and applies the new plan right away", async () => {
    const sent = stubStripe({});
    const { db, calls } = fakeDb();
    const result = await createStripeProvider(config, () => db).changeSubscription({
      userId: USER,
      subscriptionId: "sub_1",
      plan: "ultimate",
      period: "yearly",
    });
    expect(result).toEqual({ status: "changed" });
    const update = sent.find((s) => s.method === "POST" && s.url.endsWith("/subscriptions/sub_1"));
    expect(update?.body).toContain("proration_behavior=always_invoice");
    expect(update?.body).toContain("prod_new");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fn: "set_plan_until",
      args: { p_user: USER, p_plan: "ultimate", p_period: "yearly", p_subscription: "sub_1" },
    });
  });

  it("refuses a subscription that belongs to someone else and charges nothing", async () => {
    const sent = stubStripe({ metadata: { user_id: "22222222-2222-2222-2222-222222222222" } });
    const { db, calls } = fakeDb();
    const result = await createStripeProvider(config, () => db).changeSubscription({
      userId: USER,
      subscriptionId: "sub_1",
      plan: "ultimate",
      period: "monthly",
    });
    expect(result.status).toBe("unavailable");
    expect(sent.every((s) => s.method === "GET")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("reports Stripe's error code when the card is declined and keeps the plan unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/products")) return Response.json({ id: "prod_new" });
        if ((init?.method ?? "GET") === "GET") {
          return Response.json({ metadata: { user_id: USER }, items: { data: [{ id: "si_1" }] } });
        }
        return Response.json(
          { error: { code: "card_declined", message: "declined" } },
          { status: 402 },
        );
      }),
    );
    const { db, calls } = fakeDb();
    const result = await createStripeProvider(config, () => db).changeSubscription({
      userId: USER,
      subscriptionId: "sub_1",
      plan: "ultimate",
      period: "monthly",
    });
    expect(result).toMatchObject({ status: "unavailable" });
    expect((result as { message: string }).message).toContain("402 card_declined");
    expect(calls).toHaveLength(0);
  });
});
