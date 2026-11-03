import { cycleRange, type DateRange } from "@/lib/budget-cycle";
import { crossedThreshold } from "@/lib/budget";
import { money } from "@/lib/money";
import { bangkokParts, fromBangkok } from "@/lib/thai-date";
import { balanceOf, type Wallet } from "@/lib/wallet";

export const isCardWallet = (w: Pick<Wallet, "kind">) => w.kind === "card";

/** The statement cycle containing `now`: starts on the statement day each month. */
export function statementCycle(now: Date, statementDay: number): DateRange {
  return cycleRange(now, "monthly", statementDay);
}

/** The cycle before the one containing `now`. */
export function previousStatementCycle(now: Date, statementDay: number): DateRange {
  const current = statementCycle(now, statementDay);
  return statementCycle(new Date(current.from.getTime() - 1), statementDay);
}

/** The next time `day` (1-28) comes around, today included. */
export function nextDayOfMonth(now: Date, day: number): Date {
  const p = bangkokParts(now);
  const thisMonth = fromBangkok(p.year, p.month, day);
  return p.day <= day ? thisMonth : fromBangkok(p.year, p.month + 1, day);
}

export interface CardStatus {
  /** What is owed on the card now (never negative; money paid in beyond that is not "owed"). */
  owedSatang: number;
  limitSatang: number | null;
  /** Limit minus owed; null without a limit. May be negative when over the limit. */
  availableSatang: number | null;
  /** owed / limit, whole percent (can exceed 100); null without a limit. */
  usedPercent: number | null;
  cycleSpentSatang: number;
  previousCycleSpentSatang: number;
  cycle: DateRange | null;
  nextStatement: Date | null;
  nextDue: Date | null;
}

export function cardStatus(
  w: Wallet,
  spent: { cycle: number; previous: number },
  now: Date,
): CardStatus {
  const owed = Math.max(0, -balanceOf(w));
  const limit = w.creditLimitSatang;
  return {
    owedSatang: owed,
    limitSatang: limit,
    availableSatang: limit === null ? null : limit - owed,
    usedPercent: limit === null || limit <= 0 ? null : Math.floor((owed * 100) / limit),
    cycleSpentSatang: spent.cycle,
    previousCycleSpentSatang: spent.previous,
    cycle: w.statementDay ? statementCycle(now, w.statementDay) : null,
    nextStatement: w.statementDay ? nextDayOfMonth(now, w.statementDay) : null,
    nextDue: w.dueDay ? nextDayOfMonth(now, w.dueDay) : null,
  };
}

/**
 * After spending `amountSatang` on a card: the warning when the amount owed crossed 80% or 100% of
 * the limit, null otherwise. `wallet` is the card as it is now, after the entry.
 */
export function limitAlert(wallet: Wallet, amountSatang: number): string | null {
  const limit = wallet.creditLimitSatang;
  if (!isCardWallet(wallet) || limit === null || amountSatang <= 0) return null;
  const owedAfter = Math.max(0, -balanceOf(wallet));
  const owedBefore = Math.max(0, -(balanceOf(wallet) + amountSatang));
  const level = crossedThreshold(owedBefore, owedAfter, limit);
  if (!level) return null;
  const figures = `ค้าง ${money(owedAfter)} จากวงเงิน ${money(limit)}`;
  return level === 100
    ? `บัตร ${wallet.name} เต็มวงเงินแล้ว (${figures})`
    : `บัตร ${wallet.name} ใช้วงเงินไปแล้ว 80% (${figures})`;
}

/** A card's status as the web app receives it (dates as ISO strings). */
export function cardStatusToDto(s: CardStatus) {
  return {
    owedSatang: s.owedSatang,
    limitSatang: s.limitSatang,
    availableSatang: s.availableSatang,
    usedPercent: s.usedPercent,
    cycleSpentSatang: s.cycleSpentSatang,
    previousCycleSpentSatang: s.previousCycleSpentSatang,
    nextStatement: s.nextStatement?.toISOString() ?? null,
    nextDue: s.nextDue?.toISOString() ?? null,
  };
}
