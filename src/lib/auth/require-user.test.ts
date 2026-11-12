import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the users table says: the row, or a failed lookup. */
let userRow: { id: string } | null = { id: "u1" };
let lookupFails = false;
let lookups = 0;
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            lookups++;
            return lookupFails
              ? { data: null, error: { message: "down" } }
              : { data: userRow, error: null };
          },
        }),
      }),
    }),
  }),
}));

import { forgetUser, requireUser } from "./require-user";
import { signSession } from "./session";

const SECRET = "s".repeat(40);
const ENV_KEYS = [
  "LINE_CHANNEL_ID",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_JWT_SECRET",
  "CRON_SECRET",
  "GEMINI_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  userRow = { id: "u1" };
  lookupFails = false;
  lookups = 0;
  forgetUser("u1");
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) process.env[k] = "x";
  process.env.SESSION_JWT_SECRET = SECRET;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = (authorization?: string) =>
  new Request("https://example.test/api/x", {
    headers: authorization ? { authorization } : {},
  });

describe("requireUser", () => {
  it("401 without a token", async () => {
    const res = await requireUser(req());
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  it("401 with a forged token", async () => {
    const res = await requireUser(req("Bearer abc.def.ghi"));
    expect((res as Response).status).toBe(401);
  });

  it("returns the claims for a valid token", async () => {
    const token = await signSession({ userId: "u-1", lineUserId: "U1" }, SECRET);
    const res = await requireUser(req(`Bearer ${token}`));
    expect(res).toEqual({ userId: "u-1", lineUserId: "U1" });
  });
});

describe("requireUser: an account that is gone", () => {
  const signed = async () =>
    `Bearer ${await signSession({ userId: "u1", lineUserId: "U1" }, SECRET)}`;

  it("refuses a valid session once the account was deleted", async () => {
    userRow = null;
    const res = await requireUser(req(await signed()));
    expect((res as Response).status).toBe(401);
  });

  it("looks the person up once a minute, not on every request", async () => {
    const header = await signed();
    await requireUser(req(header));
    await requireUser(req(header));
    expect(lookups).toBe(1);
  });

  it("forgetting the person (account deleted here) refuses the very next request", async () => {
    const header = await signed();
    await requireUser(req(header));
    userRow = null;
    forgetUser("u1");
    expect(((await requireUser(req(header))) as Response).status).toBe(401);
  });

  it("a failed lookup does not sign anybody out", async () => {
    lookupFails = true;
    const res = await requireUser(req(await signed()));
    expect(res).not.toBeInstanceOf(Response);
  });
});
