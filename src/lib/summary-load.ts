import type { SupabaseClient } from "@supabase/supabase-js";
import { toSatang } from "@/lib/money";
import { bangkokParts, currentZone, fromBangkok } from "@/lib/thai-date";
import type { YearResult } from "@/lib/year-summary";
import type { DateRange } from "@/lib/budget-cycle";
import type { ForecastInput, RuleLite } from "@/lib/forecast";
import { upcomingOccurrences } from "@/lib/forecast";
import {
  buildInsightFacts,
  buildTitleRows,
  type InsightFacts,
  type TitleSpend,
} from "@/lib/insight";
import { buildCompareRows, type CompareRow } from "@/lib/period-compare";
import { getBudgetMode, loadBudgets, periodSummary } from "@/lib/repo";
import { listRules } from "@/lib/recurring-repo";
import type { CategoryShare, SummaryData, SummaryTx } from "@/lib/summary-report";

const MAX_ROWS = 10_000;

/** Confirmed entries in [from, to) with their category names, for `summarize`. */
export async function loadSummaryTransactions(
  db: SupabaseClient,
  userId: string,
  from: Date,
  to: Date,
): Promise<SummaryTx[]> {
  const { data, error } = await db
    .from("transactions")
    .select("occurred_at,type,amount,categories(name)")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .gte("occurred_at", from.toISOString())
    .lt("occurred_at", to.toISOString())
    .limit(MAX_ROWS);
  if (error) throw new Error(`load summary rows: ${error.message}`);
  return (data ?? []).map((r) => {
    const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
    return {
      occurredAt: new Date(r.occurred_at as string),
      type: r.type as "income" | "expense",
      amountSatang: toSatang(r.amount as string | number),
      categoryName: (cat as { name?: string } | null)?.name ?? null,
    };
  });
}

interface CategorySpendRow {
  name: string;
  icon?: string | null;
  total: number | string;
}

/**
 * The same numbers as `summarize`, but added up by the database, so a long range is exact and
 * never cut off by a row limit: totals for `range` and `previous`, and the top expense categories
 * of `range`.
 */
export async function loadSummaryData(
  db: SupabaseClient,
  userId: string,
  range: DateRange,
  previous: DateRange,
): Promise<SummaryData> {
  const [current, before, categories] = await Promise.all([
    periodSummary(db, { userId, from: range.from, to: range.to }),
    periodSummary(db, { userId, from: previous.from, to: previous.to }),
    db.rpc("spend_by_category", {
      p_user: userId,
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_type: "expense",
    }),
  ]);
  if (categories.error) throw new Error(`load category totals: ${categories.error.message}`);

  const topExpenses: CategoryShare[] = ((categories.data ?? []) as CategorySpendRow[])
    .map((r) => ({ name: r.name, amountSatang: toSatang(r.total) }))
    .sort((a, b) => b.amountSatang - a.amountSatang)
    .slice(0, 3)
    .map((c) => ({
      ...c,
      percent:
        current.expenseSatang > 0 ? Math.round((c.amountSatang * 100) / current.expenseSatang) : 0,
    }));

  return {
    current: { income: current.incomeSatang, expense: current.expenseSatang, count: current.count },
    previous: { income: before.incomeSatang, expense: before.expenseSatang, count: before.count },
    topExpenses,
  };
}

/** Expense per category in [range.from, range.to), added up by the database, biggest first. */
export async function loadCategorySpend(
  db: SupabaseClient,
  userId: string,
  range: DateRange,
): Promise<{ name: string; amountSatang: number; icon: string | null }[]> {
  const { data, error } = await db.rpc("spend_by_category", {
    p_user: userId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_type: "expense",
  });
  if (error) throw new Error(`load category spend: ${error.message}`);
  return ((data ?? []) as CategorySpendRow[])
    .map((r) => ({ name: r.name, amountSatang: toSatang(r.total), icon: r.icon ?? null }))
    .sort((a, b) => b.amountSatang - a.amountSatang);
}

export interface MonthTotals {
  /** Start of the month (Bangkok). */
  month: Date;
  incomeSatang: number;
  expenseSatang: number;
}

export interface YearData {
  summary: SummaryData;
  months: MonthTotals[];
}

interface SeriesRow {
  bucket_start: string;
  income: number | string;
  expense: number | string;
}

/**
 * A calendar year, added up by the database: totals against the same days a year earlier, the three
 * biggest expense categories, and income/expense for each month of the year so far.
 */
export async function loadYearData(
  db: SupabaseClient,
  userId: string,
  year: Extract<YearResult, { ok: true }>,
): Promise<YearData> {
  const [summary, series] = await Promise.all([
    loadSummaryData(db, userId, year.range, year.previous),
    db.rpc("analytics_series", {
      p_user: userId,
      p_from: year.range.from.toISOString(),
      p_to: year.range.to.toISOString(),
      p_bucket: "month",
      p_tz: currentZone(),
    }),
  ]);
  if (series.error) throw new Error(`load monthly totals: ${series.error.message}`);

  const byMonth = new Map<number, SeriesRow>();
  for (const r of (series.data ?? []) as SeriesRow[]) {
    byMonth.set(bangkokParts(new Date(r.bucket_start)).month, r);
  }
  const months: MonthTotals[] = year.months.map((month) => {
    const row = byMonth.get(bangkokParts(month).month);
    return {
      month,
      incomeSatang: row ? toSatang(row.income) : 0,
      expenseSatang: row ? toSatang(row.expense) : 0,
    };
  });
  return { summary, months };
}

