import { beforeEach, describe, expect, it, vi } from "vitest";

const setEnabled = vi.fn(async () => undefined);
const clear = vi.fn(async () => undefined);
let summary = { enabled: true, seen: 12, habits: ["amount_first"] };
let fails = false;

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/rate-limit", async (o) => ({
  ...(await o<typeof import("@/lib/rate-limit")>()),
  limitOr429: async () => null,
}));
vi.mock("@/lib/style-repo", () => ({
  styleSummary: async () => {
    if (fails) throw new Error("relation does not exist");
    return summary;
  },
  setStyleEnabled: (...a: unknown[]) => setEnabled(...(a as [])),
  clearStyle: (...a: unknown[]) => clear(...(a as [])),
}));

import { DELETE, GET, PUT } from "./route";

const put = (body: unknown) =>
  PUT(new Request("http://x/api/style", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  fails = false;
  summary = { enabled: true, seen: 12, habits: ["amount_first"] };
});

describe("/api/style", () => {
  it("shows whether it is on and what it found, never anything they wrote", async () => {
    const res = await GET(new Request("http://x/api/style"));
    expect(await res.json()).toEqual({ enabled: true, seen: 12, habits: ["amount_first"] });
  });

  it("switches it off for this person only", async () => {
    summary = { enabled: false, seen: 0, habits: [] };
    const res = await put({ enabled: false });
    expect(res.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledWith({}, "u1", false);
    expect(await res.json()).toMatchObject({ enabled: false });
  });

  it("refuses a body that is not true or false", async () => {
    expect((await put({ enabled: "yes" })).status).toBe(400);
    expect((await put(null)).status).toBe(400);
    expect(setEnabled).not.toHaveBeenCalled();
  });

  it("forgets what was learned", async () => {
    const res = await DELETE(new Request("http://x/api/style", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(clear).toHaveBeenCalledWith({}, "u1");
  });

  it("an outage is an error, not an empty list", async () => {
    fails = true;
    const res = await GET(new Request("http://x/api/style"));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
