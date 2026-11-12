import { beforeEach, describe, expect, it, vi } from "vitest";

let allowed = true;
const warned: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  rateLimit: async () => ({ allowed, hits: 1, limit: 20 }),
}));
vi.mock("@/lib/log", () => ({
  log: {
    warn: (_event: string, fields: Record<string, unknown>) => warned.push(fields),
    info: () => undefined,
    error: () => undefined,
  },
}));

import { POST } from "./route";

const report = (body: unknown, type = "application/csp-report") =>
  POST(
    new Request("https://app.example.com/api/csp-report", {
      method: "POST",
      headers: { "content-type": type },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  allowed = true;
  warned.length = 0;
});

describe("POST /api/csp-report", () => {
  it("logs the directive and only the host of what was blocked", async () => {
    const res = await report({
      "csp-report": {
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example.net/x.js?token=secret",
        "document-uri": "https://app.example.com/vault?t=abc",
      },
    });
    expect(res.status).toBe(204);
    expect(warned).toEqual([{ directive: "script-src-elem", blocked: "evil.example.net" }]);
    expect(JSON.stringify(warned)).not.toContain("secret");
  });

  it("keeps a short word for inline and eval", async () => {
    await report({ "csp-report": { "violated-directive": "script-src", "blocked-uri": "inline" } });
    expect(warned[0]).toEqual({ directive: "script-src", blocked: "inline" });
  });

  it("answers 204 and logs nothing when over the limit or unreadable", async () => {
    allowed = false;
    expect((await report({ "csp-report": { "blocked-uri": "https://a.b" } })).status).toBe(204);
    allowed = true;
    expect((await report("not json")).status).toBe(204);
    expect((await report({ big: "x".repeat(20_000) })).status).toBe(204);
    expect(warned).toEqual([]);
  });

  it("reads the Reporting API format too", async () => {
    await report(
      [
        {
          type: "csp-violation",
          body: { effectiveDirective: "img-src", blockedURL: "https://x.example.org/a.png" },
        },
      ],
      "application/reports+json",
    );
    expect(warned).toEqual([{ directive: "img-src", blocked: "x.example.org" }]);
  });

  it("drops a request that is not a report before any database call", async () => {
    allowed = true;
    await report({ "csp-report": { "blocked-uri": "https://a.b" } }, "text/plain");
    expect(warned).toEqual([]);
  });
});
