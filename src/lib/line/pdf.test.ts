import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfReader } from "@/lib/ai/pdf-reader";
import type { UserRow } from "@/lib/repo";
import {
  PDF_ALL_DUPLICATE_TEXT,
  PDF_ALREADY_TEXT,
  PDF_FAILED_TEXT,
  PDF_LOCKED_TEXT,
  PDF_NO_ENTRIES_TEXT,
  PDF_ONLY_TEXT,
  PDF_PASSWORD_TEXT,
  PDF_TOO_LARGE_TEXT,
  pdfQuotaText,
} from "./messages";
import { handlePdfMessage, type PdfDeps } from "./pdf";

let usageLeft = 10;
const refunds: string[] = [];
const inserted: { title: string; type: string; source: string; rawText: string; status: string }[] =
  [];
let existing = new Set<string>();
let before: { id: string } | null = null;
let beforeEntries = 0;
const deletedImports: string[] = [];

vi.mock("@/lib/usage", async (original) => ({
  ...(await original<typeof import("@/lib/usage")>()),
  takeUsage: async () => usageLeft-- > 0,
  refundUsage: async (_d: unknown, _u: unknown, kind: string) => {
    refunds.push(kind);
  },
}));
vi.mock("@/lib/pdf-repo", async (original) => ({
  ...(await original<typeof import("@/lib/pdf-repo")>()),
  findImport: async () => before,
  countImportEntries: async () => beforeEntries,
  deleteImport: async (_d: unknown, id: string) => {
    deletedImports.push(id);
  },
  createImport: async () => "11111111-1111-1111-1111-111111111111",
  existingKeys: async () => existing,
}));
vi.mock("@/lib/line/upsell-reply", () => ({
  upsellReply: async (_d: unknown, _u: unknown, _n: unknown, feature: string) => [
    { type: "text", text: `upsell:${feature}` },
  ],
}));
vi.mock("@/lib/repo", async (original) => ({
  ...(await original<typeof import("@/lib/repo")>()),
  loadCategories: async () => [
    { id: "c-food", name: "อาหาร", type: "expense", is_hidden: false, sort_order: 1, icon: null },
    { id: "c-sal", name: "เงินเดือน", type: "income", is_hidden: false, sort_order: 1, icon: null },
  ],
  loadMemoryFor: async () => [],
  insertTransaction: async (_d: unknown, input: Record<string, unknown>) => {
    inserted.push({
      title: String(input.title),
      type: String(input.type),
      source: String(input.source),
      rawText: String(input.rawText),
      status: String(input.status),
    });
    return { id: `tx${inserted.length}` };
  },
}));

const PDF = new TextEncoder().encode("%PDF-1.4\n<< /Type /Page >>\n%%EOF");
let plan = "plus";
let reply: unknown = { entries: [] };
const read = vi.fn(async () => reply);
const reader: PdfReader = { name: "t", read };
const fetchPdf = vi.fn(async () => PDF);

const deps: PdfDeps = {
  db: {} as SupabaseClient,
  now: () => new Date("2026-10-28T05:00:00Z"),
  fetchPdf,
  reader,
};
const user = () => ({ id: "u1", plan, plan_expires_at: null }) as unknown as UserRow;
const run = (message: { id: string; fileName?: string; fileSize?: number } = { id: "m1" }) =>
  handlePdfMessage(deps, user(), message, "Uline");
const textOf = (r: unknown[]) => (r[0] as { text?: string }).text;

beforeEach(() => {
  plan = "plus";
  usageLeft = 10;
  refunds.length = 0;
  inserted.length = 0;
  deletedImports.length = 0;
  existing = new Set();
  before = null;
  beforeEntries = 0;
  reply = {
    entries: [
      { type: "expense", title: "ข้าวมันไก่", amount: 65, category: "อาหาร", date: "2026-10-27" },
      {
        type: "income",
        title: "เงินเดือน",
        amount: 25000,
        category: "เงินเดือน",
        date: "2026-10-25",
      },
    ],
  };
  read.mockClear();
  fetchPdf.mockClear();
});

