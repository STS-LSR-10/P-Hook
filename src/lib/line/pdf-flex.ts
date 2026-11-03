import { formatBaht, money } from "@/lib/money";
import type { LineMessage, TxType } from "@/lib/types";
import { bangkokParts } from "@/lib/thai-date";
import { COLOR } from "./flex";

export interface PdfCardEntry {
  type: TxType;
  title: string;
  amountSatang: number;
  occurredAt: Date;
}

export interface PdfCardInput {
  importId: string;
  entries: PdfCardEntry[];
  /** Entries left out because the same one is already in the book. */
  skippedDuplicates: number;
  /** Entries with no readable date (dated today). */
  undated: number;
  /** The file had more entries than were read. */
  truncated: boolean;
}

/** "a=pdfok&i=<uuid>" must fit LINE's 300-character postback limit (it does: ~50). */
const MAX_ROWS = 12;

const shortDate = (d: Date) => {
  const p = bangkokParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`;
};

const note = (text: string) => ({
  type: "text",
  text,
  size: "xs",
  color: COLOR.muted,
  wrap: true,
});

/**
 * "Did the AI read the file right?" card: every entry it found, the totals, and one button for all.
 * Nothing is recorded until the person taps "จดทั้งหมด" (the entries wait as pending).
 */
export function buildPdfCard(input: PdfCardInput): LineMessage {
  const sorted = [...input.entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const shown = sorted.slice(0, MAX_ROWS);
  const more = sorted.length - shown.length;
  const sum = (type: TxType) =>
    input.entries.filter((e) => e.type === type).reduce((n, e) => n + e.amountSatang, 0);
  const expenses = input.entries.filter((e) => e.type === "expense").length;
  const incomes = input.entries.length - expenses;

  const rows = shown.map((e) => ({
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "text", text: shortDate(e.occurredAt), size: "xs", color: COLOR.muted, flex: 0 },
      { type: "text", text: e.title, size: "sm", color: COLOR.text, flex: 1, wrap: false },
      {
        type: "text",
        text: `${e.type === "income" ? "+" : "-"}${formatBaht(e.amountSatang)}`,
        size: "sm",
        weight: "bold",
        align: "end",
        color: e.type === "income" ? COLOR.income : COLOR.expense,
        flex: 0,
      },
    ],
  }));

  const notes = [
    ...(more > 0 ? [note(`…และอีก ${more} รายการ`)] : []),
    ...(input.skippedDuplicates > 0
      ? [
          note(
            `ข้าม ${input.skippedDuplicates} รายการที่ตรงกับรายการที่จดไว้แล้ว (วันที่ ยอด ประเภทเท่ากัน) ถ้าไม่ซ้ำจริง พิมพ์จดเองได้เลย`,
          ),
        ]
      : []),
    ...(input.undated > 0
      ? [note(`${input.undated} รายการอ่านวันที่ไม่ได้ ใช้วันนี้แทน แก้ได้ที่หน้ารายการ`)]
      : []),
    ...(input.truncated
      ? [note("ไฟล์มีมากกว่า 30 รายการ อ่านให้ 30 รายการ ที่เหลือส่งแยกเป็นไฟล์เล็กลงนะ")]
      : []),
    note("AI อาจอ่านผิด ตรวจก่อนจดนะ ยกเลิกได้ทั้งชุด หรือจดแล้วแก้ทีหลัง"),
  ];

  return {
    type: "flex",
    altText: `ตรวจรายการจากไฟล์ PDF: ${input.entries.length} รายการ`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: "ตรวจรายการจากไฟล์ PDF — ยังไม่ได้จด",
            weight: "bold",
            color: COLOR.primary,
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "12px",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: `พบ ${input.entries.length} รายการ`,
            weight: "bold",
            size: "md",
            color: COLOR.text,
          },
          {
            type: "text",
            text: `รายจ่าย ${expenses} · รายรับ ${incomes}`,
            size: "sm",
            color: COLOR.muted,
          },
          { type: "separator", margin: "sm" },
          ...rows,
          { type: "separator", margin: "sm" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: `รายจ่ายรวม -${money(sum("expense"))}`,
                size: "xs",
                color: COLOR.expense,
                flex: 1,
                wrap: true,
              },
              {
                type: "text",
                text: `รายรับรวม +${money(sum("income"))}`,
                size: "xs",
                color: COLOR.income,
                align: "end",
                flex: 1,
                wrap: true,
              },
            ],
          },
          ...notes,
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: COLOR.primary,
            action: {
              type: "postback",
              label: `จดทั้งหมด (${input.entries.length})`,
              data: `a=pdfok&i=${input.importId}`,
              displayText: "จดทั้งหมด",
            },
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "ยกเลิก",
              data: `a=pdfx&i=${input.importId}`,
              displayText: "ยกเลิก",
            },
          },
        ],
      },
    },
  };
}
