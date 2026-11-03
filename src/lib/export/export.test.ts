import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { collectAttachments, buildZip, safeName } from "./attachments";
import { columnIndexes } from "./columns";
import { csvCell, toCsv } from "./csv";
import { buildPdf, MAX_PDF_ROWS } from "./pdf";
import { exportDate, exportTime, headers, rowCells, type ExportRow } from "./rows";
import { summarizeByCategory, summarizeByMonth } from "./summary";
import { buildXlsx } from "./xlsx";

const row = (p: Partial<ExportRow> = {}): ExportRow => ({
  date: new Date("2026-10-15T07:30:00Z"), // 14:30 Bangkok
  type: "expense",
  title: "กาแฟ",
  categoryName: "อาหาร",
  amountSatang: 3050,
  source: "text",
  ...p,
});

describe("rows", () => {
  it("formats date and time in Bangkok time", () => {
    const d = new Date("2026-10-15T17:30:00Z"); // already 16 Oct 00:30 in Bangkok
    expect(exportDate(d)).toBe("2026-10-16");
    expect(exportTime(d)).toBe("00:30");
  });
});

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
  ])("quotes %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it.each(["=SUM(A1:A9)", "+1", "-1", "@cmd", "\tx"])(
    "neutralises a formula start: %j",
    (input) => {
      expect(csvCell(input).startsWith("'") || csvCell(input).startsWith(`"'`)).toBe(true);
    },
  );
});

