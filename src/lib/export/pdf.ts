import PDFDocument from "pdfkit";
import { hasGroup, type ColumnGroup } from "./columns";
import { NOTO_SANS_THAI_BOLD_BASE64, NOTO_SANS_THAI_REGULAR_BASE64 } from "./font-data";
import { TYPE_LABEL, exportDate, exportTime, sourceLabel, type ExportRow } from "./rows";
import { summarizeByCategory } from "./summary";
import { currencySymbol, currencyUnit } from "@/lib/money";

/** The most rows the table prints; the totals always cover every row. */
export const MAX_PDF_ROWS = 2000;

const OLIVE = "#23734E";
const OLIVE_SOFT = "#DDF3E5";
const EXPENSE = "#B94630";
const INCOME = "#2A7A52";
const INK = "#1F2617";
const MUTED = "#6B6F63";
const LINE = "#E7E2D6";

let fonts: { regular: Buffer; bold: Buffer } | null = null;
/** Noto Sans Thai (OFL): the standard PDF fonts have no Thai letters. */
function loadFonts() {
  fonts ??= {
    regular: Buffer.from(NOTO_SANS_THAI_REGULAR_BASE64, "base64"),
    bold: Buffer.from(NOTO_SANS_THAI_BOLD_BASE64, "base64"),
  };
  return fonts;
}

const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