describe("handlePdfMessage", () => {
  it("Free gets the upgrade pitch and nothing is downloaded or read", async () => {
    plan = "free";
    expect(textOf(await run())).toBe("upsell:pdf");
    expect(fetchPdf).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(PDF_LOCKED_TEXT).toContain("Pro");
  });

  it("refuses other file types and big files before downloading", async () => {
    expect(textOf(await run({ id: "m", fileName: "slip.xlsx" }))).toBe(PDF_ONLY_TEXT);
    expect(textOf(await run({ id: "m", fileName: "a.pdf", fileSize: 6 * 1024 * 1024 }))).toBe(
      PDF_TOO_LARGE_TEXT,
    );
    expect(fetchPdf).not.toHaveBeenCalled();
  });

  it("tells a password-protected file apart, without using the quota", async () => {
    fetchPdf.mockResolvedValueOnce(new TextEncoder().encode("%PDF-1.6\n/Encrypt 1 0 R"));
    expect(textOf(await run())).toBe(PDF_PASSWORD_TEXT);
    expect(read).not.toHaveBeenCalled();
    expect(refunds).toHaveLength(0);
  });

  it("records every entry as pending (source pdf) and answers with one check card", async () => {
    const out = await run({ id: "m1", fileName: "สเตตเมนต์.PDF" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([
      expect.objectContaining({
        title: "ข้าวมันไก่",
        type: "expense",
        source: "pdf",
        status: "pending_confirm",
      }),
      expect.objectContaining({
        title: "เงินเดือน",
        type: "income",
        source: "pdf",
        status: "pending_confirm",
      }),
    ]);
    expect(inserted[0]?.rawText).toBe("pdf:11111111-1111-1111-1111-111111111111");
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0])).toContain("a=pdfok&i=11111111-1111-1111-1111-111111111111");
    expect(refunds).toHaveLength(0); // the quota stays used
  });

  it("gives the quota back when nothing is found, the reader fails, or all of it is already there", async () => {
    reply = { entries: [] };
    expect(textOf(await run())).toBe(PDF_NO_ENTRIES_TEXT);
    read.mockRejectedValueOnce(new Error("boom"));
    expect(textOf(await run())).toBe(PDF_FAILED_TEXT);
    reply = { entries: [{ type: "expense", title: "x", amount: 65, date: "2026-10-27" }] };
    existing = new Set(["expense|6500|2026-10-27"]);
    expect(textOf(await run())).toBe(PDF_ALL_DUPLICATE_TEXT);
    expect(refunds).toEqual(["pdf", "pdf", "pdf"]);
    expect(inserted).toHaveLength(0);
  });

  it("leaves out entries the book already has and says how many", async () => {
    existing = new Set(["expense|6500|2026-10-27"]);
    const out = await run();
    expect(inserted.map((i) => i.title)).toEqual(["เงินเดือน"]);
    expect(JSON.stringify(out[0])).toContain("ข้าม 1 รายการ");
  });

  it("does not read the same file twice, but lets a cancelled one be sent again", async () => {
    before = { id: "old" };
    beforeEntries = 2;
    expect(textOf(await run())).toBe(PDF_ALREADY_TEXT);
    expect(read).not.toHaveBeenCalled();
    beforeEntries = 0;
    await run();
    expect(deletedImports).toEqual(["old"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stops at the monthly quota (Pro 5, Elite 15)", async () => {
    usageLeft = 0;
    expect(textOf(await run())).toBe(pdfQuotaText("plus", 5));
    plan = "ultimate";
    usageLeft = 0;
    expect(textOf(await run())).toBe(pdfQuotaText("ultimate", 15));
    expect(read).not.toHaveBeenCalled();
  });
});
