import type { SupabaseClient } from "@supabase/supabase-js";
import { alertText, budgetState, crossedThreshold } from "@/lib/budget";
import { cycleRange, dayRange } from "@/lib/budget-cycle";
import { dailyBudgetAlert } from "@/lib/daily-budget";
import { money, toSatang } from "@/lib/money";
import { bangkokDateKey } from "@/lib/points";
import { can } from "@/lib/plan";
import { budgetAlertLine, effectivePrefs } from "@/lib/personalize";
import { getPlanInfo } from "@/lib/plan-server";
import {
  expenseTotalSatang,
  getBudgetMode,
  getSettings,
  loadBudgets,
  loadCategories,
} from "@/lib/repo";
import type { TxType } from "@/lib/types";

/** Where the person stands against the budget that applies to an entry (for the card's bar). */
export interface BudgetStatus {
  /** The category the budget is for, or null for the overall budget. */
  scopeName: string | null;
  spentSatang: number;
  limitSatang: number;
  level: "ok" | "warn" | "over";
}

export interface BudgetReading {
  status: BudgetStatus;
  /**
   * The 80% / 100% warning, in the person's chosen manner, when the spending just added crossed a
   * line (Pro and above; a lapsed plan stops them). Null otherwise.
   */
  notice: string | null;
}

/**
 * Where an expense that was just saved leaves the budget that applies to it (the overall budget or
 * the category's, by the person's budget mode), and the warning when it crossed 80% / 100%.
 * `amountSatang` is everything just added to that budget (several entries of one message count
 * together), so the warning is given once. Null when there is no budget, the entry is not an
 * expense, or it falls outside the current cycle. Best effort: callers treat failures as "none".
 */
export async function budgetReadingFor(
  db: SupabaseClient,
  input: {
    userId: string;
    type: TxType;
    categoryId: string | null;
    amountSatang: number;
    occurredAt: Date;
    now: Date;
  },
): Promise<BudgetReading | null> {
  if (input.type !== "expense") return null;
  const { plan } = await getPlanInfo(db, input.userId, input.now);

  const [settings, mode, budgets] = await Promise.all([
    getSettings(db, input.userId),
    getBudgetMode(db, input.userId),
    loadBudgets(db, input.userId),
  ]);
  const range = cycleRange(input.now, settings.budget_cycle, settings.cycle_start_day);
  // An entry dated outside the current cycle does not affect this cycle's budget.
  if (input.occurredAt < range.from || input.occurredAt >= range.to) return null;

  const wantsCategory = mode === "category";
  if (wantsCategory && !input.categoryId) return null;
  const budget = budgets.find((b) =>
    wantsCategory ? b.category_id === input.categoryId : b.category_id === null,
  );
  if (!budget) return null;

  const limit = toSatang(budget.amount);
  if (limit <= 0) return null;
  const after = await expenseTotalSatang(db, {
    userId: input.userId,
    from: range.from,
    to: range.to,
    categoryId: wantsCategory ? (input.categoryId ?? undefined) : undefined,
  });

  let scopeName: string | null = null;
  if (wantsCategory) {
    const categories = await loadCategories(db, input.userId);
    scopeName = categories.find((c) => c.id === input.categoryId)?.name ?? null;
  }
  const status: BudgetStatus = {
    scopeName,
    spentSatang: after,
    limitSatang: limit,
    level: budgetState(after, limit),
  };

  // 80% / 100% warnings are for Pro and above
  const level = can(plan, "budgetAlert")
    ? crossedThreshold(after - input.amountSatang, after, limit)
    : null;
  if (!level) return { status, notice: null };
  const { persona, name } = effectivePrefs(plan, settings);
  const custom = budgetAlertLine(
    persona,
    {
      level,
      scope: scopeName ? `หมวด${scopeName}` : "รวม",
      figures: `${money(after)} จาก ${money(limit)}`,
    },
    undefined,
    name,
  );
  return {
    status,
    notice: custom ?? alertText({ level, scopeName, spentSatang: after, limitSatang: limit }),
  };
}

/**
 * After an expense is saved, return alert texts when it pushed the budget across 80% / 100%
 * (for the chat styles that have no card to carry the warning). Best effort: callers should
 * treat failures as "no alert".
 */
export async function budgetAlertsFor(
  db: SupabaseClient,
  input: {
    userId: string;
    type: TxType;
    categoryId: string | null;
    amountSatang: number;
    occurredAt: Date;
    now: Date;
  },
): Promise<string[]> {
  const reading = await budgetReadingFor(db, input);
  return reading?.notice ? [reading.notice] : [];
}

/**
 * After expenses were saved: the scold when today's spending went over the daily limit (Pro
 * and above). `amountSatang` is everything just added to today, so several entries from one message
 * give one warning. Entries dated on another day are not today's business. Best effort like the
 * budget alerts.
 */
export async function dailyBudgetAlertsFor(
  db: SupabaseClient,
  input: { userId: string; amountSatang: number; occurredAt: Date; now: Date; pick?: number },
): Promise<string[]> {
  if (input.amountSatang <= 0) return [];
  if (bangkokDateKey(input.occurredAt) !== bangkokDateKey(input.now)) return [];
  const { plan } = await getPlanInfo(db, input.userId, input.now);
  if (!can(plan, "dailyBudget")) return [];

  const settings = await getSettings(db, input.userId);
  if (settings.daily_budget === null || settings.daily_budget === undefined) return [];
  const limit = toSatang(settings.daily_budget);

  const range = dayRange(input.now);
  const after = await expenseTotalSatang(db, {
    userId: input.userId,
    from: range.from,
    to: range.to,
  });
  const alert = dailyBudgetAlert({
    beforeSatang: after - input.amountSatang,
    afterSatang: after,
    limitSatang: limit,
    pick: input.pick,
    persona: effectivePrefs(plan, settings).persona,
    name: effectivePrefs(plan, settings).name,
  });
  return alert ? [alert] : [];
}
