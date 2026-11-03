import type { DateRange } from "@/lib/budget-cycle";
import { nextRunAfter, type Cadence } from "@/lib/recurring";
import { addLocalDays, bangkokParts, fromBangkok } from "@/lib/thai-date";

const DAY_MS = 86_400_000;
/** Fewer days or entries than this and the rate is a guess: the card says so. */
export const MIN_DAYS_FOR_RATE = 5;
export const MIN_ENTRIES_FOR_RATE = 5;
/** From this many days into the cycle the last seven days are shown as a second scenario. */
export const MIN_DAYS_FOR_TREND = 10;
const MAX_OCCURRENCES_PER_RULE = 62;

export interface RuleLite {
  type: "income" | "expense";
  amountSatang: number;
  title: string;
  cadence: Cadence;
  dayOfPeriod: number | null;
  nextRunAt: Date;
  isActive: boolean;
}

export interface Occurrence {
  /** Bangkok midnight of the day it happens. */
  date: Date;
  type: "income" | "expense";
  amountSatang: number;
  title: string;
}

/**
 * Runs of the active rules that are still to come before the cycle ends. A run already due (its
 * date is today or earlier but the cron has not written it yet) counts as today.
 */
export function upcomingOccurrences(rules: RuleLite[], now: Date, cycleTo: Date): Occurrence[] {
  const p = bangkokParts(now);
  const todayStart = fromBangkok(p.year, p.month, p.day);
  const out: Occurrence[] = [];
  for (const rule of rules) {
    if (!rule.isActive) continue;
    let cursor = rule.nextRunAt;
    for (let i = 0; i < MAX_OCCURRENCES_PER_RULE && cursor.getTime() < cycleTo.getTime(); i++) {
      out.push({
        date: cursor.getTime() < todayStart.getTime() ? todayStart : cursor,
        type: rule.type,
        amountSatang: rule.amountSatang,
        title: rule.title,
      });
      cursor = nextRunAfter(cursor, rule.cadence, rule.dayOfPeriod);
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export interface ForecastInput {
  now: Date;
  /** The budget cycle [from, to). */
  cycle: DateRange;
  /** Confirmed so far in the cycle. */
  incomeSatang: number;
  expenseSatang: number;
  /** The part of `expenseSatang` that recurring rules already booked. */
  recurringExpenseSatang: number;
  entryCount: number;
  /** Non-recurring spending of the last seven days, for the second scenario (null = unknown). */
  last7VariableSatang: number | null;
  upcoming: Occurrence[];
  /** The overall budget of the cycle, if the person set one. */
  budgetSatang: number | null;
}

export interface Scenario {
  dailyRateSatang: number;
  endBalanceSatang: number;
  /** First day the balance is projected to go below zero; null if it does not within the cycle. */
  runsOutOn: Date | null;
}

export interface BudgetForecast {
  limitSatang: number;
  projectedSpendSatang: number;
  percent: number;
  overNow: boolean;
  /** First day the spending is projected to reach the budget; null if it does not (or already has). */
  exhaustedOn: Date | null;
}

export interface Forecast extends Scenario {
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  /** Income minus expense so far in the cycle: what the app calls "เหลือ". */
  netNowSatang: number;
  variableSpentSatang: number;
  upcomingIncomeSatang: number;
  upcomingExpenseSatang: number;
  upcomingExpenses: Occurrence[];
  upcomingIncomes: Occurrence[];
  alreadyNegative: boolean;
  /** Too few days or entries for the rate to mean much. */
  lowData: boolean;
  /** The same projection at the pace of the last seven days (only from MIN_DAYS_FOR_TREND on). */
  trend: Scenario | null;
  budget: BudgetForecast | null;
}

function simulate(input: {
  start: Date;
  totalDays: number;
  elapsedDays: number;
  netNow: number;
  rate: number;
  upcoming: Occurrence[];
}): { endBalance: number; runsOutOn: Date | null } {
  let balance = input.netNow;
  let runsOutOn: Date | null = null;
  for (let day = input.elapsedDays - 1; day < input.totalDays; day++) {
    const date = addLocalDays(input.start, day);
    for (const o of input.upcoming) {
      if (o.date.getTime() === date.getTime()) {
        balance += o.type === "income" ? o.amountSatang : -o.amountSatang;
      }
    }
    // today's spending is already in netNow: only the days after it cost the daily rate
    if (day >= input.elapsedDays) balance -= input.rate;
    if (balance < 0 && runsOutOn === null && input.netNow >= 0) runsOutOn = date;
  }
  return { endBalance: balance, runsOutOn };
}

/** Where the cycle's money is heading, day by day. Integer satang throughout. */
export function forecastCycle(input: ForecastInput): Forecast {
  const { cycle, now } = input;
  const p = bangkokParts(now);
  const todayStart = fromBangkok(p.year, p.month, p.day);
  const totalDays = Math.max(1, Math.round((cycle.to.getTime() - cycle.from.getTime()) / DAY_MS));
  const elapsedDays = Math.min(
    totalDays,
    Math.max(1, Math.round((todayStart.getTime() - cycle.from.getTime()) / DAY_MS) + 1),
  );
  const remainingDays = totalDays - elapsedDays;

  const netNow = input.incomeSatang - input.expenseSatang;
  const variableSpent = Math.max(0, input.expenseSatang - input.recurringExpenseSatang);
  const rate = Math.round(variableSpent / elapsedDays);

  const upcoming = input.upcoming.filter((o) => o.date.getTime() < cycle.to.getTime());
  const upcomingIncomes = upcoming.filter((o) => o.type === "income");
  const upcomingExpenses = upcoming.filter((o) => o.type === "expense");
  const sum = (xs: Occurrence[]) => xs.reduce((s, o) => s + o.amountSatang, 0);

  const base = { start: cycle.from, totalDays, elapsedDays, netNow, upcoming };
  const main = simulate({ ...base, rate });

  let trend: Scenario | null = null;
  if (elapsedDays >= MIN_DAYS_FOR_TREND && input.last7VariableSatang !== null) {
    const trendRate = Math.round(input.last7VariableSatang / 7);
    const t = simulate({ ...base, rate: trendRate });
    trend = { dailyRateSatang: trendRate, endBalanceSatang: t.endBalance, runsOutOn: t.runsOutOn };
  }

  let budget: BudgetForecast | null = null;
  if (input.budgetSatang !== null && input.budgetSatang > 0) {
    const limit = input.budgetSatang;
    let spend = input.expenseSatang;
    let exhaustedOn: Date | null = null;
    const overNow = spend >= limit;
    for (let day = elapsedDays - 1; day < totalDays; day++) {
      const date = addLocalDays(cycle.from, day);
      for (const o of upcomingExpenses)
        if (o.date.getTime() === date.getTime()) spend += o.amountSatang;
      if (day >= elapsedDays) spend += rate;
      if (!overNow && exhaustedOn === null && spend >= limit) exhaustedOn = date;
    }
    budget = {
      limitSatang: limit,
      projectedSpendSatang: spend,
      percent: Math.round((spend * 100) / limit),
      overNow,
      exhaustedOn,
    };
  }

  return {
    totalDays,
    elapsedDays,
    remainingDays,
    netNowSatang: netNow,
    variableSpentSatang: variableSpent,
    dailyRateSatang: rate,
    upcomingIncomeSatang: sum(upcomingIncomes),
    upcomingExpenseSatang: sum(upcomingExpenses),
    upcomingExpenses,
    upcomingIncomes,
    endBalanceSatang: main.endBalance,
    runsOutOn: main.runsOutOn,
    alreadyNegative: netNow < 0,
    lowData: elapsedDays < MIN_DAYS_FOR_RATE || input.entryCount < MIN_ENTRIES_FOR_RATE,
    trend,
    budget,
  };
}
