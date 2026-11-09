import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

let claims: Record<string, unknown> | null;
let plan = "plus";
const collected: unknown[] = [];

const TX = {
  id: "t1",
  type: "expense",
  title: "กาแฟ",
  amount: "30.50",
  occurred_at: "2026-10-15T07:30:00Z",
  source: "slip",
  category_id: null,
  slip_id: "s1",
  photo_path: "u1/photo-t1.jpg",
  note: null,
  tags: [],
  user_id: "u1",
  account_id: null,
  orig_currency: null,
  orig_amount: null,
  fx_rate: null,
  accounts: null,
  users: null,
  categories: null,
};

vi.mock("@/lib/auth/export-token", () => ({ verifyExportToken: async () => claims }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SESSION_JWT_SECRET: "s".repeat(40) }) }));
vi.mock("@/lib/plan-server", () => ({
  getPlanInfo: async () => ({ plan, expiresAt: null }),
}));
vi.mock("@/lib/wallet-repo", () => ({
  listWallets: async () => [{ id: "w1", name: "เงินสด", isDefault: true }],
}));
vi.mock("@/lib/transfer-repo", () => ({ listTransfers: async () => [] }));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  loadCategories: async () => [{ id: "c1", name: "อาหาร" }],
}));
vi.mock("@/lib/export/attachments", async (original) => ({
  ...(await original<typeof import("@/lib/export/attachments")>()),
  collectAttachments: async (_db: unknown, _user: string, sources: unknown[]) => {
    collected.push(sources);
    return { files: [{ name: "a (สลิป).jpg", data: new Uint8Array([1, 2]) }], skipped: 0 };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, name: string) => {
            if (name === "then") {
              return (resolve: (v: unknown) => unknown) => resolve({ data: [TX], error: null });
            }
            return () => q;
          },
        },
      );
      return q;
    },
  }),
}));

import { GET } from "./route";

const get = () => GET(new Request("https://x/api/export/download?t=tok"));

beforeEach(() => {
  claims = { userId: "u1", format: "csv", filters: {} };
  plan = "plus";
  collected.length = 0;
});

describe("GET /api/export/download", () => {
  it("CSV with the chosen columns only", async () => {
    claims = { userId: "u1", format: "csv", filters: {}, groups: ["title", "amount"] };
    const res = await get();
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect((await res.text()).replace("﻿", "").trim().split("\r\n")).toEqual([
      "ชื่อรายการ,จำนวนเงิน (บาท)",
      "กาแฟ,30.50",
    ]);
  });

  it("PDF: a PDF file, named by the date", async () => {
    plan = "ultimate";
    claims = { userId: "u1", format: "pdf", filters: { type: "expense", categoryId: "c1" } };
    const res = await get();
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/phook-\d{8}\.pdf/);
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
  });

  it("PDF: refused again at download time when the plan is not Elite", async () => {
    plan = "plus";
    claims = { userId: "u1", format: "pdf", filters: {} };
    expect((await get()).status).toBe(403);
  });

  it("with attachments it is a zip: the file at the top and the pictures in a folder", async () => {
    claims = { userId: "u1", format: "csv", filters: {}, attachments: true };
    const res = await get();
    expect(res.headers.get("content-type")).toBe("application/zip");
    const names = Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())));
    expect(names.some((n) => n.endsWith(".csv"))).toBe(true);
    expect(names.some((n) => n.startsWith("รูปสลิปและใบเสร็จ/"))).toBe(true);
    // the entry's slip id and photo path are what is asked for
    expect(collected[0]).toEqual([
      expect.objectContaining({ title: "กาแฟ", slipId: "s1", photoPath: "u1/photo-t1.jpg" }),
    ]);
  });

  it("an old or bad link is refused", async () => {
    claims = null;
    expect((await get()).status).toBe(401);
  });
});
