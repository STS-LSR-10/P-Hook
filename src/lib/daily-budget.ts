import { currencySymbol, formatBaht, money } from "@/lib/money";
import { dailyOverLines, dailyStillOverLine, type PersonaId } from "@/lib/personalize";

/** The playful scolds sent the first time a day's spending goes over the daily limit. */
const SCOLDS: ((v: { spent: string; limit: string; over: string }) => string)[] = [
  (v) =>
    `เกินงบวันนี้แล้วนะ! ใช้ไป ${currencySymbol()}${v.spent} จาก ${currencySymbol()}${v.limit} (เกิน ${currencySymbol()}${v.over})`,
  (v) =>
    `เบรกหน่อยนะ กระเป๋าสั่นแล้ว 😅 วันนี้ใช้ไป ${currencySymbol()}${v.spent} เกินงบ ${currencySymbol()}${v.over}`,
  (v) =>
    `ว้าย! วันนี้รูดเกินงบ ${currencySymbol()}${v.over} แล้ว (${currencySymbol()}${v.spent} จาก ${currencySymbol()}${v.limit}) พรุ่งนี้มาตั้งหลักกันใหม่นะ`,
  (v) =>
    `ใจเย็น ๆ ก่อนนะ งบวันนี้ ${currencySymbol()}${v.limit} หมดไปแล้ว ตอนนี้เกินมา ${currencySymbol()}${v.over}`,
  (v) =>
    `ติ๊ด ติ๊ด! เกินงบประจำวัน ${currencySymbol()}${v.over} (ใช้ไป ${currencySymbol()}${v.spent}) ขอกอดกระเป๋าตังค์หน่อย 🫶`,
];

export const SCOLD_COUNT = SCOLDS.length;

/**
 * The warning after spending that took the day's total from `beforeSatang` to `afterSatang` against
 * a daily limit. Going over the limit for the first time gives a full playful scold (the one picked
 * by `pick`, 0..1); more spending while already over gives one short line; anything else, null.
 */
export function dailyBudgetAlert(input: {
  beforeSatang: number;
  afterSatang: number;
  limitSatang: number;
  pick?: number;
  /** The bot's manner; the original playful lines when omitted or plain. */
  persona?: PersonaId;
  /** The name the person asked to be called. */
  name?: string | null;
}): string | null {
  const { beforeSatang, afterSatang, limitSatang } = input;
  if (limitSatang <= 0 || afterSatang <= beforeSatang || afterSatang <= limitSatang) return null;
  const over = formatBaht(afterSatang - limitSatang);
  const persona = input.persona ?? "plain";
  if (beforeSatang > limitSatang) return dailyStillOverLine(persona, over, input.name);
  const lines = dailyOverLines(persona) ?? SCOLDS;
  const i = Math.min(lines.length - 1, Math.floor((input.pick ?? Math.random()) * lines.length));
  const scold = lines[i];
  return scold
    ? scold({
        spent: formatBaht(afterSatang),
        limit: formatBaht(limitSatang),
        over,
        name: input.name,
      })
    : null;
}

/** "วันนี้ใช้ไป ฿320 จาก ฿500 (64%) · เหลือ ฿180" for the status command. */
export function dailyBudgetStatus(spentSatang: number, limitSatang: number): string {
  const percent = Math.floor((spentSatang * 100) / limitSatang);
  const left = limitSatang - spentSatang;
  return [
    `งบวันนี้ ${money(limitSatang)}`,
    `ใช้ไป ${money(spentSatang)} (${percent}%)`,
    left >= 0 ? `เหลือ ${money(left)}` : `เกินมา ${money(-left)}`,
  ].join(" · ");
}
