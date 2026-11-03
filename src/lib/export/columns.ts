import { headers } from "./rows";

/** What a person ticks in the export sheet; each group is one or more columns of the file. */
export const COLUMN_GROUPS = [
  "date",
  "title",
  "amount",
  "type",
  "category",
  "wallet",
  "source",
  "fx",
] as const;
export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

export const GROUP_LABEL: Record<ColumnGroup, string> = {
  date: "วันที่ & เวลา",
  title: "ชื่อรายการ",
  amount: "จำนวนเงิน",
  type: "ประเภท (รับ/จ่าย)",
  category: "หมวดหมู่",
  wallet: "กระเป๋า",
  source: "ที่มา (ข้อความ/สลิป)",
  fx: "สกุลเงินเดิม",
};

/** The group each column of HEADERS (same order) belongs to. */
const GROUP_OF_COLUMN: readonly ColumnGroup[] = [
  "date", // วันที่
  "date", // เวลา
  "type",
  "title",
  "category",
  "amount",
  "source",
  "wallet",
  "fx", // สกุลเงินเดิม
  "fx", // ยอดเดิม
  "fx", // อัตราแลกเปลี่ยน
];

/** Indexes into headers() / rowCells of the columns the chosen groups keep, in the file's own order. */
export function columnIndexes(groups?: readonly ColumnGroup[]): number[] {
  const wanted = new Set<ColumnGroup>(groups && groups.length > 0 ? groups : COLUMN_GROUPS);
  return headers()
    .map((_, i) => i)
    .filter((i) => wanted.has(GROUP_OF_COLUMN[i] as ColumnGroup));
}

export const hasGroup = (groups: readonly ColumnGroup[] | undefined, g: ColumnGroup): boolean =>
  !groups || groups.length === 0 || groups.includes(g);
