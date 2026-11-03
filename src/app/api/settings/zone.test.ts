import { beforeEach, describe, expect, it, vi } from "vitest";

const userUpdates: Record<string, unknown>[] = [];
const settingsUpserts: Record<string, unknown>[] = [];
let storedZone = "Asia/Bangkok";
let storedCurrency = "THB";
let storedLocale = "th";

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/repo", () => ({
  getSettings: async () => ({ confirm_style: "full" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: { timezone: storedZone, currency: storedCurrency, locale: storedLocale },
          error: null,
        }),
        update: (v: Record<string, unknown>) => {
          userUpdates.push(v);
          if (v.timezone) storedZone = String(v.timezone);
          if (v.currency) storedCurrency = String(v.currency);
          if (v.locale) storedLocale = String(v.locale);
          return chain;
        },
        upsert: async (v: Record<string, unknown>) => {
          settingsUpserts.push(v);
          return { error: null };
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
      };
      return table === "users" || table === "user_settings" ? chain : chain;
    },
  }),
}));

import { GET, PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(
    new Request("https://x.test/api/settings", { method: "PATCH", body: JSON.stringify(body) }),
  );

beforeEach(() => {
  userUpdates.length = 0;
  settingsUpserts.length = 0;
  storedZone = "Asia/Bangkok";
  storedCurrency = "THB";
  storedLocale = "th";
});

describe("the time zone in settings", () => {
  it("is read with the settings", async () => {
    const body = await (await GET(new Request("https://x.test/api/settings"))).json();
    expect(body).toMatchObject({
      confirm_style: "full",
      timezone: "Asia/Bangkok",
      currency: "THB",
    });
  });

  it("is saved on the person, alone", async () => {
    const res = await patch({ timezone: "Asia/Tokyo" });
    expect(res.status).toBe(200);
    expect(userUpdates).toEqual([{ timezone: "Asia/Tokyo" }]);
    expect(settingsUpserts).toEqual([]);
    expect(await res.json()).toMatchObject({ timezone: "Asia/Tokyo" });
  });

  it("only one of the zones we list", async () => {
    expect((await patch({ timezone: "Mars/Olympus" })).status).toBe(400);
    expect(userUpdates).toEqual([]);
  });
});

describe("the currency in settings", () => {
  it("is saved on the person, alone", async () => {
    const res = await patch({ currency: "USD" });
    expect(res.status).toBe(200);
    expect(userUpdates).toEqual([{ currency: "USD" }]);
    expect(settingsUpserts).toEqual([]);
    expect(await res.json()).toMatchObject({ currency: "USD" });
  });

  it("only one of the currencies we offer", async () => {
    expect((await patch({ currency: "VND" })).status).toBe(400);
    expect(userUpdates).toEqual([]);
  });
});

describe("the language in settings", () => {
  it("is read and saved on the person: Thai or English only", async () => {
    const body = await (await GET(new Request("https://x.test/api/settings"))).json();
    expect(body).toMatchObject({ locale: "th" });
    const res = await patch({ locale: "en" });
    expect(userUpdates).toEqual([{ locale: "en" }]);
    expect(await res.json()).toMatchObject({ locale: "en" });
    expect((await patch({ locale: "fr" })).status).toBe(400);
  });
});
