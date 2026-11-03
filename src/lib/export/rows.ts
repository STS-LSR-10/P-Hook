import { currencyUnit, satangToString } from "@/lib/money";
import { bangkokParts } from "@/lib/thai-date";
import type { TxType } from "@/lib/types";

export interface ExportRow {
  date: Date;
  type: TxType;
  title: string;
  categoryName: string | null;
  /** Integer satang, always > 0. */
  amountSatang: number;
  source: string;
  /** The wallet's name (the main wallet's for entries that never had one). */
  walletName?: string | null;
  /** Foreign-currency entries: the code, the original amount (×100) and the rate used. */
  origCurrency?: string | null;
  origAmountMinor?: number | null;
  fxRate?: number | null;
}

export const TYPE_LABEL: Record<TxType, string> = { expense: "รายจ่าย", income: "รายรับ" };

const SOURCE_LABEL: Record<string, string> = {
  text: "ข้อความ",
  slip: "สลิป",
  manual: "เพิ่มเอง",
  recurring: "รายการประจำ",
  voice: "เสียง",
  pdf: "PDF",
};

export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? source;

const two = (n: number) => String(n).padStart(2, "0");

/** "2026-10-15" in Bangkok time (Gregorian, so spreadsheets sort and parse it). */
export function exportDate(date: Date): string {
  const p = bangkokParts(date);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** "14:30" in Bangkok time. */
export function exportTime(date: Date): string {
  const p = bangkokParts(date);
  return `${two(p.hour)}:${two(p.minute)}`;
}

/** The column names, the amount in the person's currency (so built per file, not once). */
export const headers = (): string[] => [
  "วันที่",
  "เวลา",
  "ประเภท",
  "ชื่อรายการ",
  "หมวด",
  `จำนวนเงิน (${currencyUnit()})`,
  "ที่มา",
  "กระเป๋า",
  "สกุลเงินเดิม",
  "ยอดเดิม",
  "อัตราแลกเปลี่ยน",
];

/** One row as display strings, in headers() order. */
export function rowCells(row: ExportRow): string[] {
  return [
    exportDate(row.date),
    exportTime(row.date),
    TYPE_LABEL[row.type],
    row.title,
    row.categoryName ?? "ไม่ระบุหมวด",
    satangToString(row.amountSatang),
    sourceLabel(row.source),
    row.walletName ?? "",
    row.origCurrency ?? "",
    row.origAmountMinor ? satangToString(row.origAmountMinor) : "",
    row.fxRate ? String(row.fxRate) : "",
  ];
}
