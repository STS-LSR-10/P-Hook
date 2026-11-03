import { columnIndexes, type ColumnGroup } from "./columns";
import { headers, rowCells, type ExportRow } from "./rows";

const BOM = "﻿"; // lets Excel open UTF-8 (Thai) correctly
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Besides RFC 4180 quoting, a cell that starts with = + - @ (or tab/CR) gets a
 * leading apostrophe so spreadsheet apps show it as text instead of running it as a formula
 * (CSV injection: a title like `=HYPERLINK(...)` typed by a user must stay inert).
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** `groups` keeps only those columns (all of them when omitted). */
export function toCsv(rows: ExportRow[], groups?: readonly ColumnGroup[]): string {
  const keep = columnIndexes(groups);
  const pick = (cells: readonly string[]) => keep.map((i) => cells[i] ?? "");
  const lines = [pick(headers()).map(csvCell).join(",")];
  for (const row of rows) lines.push(pick(rowCells(row)).map(csvCell).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}
