import { describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "./token-crypto";
import { exchangeCode, googleAuthUrl, refreshAccessToken, GoogleRevokedError } from "./oauth";
import { deleteEvent, insertEvent, patchEvent, toGoogleEvent } from "./calendar-api";
import { googleConfig } from "./config";

const KEY = Buffer.alloc(32, 7).toString("base64");
const CFG = {
  clientId: "cid",
  clientSecret: "secret",
  tokenKey: KEY,
  redirectUri: "https://app.test/api/google/callback",
};

describe("googleConfig", () => {
  it("is null until all three secrets are set", () => {
    expect(googleConfig({ APP_BASE_URL: "https://app.test" })).toBeNull();
    expect(
      googleConfig({
        APP_BASE_URL: "https://app.test",
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
      }),
    ).toBeNull();
    expect(
      googleConfig({
        APP_BASE_URL: "https://app.test/",
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        GOOGLE_TOKEN_KEY: KEY,
      }),
    ).toEqual({
      clientId: "a",
      clientSecret: "b",
      tokenKey: KEY,
      redirectUri: "https://app.test/api/google/callback",
    });
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(
      googleConfig({
        APP_BASE_URL: "https://app.test",
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        GOOGLE_TOKEN_KEY: "short",
      }),
    ).toBeNull();
  });
});

describe("the stored token", () => {
  it("comes back as it went in, and is never stored in the clear", async () => {
    const sealed = await encryptToken("1//refresh-token", KEY);
    expect(sealed).not.toContain("refresh");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(await decryptToken(sealed, KEY)).toBe("1//refresh-token");
  });

  it("each sealing is different, and a changed one does not open", async () => {
    const a = await encryptToken("x", KEY);
    expect(await encryptToken("x", KEY)).not.toBe(a);
    const broken = a.slice(0, -2) + (a.endsWith("A") ? "BB" : "AA");
    await expect(decryptToken(broken, KEY)).rejects.toThrow();
  });
});

describe("sign in with Google", () => {
  it("asks only for calendar events and the email, offline, with consent", () => {
    const url = new URL(googleAuthUrl(CFG, "st"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/calendar.events",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe(CFG.redirectUri);
  });

  it("trades the code for tokens and reads the email", async () => {
    const payload = Buffer.from(JSON.stringify({ email: "a@gmail.com" })).toString("base64url");
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: "acc", refresh_token: "ref", id_token: `h.${payload}.s` }),
    );
    expect(await exchangeCode(CFG, "code", fetchImpl)).toEqual({
      accessToken: "acc",
      refreshToken: "ref",
      email: "a@gmail.com",
    });
    const body = String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain("grant_type=authorization_code");
  });

  it("a refused grant says the person took the access back", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(refreshAccessToken(CFG, "ref", fetchImpl)).rejects.toBeInstanceOf(
      GoogleRevokedError,
    );
  });
});

describe("the event", () => {
  const at = new Date("2026-11-05T02:00:00Z");
  it("starts at the reminder, lasts 15 minutes, and alerts at its time", () => {
    expect(toGoogleEvent({ body: "กินยา", at, repeat: null, zone: "Asia/Bangkok" })).toEqual({
      summary: "กินยา",
      description: "จาก พี่ฮูก",
      start: { dateTime: "2026-11-05T02:00:00.000Z", timeZone: "Asia/Bangkok" },
      end: { dateTime: "2026-11-05T02:15:00.000Z", timeZone: "Asia/Bangkok" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    });
  });

  it("a repeat repeats", () => {
    expect(
      toGoogleEvent({ body: "x", at, repeat: "weekly", zone: "Asia/Tokyo" }).recurrence,
    ).toEqual(["RRULE:FREQ=WEEKLY"]);
  });

  it("is added, changed and removed on the person's own calendar", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "ev1" }));
    const event = toGoogleEvent({ body: "x", at, repeat: null, zone: "Asia/Bangkok" });
    expect(await insertEvent("acc", event, fetchImpl)).toBe("ev1");
    await patchEvent("acc", "ev1", event, fetchImpl);
    await deleteEvent("acc", "ev1", fetchImpl);
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => `${i.method} ${u}`)).toEqual([
      "POST https://www.googleapis.com/calendar/v3/calendars/primary/events",
      "PATCH https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1",
      "DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1",
    ]);
    expect((calls[0]?.[1].headers as Record<string, string>).Authorization).toBe("Bearer acc");
  });

  it("an event already gone is fine to remove", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 410 }));
    await expect(deleteEvent("acc", "ev1", fetchImpl)).resolves.toBeUndefined();
  });
});
