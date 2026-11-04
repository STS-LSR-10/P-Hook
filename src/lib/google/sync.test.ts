import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleConfig } from "./config";
import {
  addReminderToGoogle,
  linkGoogle,
  removeGoogleEvent,
  syncReminderToGoogle,
  unlinkGoogle,
} from "./sync";
import { decryptToken, encryptToken } from "./token-crypto";

type Row = Record<string, unknown>;
/** Just enough of supabase-js for the link and the reminders' event ids. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const where: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" | "update" | "delete" | "upsert"; values?: Row } = { kind: "select" };
    const matching = () => rows.filter((r) => where.every((w) => w(r)));
    const run = () => {
      if (op.kind === "update") for (const r of matching()) Object.assign(r, op.values);
      if (op.kind === "delete") {
        const gone = matching();
        tables[table] = rows.filter((r) => !gone.includes(r));
      }
      if (op.kind === "upsert") {
        const v = op.values ?? {};
        const found = rows.find((r) => r.user_id === v.user_id);
        if (found) Object.assign(found, v);
        else rows.push({ ...v });
      }
      return { data: matching(), error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (where.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (where.push((r) => (r[c] ?? null) === v), q),
      not: (c: string) => (where.push((r) => r[c] != null), q),
      update: (values: Row) => ((op = { kind: "update", values }), q),
      delete: () => ((op = { kind: "delete" }), q),
      upsert: (values: Row) => ((op = { kind: "upsert", values }), q),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => void) => ok(run()),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const KEY = Buffer.alloc(32, 9).toString("base64");
const cfg: GoogleConfig = {
  clientId: "c",
  clientSecret: "s",
  tokenKey: KEY,
  redirectUri: "https://app.test/api/google/callback",
};
const reminder = { id: "r1", body: "กินยา", remindAt: "2026-11-05T02:00:00Z", repeat: null };

let tables: Record<string, Row[]>;
let google: ReturnType<typeof vi.fn>;
const deps = () => ({ cfg, fetch: google as unknown as typeof fetch, zone: "Asia/Bangkok" });
const calls = () =>
  (google.mock.calls as [string, RequestInit][]).map(
    ([u, i]) => `${i.method} ${u.split("/").slice(-1)[0]}`,
  );

beforeEach(async () => {
  tables = {
    google_calendar_links: [
      { user_id: "u1", email: "a@gmail.com", refresh_token: await encryptToken("ref", KEY) },
    ],
    user_reminders: [{ id: "r1", user_id: "u1", group_id: null, google_event_id: null }],
  };
  google = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "acc" });
    if (init.method === "POST") return Response.json({ id: "ev1" });
    return Response.json({});
  });
});

describe("adding a reminder to Google", () => {
  it("adds the event and remembers it on the reminder", async () => {
    const r = await addReminderToGoogle(fakeDb(tables), "u1", reminder, deps());
    expect(r).toEqual({ kind: "added", email: "a@gmail.com" });
    expect(tables.user_reminders?.[0]?.google_event_id).toBe("ev1");
  });

  it("a second tap changes the same event, never adds a copy", async () => {
    tables.user_reminders![0]!.google_event_id = "ev1";
    await addReminderToGoogle(fakeDb(tables), "u1", reminder, deps());
    expect(calls()).toEqual(["POST token", "PATCH ev1"]);
  });

  it("someone not signed in is asked to", async () => {
    tables.google_calendar_links = [];
    expect(await addReminderToGoogle(fakeDb(tables), "u1", reminder, deps())).toEqual({
      kind: "not_linked",
    });
    expect(google).not.toHaveBeenCalled();
  });

  it("access taken back on Google's side forgets the link and asks again", async () => {
    google.mockImplementation(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    expect((await addReminderToGoogle(fakeDb(tables), "u1", reminder, deps())).kind).toBe(
      "not_linked",
    );
    expect(tables.google_calendar_links).toEqual([]);
  });

  it("without the secrets nothing is tried", async () => {
    const r = await addReminderToGoogle(fakeDb(tables), "u1", reminder, { ...deps(), cfg: null });
    expect(r.kind).toBe("not_linked");
  });
});

describe("keeping the event in step", () => {
  it("a changed reminder changes its event", async () => {
    tables.user_reminders![0]!.google_event_id = "ev1";
    await syncReminderToGoogle(fakeDb(tables), "u1", reminder, deps());
    expect(calls()).toEqual(["POST token", "PATCH ev1"]);
  });

  it("a reminder never added does not reach Google", async () => {
    await syncReminderToGoogle(fakeDb(tables), "u1", reminder, deps());
    expect(google).not.toHaveBeenCalled();
  });

  it("an event deleted on Google is not added back", async () => {
    tables.user_reminders![0]!.google_event_id = "ev1";
    google.mockImplementation(async (url: string) =>
      url.includes("token")
        ? Response.json({ access_token: "acc" })
        : new Response(null, { status: 404 }),
    );
    await syncReminderToGoogle(fakeDb(tables), "u1", reminder, deps());
    expect(tables.user_reminders?.[0]?.google_event_id).toBeNull();
  });

  it("Google being down never breaks the change", async () => {
    tables.user_reminders![0]!.google_event_id = "ev1";
    google.mockRejectedValue(new Error("down"));
    await expect(
      syncReminderToGoogle(fakeDb(tables), "u1", reminder, deps()),
    ).resolves.toBeUndefined();
    await expect(removeGoogleEvent(fakeDb(tables), "u1", "ev1", deps())).resolves.toBeUndefined();
  });

  it("a cancelled reminder removes its event", async () => {
    await removeGoogleEvent(fakeDb(tables), "u1", "ev1", deps());
    expect(calls()).toEqual(["POST token", "DELETE ev1"]);
  });
});

describe("the link", () => {
  it("signing in keeps the account, with the token sealed", async () => {
    tables.google_calendar_links = [];
    const payload = Buffer.from(JSON.stringify({ email: "b@gmail.com" })).toString("base64url");
    google.mockImplementation(async () =>
      Response.json({ access_token: "acc", refresh_token: "new-ref", id_token: `h.${payload}.s` }),
    );
    expect(await linkGoogle(fakeDb(tables), "u1", "code", deps())).toEqual({
      email: "b@gmail.com",
    });
    const row = tables.google_calendar_links?.[0];
    expect(row?.refresh_token).not.toContain("new-ref");
    expect(await decryptToken(String(row?.refresh_token), KEY)).toBe("new-ref");
  });

  it("signing out gives the access back and forgets every event id", async () => {
    tables.user_reminders![0]!.google_event_id = "ev1";
    await unlinkGoogle(fakeDb(tables), "u1", deps());
    expect(calls()).toEqual(["POST revoke"]);
    expect(tables.google_calendar_links).toEqual([]);
    expect(tables.user_reminders?.[0]?.google_event_id).toBeNull();
  });
});
