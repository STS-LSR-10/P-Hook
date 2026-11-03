import { money } from "@/lib/money";

export type AlertLevel = 80 | 100;

/** Percent of the budget used, rounded down; 0 when there is no (valid) budget. */
export function percentUsed(spentSatang: number, limitSatang: number): number {
  if (limitSatang <= 0 || spentSatang <= 0) return 0;
  return Math.floor((spentSatang * 100) / limitSatang);
}

/** Visual state of a progress bar. */
export function budgetState(spentSatang: number, limitSatang: number): "ok" | "warn" | "over" {
  const pct = percentUsed(spentSatang, limitSatang);
  if (pct >= 100) return "over";
  if (pct >= 80) return "warn";
  return "ok";
}

/**
 * Did this spend move the total across the 80% or 100% line?
 * Returns the highest line crossed, or null. Integer math only.
 */
export function crossedThreshold(
  beforeSatang: number,
  afterSatang: number,
  limitSatang: number,
): AlertLevel | null {
  if (limitSatang <= 0 || afterSatang <= beforeSatang) return null;
  const crossed = (pct: number) =>
    beforeSatang * 100 < limitSatang * pct && afterSatang * 100 >= limitSatang * pct;
  if (crossed(100)) return 100;
  if (crossed(80)) return 80;
  return null;
}

export function alertText(input: {
  level: AlertLevel;
  scopeName: string | null; // null = overall budget
  spentSatang: number;
  limitSatang: number;
}): string {
  const scope = input.scopeName ? `หมวด${input.scopeName}` : "รวม";
  const figures = `${money(input.spentSatang)} จาก ${money(input.limitSatang)}`;
  return input.level === 100
    ? `เกินงบ${scope}แล้ว (${figures})`
    : `งบ${scope}ใช้ไปแล้ว 80% (${figures})`;
}