describe("toCsv", () => {
  it("starts with a BOM, uses CRLF and a Thai header", () => {
    const csv = toCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "วันที่,เวลา,ประเภท,ชื่อรายการ,หมวด,จำนวนเงิน (บาท),ที่มา,กระเป๋า,สกุลเงินเดิม,ยอดเดิม,อัตราแลกเปลี่ยน",
    );
    expect(lines[1]).toBe("2026-10-15,14:30,รายจ่าย,กาแฟ,อาหาร,30.50,ข้อความ,,,,"); // wallet and currency unknown: empty cells
    expect(lines[2]).toBe("");
  });

  it("keeps amounts exact and handles empty input", () => {
    expect(toCsv([row({ amountSatang: 7 })])).toContain(",0.07,");
    expect(toCsv([]).split("\r\n").filter(Boolean)).toHaveLength(1);
  });

  it("does not let a hostile title run as a formula", () => {
    const csv = toCsv([row({ title: '=HYPERLINK("http://evil","x")' })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
});

describe("summaries", () => {
  const rows = [
    row({ amountSatang: 10_000, categoryName: "อาหาร" }),
    row({ amountSatang: 5050, categoryName: "อาหาร" }),
    row({ amountSatang: 90_000, categoryName: "เดินทาง" }),
    row({ type: "income", amountSatang: 2_000_000, categoryName: "เงินเดือน" }),
    row({ amountSatang: 1000, categoryName: null, date: new Date("2026-09-30T08:00:00Z") }),
  ];

  it("by category: exact totals, biggest first within a type", () => {
    const s = summarizeByCategory(rows);
    const expenses = s.filter((c) => c.type === "expense");
    expect(expenses.map((c) => [c.categoryName, c.totalSatang, c.count])).toEqual([
      ["เดินทาง", 90_000, 1],
      ["อาหาร", 15_050, 2],
      ["ไม่ระบุหมวด", 1000, 1],
    ]);
    expect(s.find((c) => c.type === "income")?.totalSatang).toBe(2_000_000);
  });

  it("by month: oldest first with net", () => {
    const m = summarizeByMonth(rows);
    expect(m.map((x) => x.month)).toEqual(["2026-09", "2026-10"]);
    expect(m[1]).toMatchObject({
      incomeSatang: 2_000_000,
      expenseSatang: 105_050,
      netSatang: 1_894_950,
    });
  });
});

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe("buildXlsx: transfers", () => {
  const transfer = {
    id: "t1",
    fromId: "a",
    fromName: "เงินสด",
    toId: "b",
    toName: "KTC",
    amountSatang: 50000,
    occurredAt: "2026-10-10T05:00:00Z",
    note: null,
  };

  it("get their own sheet and are not in the list of entries", async () => {
    const wb = await read(await buildXlsx([row()], { advanced: false, transfers: [transfer] }));
    const sheet = wb.getWorksheet("โอนระหว่างกระเป๋า");
    expect(sheet?.getRow(2).getCell(3).value).toBe("เงินสด");
    expect(sheet?.getRow(2).getCell(5).value).toBe(500);
    expect(wb.getWorksheet("รายการ")?.rowCount).toBe(2);
  });

  it("no transfers, no sheet", async () => {
    const wb = await read(await buildXlsx([row()], { advanced: false, transfers: [] }));
    expect(wb.getWorksheet("โอนระหว่างกระเป๋า")).toBeUndefined();
  });
});

describe("buildXlsx", () => {
  it("free: one sheet with typed amounts", async () => {
    const wb = await read(await buildXlsx([row()], { advanced: false }));
    expect(wb.worksheets.map((s) => s.name)).toEqual(["รายการ"]);
    const sheet = wb.getWorksheet("รายการ");
    expect(sheet?.getRow(1).getCell(4).value).toBe("ชื่อรายการ");
    expect(sheet?.getRow(2).getCell(6).value).toBe(30.5);
    expect(sheet?.getRow(2).getCell(4).value).toBe("กาแฟ");
  });

  it("plus: adds category and month sheets", async () => {
    const wb = await read(await buildXlsx([row()], { advanced: true }));
    expect(wb.worksheets.map((s) => s.name)).toEqual(["รายการ", "สรุปตามหมวด", "สรุปรายเดือน"]);
    expect(wb.getWorksheet("สรุปรายเดือน")?.getRow(2).getCell(3).value).toBe(30.5);
  });

  it("stores a formula-looking title as plain text", async () => {
    const wb = await read(await buildXlsx([row({ title: "=1+1" })], { advanced: false }));
    const cell = wb.getWorksheet("รายการ")?.getRow(2).getCell(4);
    expect(cell?.value).toBe("=1+1");
    expect(cell?.type).toBe(ExcelJS.ValueType.String);
  });
});

describe("the wallet column", () => {
  it("is the eighth cell, empty when unknown, and the wallet's name when given", () => {
    const base = {
      date: new Date("2026-10-15T08:00:00Z"),
      type: "expense" as const,
      title: "x",
      categoryName: null,
      amountSatang: 100,
      source: "text",
    };
    expect(rowCells(base)[7]).toBe("");
    expect(rowCells({ ...base, walletName: "บัตรกสิกร" })[7]).toBe("บัตรกสิกร");
    expect(rowCells(base)).toHaveLength(headers().length);
  });
});

describe("the foreign-currency columns", () => {
  const base = {
    date: new Date("2026-10-15T08:00:00Z"),
    type: "expense" as const,
    title: "ราเมน",
    categoryName: null,
    amountSatang: 35025,
    source: "text",
  };

  it("are empty for a baht entry and filled for a converted one", () => {
    expect(rowCells(base).slice(-3)).toEqual(["", "", ""]);
    expect(
      rowCells({ ...base, origCurrency: "JPY", origAmountMinor: 150000, fxRate: 0.2335 }).slice(-3),
    ).toEqual(["JPY", "1500.00", "0.2335"]);
  });
});

describe("column groups", () => {
  it("keep the columns of the chosen groups, in the file's own order; none chosen means all", () => {
    expect(columnIndexes()).toHaveLength(headers().length);
    expect(columnIndexes([])).toHaveLength(headers().length);
    expect(columnIndexes(["amount", "date"]).map((i) => headers()[i])).toEqual([
      "วันที่",
      "เวลา",
      "จำนวนเงิน (บาท)",
    ]);
    expect(columnIndexes(["fx"]).map((i) => headers()[i])).toEqual([
      "สกุลเงินเดิม",
      "ยอดเดิม",
      "อัตราแลกเปลี่ยน",
    ]);
  });

  it("CSV and Excel carry only those columns", async () => {
    const csv = toCsv([row()], ["title", "amount"]).replace("\uFEFF", "").trim().split("\r\n");
    expect(csv).toEqual(["ชื่อรายการ,จำนวนเงิน (บาท)", "กาแฟ,30.50"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await buildXlsx([row()], { advanced: false, groups: ["title", "amount"] })) as never,
    );
    const sheet = wb.getWorksheet("รายการ");
    expect(sheet?.getRow(1).values).toEqual([undefined, "ชื่อรายการ", "จำนวนเงิน (บาท)"]);
    expect(sheet?.getRow(2).values).toEqual([undefined, "กาแฟ", 30.5]);
  });
});

describe("buildPdf", () => {
  const options = { periodLabel: "ทุกช่วงเวลา", generatedAt: new Date("2026-10-20T03:00:00Z") };
  const pages = (pdf: Uint8Array) =>
    (
      Buffer.from(pdf)
        .toString("latin1")
        .match(/\/Type \/Page\b/g) ?? []
    ).length;

  it("makes a PDF with Thai text, for few rows and for none", async () => {
    const rows = [row(), row({ type: "income", title: "เงินเดือน", amountSatang: 3_500_000 })];
    const pdf = await buildPdf(rows, options);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(pdf)).toBe(1);
    expect((await buildPdf([], options)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("goes on to more pages for many rows, and cuts the table at the limit", async () => {
    const many = Array.from({ length: 120 }, (_, i) => row({ title: `รายการ ${i}` }));
    expect(pages(await buildPdf(many, options))).toBeGreaterThan(1);
    const huge = Array.from({ length: MAX_PDF_ROWS + 10 }, () => row());
    expect((await buildPdf(huge, options)).byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it("works with any column choice", async () => {
    const pdf = await buildPdf([row()], { ...options, groups: ["fx"] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("attachments", () => {
  it("safeName keeps Thai and drops what file systems refuse", () => {
    expect(safeName('ข้าว/น้ำ: "พิเศษ"?')).toBe("ข้าว_น้ำ_ _พิเศษ__");
    expect(safeName("   ")).toBe("รายการ");
    expect(Array.from(safeName("ก".repeat(100)))).toHaveLength(40);
  });

  it("buildZip: the file at the top, numbered pictures in a folder, a note when some were left out", () => {
    const zip = buildZip(
      { name: "jodtang.csv", data: new TextEncoder().encode("a,b") },
      [
        { name: "2026-10-15 1430 ก (สลิป).jpg", data: new Uint8Array([1, 2, 3]) },
        { name: "2026-10-15 1430 ก (สลิป).jpg", data: new Uint8Array([4, 5]) },
      ],
      3,
    );
    const names = Object.keys(unzipSync(zip));
    expect(names).toContain("jodtang.csv");
    expect(names.filter((n) => n.startsWith("รูปสลิปและใบเสร็จ/"))).toHaveLength(2); // same name twice, both kept
    expect(names).toContain("อ่านก่อน.txt");
  });

  it("collectAttachments: finds slip pictures by id and photos by path, skips what will not fit or fails", async () => {
    const files: Record<string, Uint8Array> = {
      "u/slip-1.jpg": new Uint8Array(10),
      "u/photo-1.png": new Uint8Array(10),
      "u/photo-big.jpg": new Uint8Array(100),
    };
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({ data: [{ id: "s1", storage_path: "u/slip-1.jpg" }], error: null }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          download: async (path: string) =>
            files[path]
              ? { data: new Blob([files[path] as Uint8Array<ArrayBuffer>]), error: null }
              : { data: null, error: { message: "gone" } },
        }),
      },
    };
    const when = new Date("2026-10-15T07:30:00Z");
    const sources = [
      { date: when, title: "ข้าว", slipId: "s1", photoPath: "u/photo-1.png" },
      { date: when, title: "ใหญ่", slipId: null, photoPath: "u/photo-big.jpg" },
      { date: when, title: "หาย", slipId: null, photoPath: "u/missing.jpg" },
    ];
    const out = await collectAttachments(db as never, "u1", sources, {
      maxFiles: 10,
      maxBytes: 50,
    });
    expect(out.files.map((f) => f.name)).toEqual([
      "2026-10-15 1430 ข้าว (รูปแนบ).png",
      "2026-10-15 1430 ข้าว (สลิป).jpg",
    ]);
    expect(out.skipped).toBe(2); // one too big, one that could not be read
    const capped = await collectAttachments(db as never, "u1", sources, {
      maxFiles: 1,
      maxBytes: 1000,
    });
    expect(capped.files).toHaveLength(1);
    expect(capped.skipped).toBe(3); // two beyond the file limit + the missing one
  });
});
