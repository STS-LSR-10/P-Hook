import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { cycleRange, dayRange } from "@/lib/budget-cycle";
import { FIRST_BUDGET_BONUS } from "@/lib/config";
import { awardOnce } from "@/lib/points";
import { satangToString, toSatang } from "@/lib/money";
import {
  expenseTotalSatang,
  getBudgetMode,
  getSettings,
  loadBudgets,
  loadCategories,
  setBudget,
} from "@/lib/repo";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SpendRow {
  category_id: string | null;
  total: number | string;
}

/** GET /api/budgets — mode, overall budget and per-category budgets with this cycle's spending. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const settings = await getSettings(db, auth.userId);
    const range = cycleRange(new Date(), settings.budget_cycle, settings.cycle_start_day);
    const today = dayRange(new Date());

    const [mode, budgets, categories, spend, spentToday, incomeSpend] = await Promise.all([
      getBudgetMode(db, auth.userId),
      loadBudgets(db, auth.userId),
      loadCategories(db, auth.userId),
      db.rpc("spend_by_category", {
        p_user: auth.userId,
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
        p_type: "expense",
      }),
      expenseTotalSatang(db, { userId: auth.userId, from: today.from, to: today.to }),
      // what came in this cycle, per income category (the income tab of the page)
      db.rpc("spend_by_category", {
        p_user: auth.userId,
        p_from: range.from.toISOString(),
        p_to: range.to.toISOString(),
        p_type: "income",
      }),
    ]);
    if (spend.error) throw new Error(`spend: ${spend.error.message}`);
    if (incomeSpend.error) throw new Error(`income: ${incomeSpend.error.message}`);

    const spentBy = new Map<string | null, number>();
    let overallSpent = 0;
    for (const row of (spend.data ?? []) as SpendRow[]) {
      const total = toSatang(row.total);
      spentBy.set(row.category_id, total);
      overallSpent += total;
    }
    const budgetBy = new Map(budgets.map((b) => [b.category_id, toSatang(b.amount)]));

    return json({
      mode,
      cycle: settings.budget_cycle,
      cycleStartDay: settings.cycle_start_day,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      overall: { amountSatang: budgetBy.get(null) ?? null, spentSatang: overallSpent },
      daily: {
        amountSatang:
          settings.daily_budget === null || settings.daily_budget === undefined
            ? null
            : toSatang(settings.daily_budget),
        spentSatang: spentToday,
      },
      income: ((incomeSpend.data ?? []) as SpendRow[])
        .filter((r) => r.category_id !== null)
        .map((r) => ({ categoryId: r.category_id as string, receivedSatang: toSatang(r.total) })),
      categories: categories
        .filter((c) => c.type === "expense" && !c.is_hidden)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({
          categoryId: c.id,
          name: c.name,
          color: c.color,
          amountSatang: budgetBy.get(c.id) ?? null,
          spentSatang: spentBy.get(c.id) ?? 0,
        })),
    });
  });
}

const amountSchema = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,2})?$/)
  .nullable();

const putSchema = z.object({
  mode: z.enum(["overall", "category"]).optional(),
  overall: amountSchema.optional(),
  /** Limit for one day, all categories together; null clears it. */
  daily: amountSchema.optional(),
  categories: z
    .array(z.object({ categoryId: z.string().uuid(), amount: amountSchema }))
    .max(100)
    .optional(),
});

function toBudgetSatang(amount: string | null | undefined): number | null | undefined {
  if (amount === undefined) return undefined;
  if (amount === null) return null;
  const satang = toSatang(amount);
  return satang > 0 ? satang : null; // "0" clears the budget
}

/** PUT /api/budgets — partial update: mode, overall amount, per-category amounts (null clears). */
export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = putSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 5000 หรือ 5000.50)", 400);
    const body = parsed.data;

    const db = getAdminClient();
    // Per-category budgets are for Pro and above. Clearing one and going back to the
    // overall budget stay open to everyone (a lapsed plan keeps its data, read only).
    const setsCategoryBudget =
      body.mode === "category" || (body.categories ?? []).some((c) => c.amount !== null);
    if (setsCategoryBudget) {
      const locked = await requireFeature(db, auth.userId, "categoryBudget");
      if (locked) return locked;
    }
    // The daily limit is for Pro and above (clearing it is open to everyone).
    const daily = toBudgetSatang(body.daily);
    if (daily !== undefined && daily !== null) {
      const locked = await requireFeature(db, auth.userId, "dailyBudget");
      if (locked) return locked;
    }
    const settings = await getSettings(db, auth.userId);

    if (body.categories?.length) {
      const allowed = new Set(
        (await loadCategories(db, auth.userId))
          .filter((c) => c.type === "expense")
          .map((c) => c.id),
      );
      if (body.categories.some((c) => !allowed.has(c.categoryId))) {
        return apiError("งบตั้งได้เฉพาะหมวดรายจ่ายนะ", 400);
      }
    }

    if (body.mode) {
      const { error } = await db
        .from("user_settings")
        .upsert({ user_id: auth.userId, budget_mode: body.mode }, { onConflict: "user_id" });
      if (error) throw new Error(`save mode: ${error.message}`);
    }

    if (daily !== undefined) {
      const { error } = await db.from("user_settings").upsert(
        {
          user_id: auth.userId,
          daily_budget: daily === null ? null : satangToString(daily),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`save daily budget: ${error.message}`);
    }

    const overall = toBudgetSatang(body.overall);
    if (overall !== undefined) {
      await setBudget(db, {
        userId: auth.userId,
        categoryId: null,
        amountSatang: overall,
        cycle: settings.budget_cycle,
      });
    }
    for (const c of body.categories ?? []) {
      await setBudget(db, {
        userId: auth.userId,
        categoryId: c.categoryId,
        amountSatang: toBudgetSatang(c.amount) ?? null,
        cycle: settings.budget_cycle,
      });
    }
    // the first budget ever set pays a one-time bonus (once per account)
    const setsAnAmount =
      (overall !== undefined && overall !== null && overall > 0) ||
      (body.categories ?? []).some((c) => (toBudgetSatang(c.amount) ?? 0) > 0);
    const coins =
      setsAnAmount && (await awardOnce(db, auth.userId, "first_budget", FIRST_BUDGET_BONUS))
        ? FIRST_BUDGET_BONUS
        : 0;
    return json({ ok: true, coins });
  });
}