/** The longest start of `text` (whole letters, never half a Thai vowel mark) that fits, plus "…". */
function fit(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  const letters = Array.from(segmenter.segment(text), (g) => g.segment);
  let lo = 0;
  let hi = letters.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${letters.slice(0, mid).join("")}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${letters.slice(0, lo).join("")}…`;
}

/** One line of text in a box of `width`: cut with an ellipsis when too long, aligned by hand. */
function put(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  align: "left" | "right" | "center" = "left",
) {
  const shown = fit(doc, text, width);
  const w = doc.widthOfString(shown);
  const at = align === "right" ? x + width - w : align === "center" ? x + (width - w) / 2 : x;
  doc.text(shown, at, y, { lineBreak: false });
}

/** "1,234.50" from integer satang. */
const money = (satang: number) =>
  (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PdfOptions {
  /** Which columns of the table to print (all when omitted). */
  groups?: readonly ColumnGroup[];
  /** e.g. "1 ต.ค. 2569 – 31 ต.ค. 2569" or "ทุกช่วงเวลา". */
  periodLabel: string;
  /** Other filters in words, e.g. ["ประเภท: รายจ่าย", "หมวด: อาหาร"]. */
  notes?: string[];
  generatedAt: Date;
}

interface TableColumn {
  header: string;
  weight: number;
  align: "left" | "right";
  cell: (row: ExportRow) => string;
  color?: (row: ExportRow) => string;
}

function tableColumns(groups: readonly ColumnGroup[] | undefined): TableColumn[] {
  const cols: TableColumn[] = [];
  if (hasGroup(groups, "date")) {
    cols.push({
      header: "วันที่",
      weight: 1.5,
      align: "left",
      cell: (r) => `${exportDate(r.date)} ${exportTime(r.date)}`,
    });
  }
  if (hasGroup(groups, "type")) {
    cols.push({ header: "ประเภท", weight: 0.8, align: "left", cell: (r) => TYPE_LABEL[r.type] });
  }
  if (hasGroup(groups, "title")) {
    cols.push({ header: "ชื่อรายการ", weight: 2.6, align: "left", cell: (r) => r.title });
  }
  if (hasGroup(groups, "category")) {
    cols.push({
      header: "หมวด",
      weight: 1.4,
      align: "left",
      cell: (r) => r.categoryName ?? "ไม่ระบุหมวด",
    });
  }
  if (hasGroup(groups, "wallet")) {
    cols.push({ header: "กระเป๋า", weight: 1.2, align: "left", cell: (r) => r.walletName ?? "" });
  }
  if (hasGroup(groups, "source")) {
    cols.push({ header: "ที่มา", weight: 0.9, align: "left", cell: (r) => sourceLabel(r.source) });
  }
  if (hasGroup(groups, "amount")) {
    cols.push({
      header: `จำนวนเงิน (${currencyUnit()})`,
      weight: 1.4,
      align: "right",
      cell: (r) => `${r.type === "income" ? "+" : "-"}${money(r.amountSatang)}`,
      color: (r) => (r.type === "income" ? INCOME : EXPENSE),
    });
  }
  // a file with no printable column still gets the amounts: a table of nothing says nothing
  return cols.length > 0
    ? cols
    : [
        {
          header: `จำนวนเงิน (${currencyUnit()})`,
          weight: 1,
          align: "right",
          cell: (r) => `${r.type === "income" ? "+" : "-"}${money(r.amountSatang)}`,
        },
      ];
}

/**
 * A printable summary: totals, spending by category and the table of entries. Thai text needs an
 * embedded font, so the font files ship with the app.
 */
export async function buildPdf(rows: ExportRow[], options: PdfOptions): Promise<Buffer> {
  const { regular, bold } = loadFonts();
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    bufferPages: true,
    font: regular as unknown as string, // PDFKit takes a path or the font bytes
    info: { Title: "P'Hook", Author: "P'Hook" },
  });
  doc.registerFont("bold", bold);
  doc.registerFont("regular", regular);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const pageBottom = () => doc.page.height - doc.page.margins.bottom - 24;

  // ── header band
  doc.rect(0, 0, doc.page.width, 78).fill(OLIVE);
  doc.fillColor("#FFFFFF").font("bold").fontSize(20).text("รายงานรายรับ-รายจ่าย", left, 22, {
    lineBreak: false,
  });
  doc
    .font("regular")
    .fontSize(10)
    .fillColor("#E9EFE0")
    .text("พี่ฮูก (P'Hook)", left, 52, { lineBreak: false });
  doc.font("regular");

  // ── what the file covers
  let y = 92;
  doc.fillColor(MUTED).fontSize(9);
  const meta = [
    `ช่วงเวลา: ${options.periodLabel}`,
    ...(options.notes ?? []),
    `สร้างเมื่อ: ${exportDate(options.generatedAt)} ${exportTime(options.generatedAt)}`,
  ];
  for (const line of meta) {
    put(doc, line, left, y, width);
    y += 13;
  }
  y += 6;

  // ── totals
  const income = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amountSatang, 0);
  const expense = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amountSatang, 0);
  const net = income - expense;
  const boxW = (width - 20) / 3;
  const boxes: [string, string, string][] = [
    ["รายรับ", `${currencySymbol()}${money(income)}`, INCOME],
    ["รายจ่าย", `${currencySymbol()}${money(expense)}`, EXPENSE],
    [
      "คงเหลือ",
      `${net < 0 ? "-" : ""}${currencySymbol()}${money(Math.abs(net))}`,
      net < 0 ? EXPENSE : OLIVE,
    ],
  ];
  boxes.forEach(([label, value, color], i) => {
    const x = left + i * (boxW + 10);
    doc.roundedRect(x, y, boxW, 50, 8).fill(OLIVE_SOFT);
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(label, x + 10, y + 8, { lineBreak: false });
    doc
      .fillColor(color)
      .font("bold")
      .fontSize(14)
      .text(value, x + 10, y + 24, {
        width: boxW - 20,
        lineBreak: false,
        ellipsis: true,
      });
    doc.font("regular");
  });
  y += 66;

  // ── spending by category
  const spend = summarizeByCategory(rows)
    .filter((c) => c.type === "expense")
    .slice(0, 8);
  if (spend.length > 0) {
    doc
      .fillColor(INK)
      .font("bold")
      .fontSize(12)
      .text("รายจ่ายตามหมวด", left, y, { lineBreak: false });
    doc.font("regular");
    y += 20;
    const top = spend[0]?.totalSatang ?? 1;
    for (const c of spend) {
      const pct = expense > 0 ? Math.round((c.totalSatang * 1000) / expense) / 10 : 0;
      doc.fillColor(INK).fontSize(9);
      put(doc, c.categoryName, left, y, 150);
      doc.roundedRect(left + 160, y + 3, 190, 7, 3.5).fill(LINE);
      doc
        .roundedRect(left + 160, y + 3, Math.max(4, (190 * c.totalSatang) / top), 7, 3.5)
        .fill(OLIVE);
      doc.fillColor(INK);
      put(doc, `${currencySymbol()}${money(c.totalSatang)}`, left + 360, y, 90, "right");
      doc.fillColor(MUTED);
      put(doc, `${pct}%`, left + 455, y, width - 455, "right");
      y += 17;
    }
    y += 10;
  }

  // ── the entries
  const cols = tableColumns(options.groups);
  const totalWeight = cols.reduce((s, c) => s + c.weight, 0);
  const widths = cols.map((c) => (width * c.weight) / totalWeight);
  const rowH = 19;

  const drawHeader = () => {
    doc.rect(left, y, width, rowH).fill(OLIVE_SOFT);
    let x = left;
    cols.forEach((c, i) => {
      doc
        .fillColor(OLIVE)
        .font("bold")
        .fontSize(8.5)
        .text(c.header, x + 4, y + 5, {
          width: (widths[i] ?? 0) - 8,
          align: c.align,
          lineBreak: false,
          ellipsis: true,
        });
      x += widths[i] ?? 0;
    });
    doc.font("regular");
    y += rowH;
  };

  doc.fillColor(INK).font("bold").fontSize(12);
  if (y + 60 > pageBottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.text("รายการทั้งหมด", left, y, { lineBreak: false });
  doc.font("regular");
  y += 20;
  drawHeader();

  const shown = rows.slice(0, MAX_PDF_ROWS);
  shown.forEach((row, n) => {
    if (y + rowH > pageBottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    if (n % 2 === 1) doc.rect(left, y, width, rowH).fill("#FAF9F6");
    let x = left;
    cols.forEach((c, i) => {
      doc.fillColor(c.color ? c.color(row) : INK).fontSize(8.5);
      put(doc, c.cell(row), x + 4, y + 5, (widths[i] ?? 0) - 8, c.align);
      x += widths[i] ?? 0;
    });
    y += rowH;
  });
  if (shown.length === 0) {
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text("ไม่มีรายการในช่วงนี้", left, y + 6, { lineBreak: false });
  }
  if (rows.length > shown.length) {
    if (y + 30 > pageBottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(
        `แสดง ${shown.length.toLocaleString("en-US")} รายการแรกจากทั้งหมด ${rows.length.toLocaleString("en-US")} รายการ (ยอดรวมด้านบนนับครบทุกรายการ) ดาวน์โหลดเป็น Excel เพื่อดูทั้งหมด`,
        left,
        y + 8,
        { width },
      );
  }

  // ── page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor(MUTED).fontSize(8);
    put(doc, `หน้า ${i + 1} / ${range.count}`, left, doc.page.height - 30, width, "center");
  }

  doc.end();
  return done;
}
