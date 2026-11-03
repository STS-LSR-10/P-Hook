import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guard } from "./api";
import { requireUser } from "./auth/require-user";
import { signSession, verifySession } from "./auth/session";
import { currentZone } from "./thai-date";
import { runInZone, enterZone, withZoneScope } from "./zone-scope";

const SECRET = "s".repeat(40);
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SESSION_JWT_SECRET;
  for (const k of [
    "LINE_CHANNEL_ID",
    "LINE_CHANNEL_SECRET",
    "LINE_CHANNEL_ACCESS_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "GEMINI_API_KEY",
  ])
    process.env[k] ??= "x";
  process.env.SESSION_JWT_SECRET = SECRET;
});
afterEach(() => {
  process.env.SESSION_JWT_SECRET = saved;
});

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("the zone of the work in hand", () => {
  it("is Bangkok outside any scope", () => {
    expect(currentZone()).toBe("Asia/Bangkok");
  });

  it("holds across awaits, and two at once do not mix", async () => {
    const seen: string[] = [];
    await Promise.all([
      runInZone("Asia/Tokyo", async () => {
        await tick();
        seen.push(currentZone());
      }),
      runInZone("Europe/London", async () => {
        await tick();
        seen.push(currentZone());
      }),
    ]);
    expect(seen.sort()).toEqual(["Asia/Tokyo", "Europe/London"]);
    expect(currentZone()).toBe("Asia/Bangkok");
  });

  it("can be set once the person is known, for the rest of the scope", async () => {
    const zone = await withZoneScope(async () => {
      await tick();
      enterZone("Asia/Tokyo");
      await tick();
      return currentZone();
    });
    expect(zone).toBe("Asia/Tokyo");
  });

  it("ignores a zone we do not list", async () => {
    expect(await withZoneScope(async () => (enterZone("Mars/Olympus"), currentZone()))).toBe(
      "Asia/Bangkok",
    );
  });
});

describe("a request to the API", () => {
  it("carries the person's zone in the session, and runs in it", async () => {
    const token = await signSession({ userId: "u1", lineUserId: "U1", tz: "Asia/Tokyo" }, SECRET);
    expect((await verifySession(token, SECRET))?.tz).toBe("Asia/Tokyo");
    let zone = "";
    await guard(async () => {
      const auth = await requireUser(
        new Request("https://x.test/api", { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(auth).not.toBeInstanceOf(Response);
      await tick();
      zone = currentZone();
      return new Response("ok");
    });
    expect(zone).toBe("Asia/Tokyo");
  });

  it("an older session without a zone is Bangkok", async () => {
    const token = await signSession({ userId: "u1", lineUserId: "U1" }, SECRET);
    expect((await verifySession(token, SECRET))?.tz).toBeUndefined();
  });
});
