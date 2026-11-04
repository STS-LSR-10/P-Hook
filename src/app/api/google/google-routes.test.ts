import { beforeEach, describe, expect, it, vi } from "vitest";
import { signGoogleLinkToken } from "@/lib/auth/google-token";

const SECRET = "s".repeat(32);
const R = "44444444-4444-4444-8444-444444444444";
const KEY = Buffer.alloc(32, 3).toString("base64");

let configured = true;
let linked: { email: string | null } | null = { email: "a@gmail.com" };
let addResult: { kind: string; email?: string | null } = { kind: "added", email: "a@gmail.com" };
let linkFails = false;
let claimed = new Set<string>();
const pushed = vi.fn();
let reminder: { id: string; body: string; remindAt: string; repeat: null; status: string } | null;
const linkGoogle = vi.fn(async () => ({ email: "a@gmail.com" }));
const addReminderToGoogle = vi.fn(async () => addResult);
const unlinkGoogle = vi.fn(async () => undefined);

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ SESSION_JWT_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "x" }),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ userId: "u1", lineUserId: "U1" }),
}));
vi.mock("@/lib/rate-limit", async (o) => ({
  ...(await o<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/google/config", () => ({
  googleConfig: () =>
    configured
      ? {
          clientId: "cid",
          clientSecret: "x",
          tokenKey: KEY,
          redirectUri: "https://app.test/api/google/callback",
        }
      : null,
}));
vi.mock("@/lib/google/link-repo", async (o) => ({
  maskEmail: (await o<typeof import("@/lib/google/link-repo")>()).maskEmail,
  getGoogleLink: async () => {
    if (linkFails) throw new Error("relation does not exist");
    return linked ? { email: linked.email, sealedToken: "v1.x.y" } : null;
  },
  getUserBasics: async () => ({
    displayName: "<b>แอน</b>",
    lineUserId: "U1",
    timezone: "Asia/Bangkok",
    currency: null,
    locale: null,
  }),
}));
vi.mock("@/lib/google/sync", () => ({ linkGoogle, addReminderToGoogle, unlinkGoogle }));
vi.mock("@/lib/repo", () => ({
  claimEvent: async (_db: unknown, id: string) =>
    claimed.has(id) ? false : (claimed.add(id), true),
}));
vi.mock("@/lib/line/client", () => ({
  createLineClient: () => ({ push: async (...a: unknown[]) => pushed(...a) }),
}));
vi.mock("@/lib/user-reminder-repo", () => ({
  getReminder: async (_db: unknown, userId: string, id: string) =>
    userId === "u1" && id === R ? reminder : null,
}));

process.env.APP_BASE_URL = "https://app.test";
const connect = await import("./connect/route");
const callback = await import("./callback/route");
const status = await import("./route");
const calendar = await import("../reminders/[id]/calendar/route");

const token = (reminderId: string | null = R) =>
  signGoogleLinkToken({ userId: "u1", reminderId }, SECRET);
const params = { params: Promise.resolve({ id: R }) };
const post = (to: string) =>
  calendar.POST(
    new Request(`https://app.test/api/reminders/${R}/calendar`, {
      method: "POST",
      body: JSON.stringify({ to }),
    }),
    params,
  );

beforeEach(() => {
  configured = true;
  linked = { email: "a@gmail.com" };
  addResult = { kind: "added", email: "a@gmail.com" };
  linkFails = false;
  claimed = new Set();
  reminder = {
    id: R,
    body: "กินยา",
    remindAt: "2026-11-05T02:00:00Z",
    repeat: null,
    status: "active",
  };
  vi.clearAllMocks();
});

describe("the hop to the phone's own browser", () => {
  it("shows whose พี่ฮูก it links, then goes to Google with the token as state", async () => {
    const t = await token();
    const res = await connect.GET(new Request(`https://app.test/api/google/connect?t=${t}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("&lt;b&gt;แอน&lt;/b&gt;"); // their name, escaped
    const href = /href="([^"]+accounts\.google\.com[^"]+)"/.exec(html)?.[1] ?? "";
    expect(new URL(href.replace(/&amp;/g, "&")).searchParams.get("state")).toBe(t);
  });

  it("a link not made by พี่ฮูก, or out of date, goes nowhere", async () => {
    const res = await connect.GET(new Request("https://app.test/api/google/connect?t=nope"));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("accounts.google.com");
  });
});

describe("back from Google", () => {
  it("links the account and adds the reminder", async () => {
    const t = await token();
    const res = await callback.GET(
      new Request(`https://app.test/api/google/callback?code=c&state=${t}`),
    );
    expect(res.status).toBe(200);
    expect(linkGoogle).toHaveBeenCalledWith(expect.anything(), "u1", "c", expect.anything());
    expect(addReminderToGoogle).toHaveBeenCalledOnce();
    expect(await res.text()).toContain("line.me/R/");
  });

  it("saying no to Google links nothing", async () => {
    const t = await token();
    const res = await callback.GET(
      new Request(`https://app.test/api/google/callback?error=access_denied&state=${t}`),
    );
    expect(linkGoogle).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("a state that is not ours is refused", async () => {
    const res = await callback.GET(
      new Request("https://app.test/api/google/callback?code=c&state=x"),
    );
    expect(res.status).toBe(400);
    expect(linkGoogle).not.toHaveBeenCalled();
  });
});

describe("what the review found", () => {
  it("the page outside LINE warns against a link someone else sent", async () => {
    const res = await connect.GET(
      new Request(`https://app.test/api/google/connect?t=${await token()}`),
    );
    expect(await res.text()).toContain("ถ้ามีคนอื่นส่งลิงก์นี้มาให้");
  });

  it("a sign-in link works once", async () => {
    const t = await token();
    await callback.GET(new Request(`https://app.test/api/google/callback?code=c&state=${t}`));
    const again = await callback.GET(
      new Request(`https://app.test/api/google/callback?code=c2&state=${t}`),
    );
    expect(linkGoogle).toHaveBeenCalledOnce();
    expect(again.status).toBe(400);
  });

  it("the owner is told in LINE which Google account was linked", async () => {
    await callback.GET(
      new Request(`https://app.test/api/google/callback?code=c&state=${await token()}`),
    );
    expect(pushed).toHaveBeenCalledWith("U1", [
      expect.objectContaining({ text: expect.stringContaining("a@gmail.com") }),
    ]);
  });

  it("the app shows the account only partly", async () => {
    const res = await status.GET(new Request("https://app.test/api/google"));
    expect(((await res.json()) as { email: string }).email).toBe("a•••@gmail.com");
  });

  it("the phone's calendar link of a personal reminder runs out", async () => {
    const { open } = (await (await post("device")).json()) as { open: string };
    const t = new URL(open).searchParams.get("t") ?? "";
    const claims = JSON.parse(Buffer.from(t.split(".")[1] ?? "", "base64url").toString());
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(15 * 60);
  });

  it("before the migration the page still offers the phone's calendar", async () => {
    linkFails = true;
    const res = await calendar.GET(
      new Request(`https://app.test/api/reminders/${R}/calendar`),
      params,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { google: { linked: boolean } }).google.linked).toBe(false);
  });
});

describe("POST /api/reminders/:id/calendar", () => {
  it("the phone's calendar gets a link to the .ics, opened outside LINE", async () => {
    const body = (await (await post("device")).json()) as { open: string };
    expect(body.open).toMatch(/^https:\/\/app\.test\/api\/calendar\/.+to=ics/);
  });

  it("signed in: added straight away", async () => {
    expect(await (await post("google")).json()).toEqual({ added: true, email: "a•••@gmail.com" });
  });

  it("not signed in: the sign-in link, for the phone's own browser", async () => {
    addResult = { kind: "not_linked" };
    const body = (await (await post("google")).json()) as { open: string };
    expect(body.open).toMatch(/^https:\/\/app\.test\/api\/google\/connect\?t=/);
  });

  it("without Google set up: Google Calendar's own add page", async () => {
    configured = false;
    const body = (await (await post("google")).json()) as { open: string };
    expect(body.open).toMatch(/to=google/);
    expect(addReminderToGoogle).not.toHaveBeenCalled();
  });

  it("a reminder that is not theirs, or is over, is not found", async () => {
    reminder = null;
    expect((await post("device")).status).toBe(404);
  });
});

describe("/api/google", () => {
  it("says whether it is set up and which account is linked", async () => {
    const res = await status.GET(new Request("https://app.test/api/google"));
    expect(await res.json()).toEqual({ available: true, email: "a•••@gmail.com", linked: true });
  });

  it("signs out", async () => {
    const res = await status.DELETE(
      new Request("https://app.test/api/google", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(unlinkGoogle).toHaveBeenCalledOnce();
  });
});