/** Expense per category on two spans, joined for the "เทียบเดือน" card. */
export async function loadCategoryCompare(
  db: SupabaseClient,
  userId: string,
  current: DateRange,
  previous: DateRange,
): Promise<{ rows: CompareRow[]; currentSatang: number; previousSatang: number }> {
  const [cur, prev] = await Promise.all([
    loadCategorySpend(db, userId, current),
    loadCategorySpend(db, userId, previous),
  ]);
  return {
    rows: buildCompareRows(cur, prev),
    currentSatang: cur.reduce((s, c) => s + c.amountSatang, 0),
    previousSatang: prev.reduce((s, c) => s + c.amountSatang, 0),
  };
}

interface SourceTotalsRow {
  income: number | string;
  expense: number | string;
  recurring_income: number | string;
  recurring_expense: number | string;
  tx_count: number | string;
}

async function totalsBySource(db: SupabaseClient, userId: string, range: DateRange) {
  const { data, error } = await db.rpc("period_totals_by_source", {
    p_user: userId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  if (error) throw new Error(`load totals by source: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as SourceTotalsRow | undefined;
  return {
    income: row ? toSatang(row.income) : 0,
    expense: row ? toSatang(row.expense) : 0,
    recurringExpense: row ? toSatang(row.recurring_expense) : 0,
    count: row ? Number(row.tx_count) : 0,
  };
}

/**
 * Everything `forecastCycle` needs about the cycle that contains `now`: what came in and went out
 * so far (and how much of it a recurring rule booked), the pace of the last seven days, the runs
 * of the recurring rules still to come, and the overall budget when the person budgets overall.
 */
export async function loadForecastInput(
  db: SupabaseClient,
  userId: string,
  now: Date,
  cycle: DateRange,
): Promise<ForecastInput> {
  const p = bangkokParts(now);
  const tomorrow = fromBangkok(p.year, p.month, p.day + 1);
  const weekAgo = fromBangkok(p.year, p.month, p.day - 6);
  const sevenFrom = new Date(Math.max(weekAgo.getTime(), cycle.from.getTime()));

  const [soFar, lastWeek, rules, mode, budgets] = await Promise.all([
    totalsBySource(db, userId, { from: cycle.from, to: tomorrow }),
    totalsBySource(db, userId, { from: sevenFrom, to: tomorrow }),
    listRules(db, userId),
    getBudgetMode(db, userId),
    loadBudgets(db, userId),
  ]);

  const lite: RuleLite[] = rules.map((r) => ({
    type: r.type,
    amountSatang: toSatang(r.amount),
    title: r.title,
    cadence: r.cadence,
    dayOfPeriod: r.day_of_period,
    nextRunAt: new Date(r.next_run_at),
    isActive: r.is_active,
  }));
  const overall = mode === "overall" ? budgets.find((b) => b.category_id === null) : undefined;

  return {
    now,
    cycle,
    incomeSatang: soFar.income,
    expenseSatang: soFar.expense,
    recurringExpenseSatang: soFar.recurringExpense,
    entryCount: soFar.count,
    // the window is shorter than seven days early in a cycle: scale it up so the pace is per week
    last7VariableSatang: Math.round(
      ((lastWeek.expense - lastWeek.recurringExpense) * 7) /
        Math.max(1, Math.round((tomorrow.getTime() - sevenFrom.getTime()) / 86_400_000)),
    ),
    upcoming: upcomingOccurrences(lite, now, cycle.to),
    budgetSatang: overall ? toSatang(overall.amount) : null,
  };
}

interface TitleRowDb {
  title: string;
  total: number | string;
  tx_count: number | string;
}

async function loadTopTitles(
  db: SupabaseClient,
  userId: string,
  range: DateRange,
): Promise<TitleSpend[]> {
  const { data, error } = await db.rpc("top_titles", {
    p_user: userId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_type: "expense",
    p_limit: 10,
  });
  if (error) throw new Error(`load top titles: ${error.message}`);
  return ((data ?? []) as TitleRowDb[]).map((r) => ({
    name: r.title,
    amountSatang: toSatang(r.total),
    count: Number(r.tx_count),
  }));
}

/**
 * Everything the AI Insight is told about a period: totals against the one before, the categories
 * and the most-used entry names with their change. All added up by the database.
 */
export async function loadInsightFacts(
  db: SupabaseClient,
  userId: string,
  current: DateRange,
  previous: DateRange,
  labels: { current: string; previous: string },
): Promise<InsightFacts> {
  const [cur, prev, compare, curTitles, prevTitles] = await Promise.all([
    periodSummary(db, { userId, from: current.from, to: current.to }),
    periodSummary(db, { userId, from: previous.from, to: previous.to }),
    loadCategoryCompare(db, userId, current, previous),
    loadTopTitles(db, userId, current),
    loadTopTitles(db, userId, previous),
  ]);
  return buildInsightFacts({
    periodLabel: labels.current,
    previousLabel: labels.previous,
    expenseSatang: cur.expenseSatang,
    previousExpenseSatang: prev.expenseSatang,
    incomeSatang: cur.incomeSatang,
    categories: compare.rows,
    titles: buildTitleRows(curTitles, prevTitles),
  });
}
