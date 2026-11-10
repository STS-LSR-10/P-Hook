import { calendarMonthRange, cycleRange, dayRange, type DateRange } from "@/lib/budget-cycle";
import { guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { TX_SELECT, toTxDto } from "@/lib/dto";
import { toSatang } from "@/lib/money";
import { can } from "@/lib/plan";
import { getPlanInfo } from "@/lib/plan-server";
import { getBudgetMode, getSettings, loadBudgets, loadCategories, periodSummary } from "@/lib/repo";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_COUNT = 5;
/** How many budget cycles back the page may go. */
const MAX_BACK = 24;

/**
 * GET /api/summary?scope=cycle|month|day&offset=0|-1|-2…  (default: the current budget cycle)
 * `offset` steps back whole budget cycles (scope=cycle only). Besides the totals it carries the
 * balance kept up to the end of the period ("accumulated"), the budget set, and (Pro and
 * above) the spending by category, so the summary page needs one call.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const scope = new URL(request.url).searchParams.get("scope") ?? "cycle";
    const db = getAdminClient();
    const settings = await getSettings(db, auth.userId);
    const now = new Date();

    const rawOffset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    const offset = Number.isInteger(rawOffset) ? Math.min(0, Math.max(-MAX_BACK, rawOffset)) : 0;

    let range: DateRange =
      scope === "day"
        ? dayRange(now)
        : scope === "month"
          ? calendarMonthRange(now)
          : cycleRange(now, settings.budget_cycle, settings.cycle_start_day);
    if (scope === "cycle") {
      for (let i = 0; i > offset; i--) {
        range = cycleRange(
          new Date(range.from.getTime() - 1),
          settings.budget_cycle,
          settings.cycle_start_day,
        );
      }
    }

    const recentQuery = db
      .from("transactions")
      .select(TX_SELECT)
      .eq("user_id", auth.userId)
      .eq("status", "confirmed");
    const [totals, upToEnd, recent, { plan }, mode, budgets] = await Promise.all([
      periodSummary(db, { userId: auth.userId, from: range.from, to: range.to }),
      periodSummary(db, { userId: auth.userId, from: new Date(0), to: range.to }),
      // an earlier period shows what was recorded inside it
      (offset < 0
        ? recentQuery
            .gte("occurred_at", range.from.toISOString())
            .lt("occurred_at", range.to.toISOString())
        : recentQuery
      )
        .order("occurred_at", { ascending: false })
        .limit(RECENT_COUNT),
      getPlanInfo(db, auth.userId, now),
      getBudgetMode(db, auth.userId),
      loadBudgets(db, auth.userId),
    ]);
    if (recent.error) throw new Error(`recent: ${recent.error.message}`);

    // the budget the person set: the overall amount, or the sum of the category amounts
    const budgetSatang = (() => {
      const rows =
        mode === "overall"
          ? budgets.filter((b) => b.category_id === null)
          : budgets.filter((b) => b.category_id !== null);
      const total = rows.reduce((sum, b) => sum + toSatang(b.amount), 0);
      return total > 0 ? total : null;
    })();

    let categories:
      | {
          categoryId: string | null;
          name: string;
          color: string | null;
          icon: string | null;
          totalSatang: number;
        }[]
      | null = null;
    if (can(plan, "dashboard")) {
      const [spend, all] = await Promise.all([
        db.rpc("spend_by_category", {
          p_user: auth.userId,
          p_from: range.from.toISOString(),
          p_to: range.to.toISOString(),
          p_type: "expense",
        }),
        loadCategories(db, auth.userId),
      ]);
      if (spend.error) throw new Error(`spend: ${spend.error.message}`);
      const byId = new Map(all.map((c) => [c.id, c]));
      categories = ((spend.data ?? []) as { category_id: string | null; total: number | string }[])
        .map((r) => {
          const c = r.category_id ? byId.get(r.category_id) : undefined;
          return {
            categoryId: r.category_id,
            name: c?.name ?? "ไม่ระบุหมวด",
            color: c?.color ?? null,
            icon: c?.icon ?? null,
            totalSatang: toSatang(r.total),
          };
        })
        .filter((c) => c.totalSatang > 0)
        .sort((a, b) => b.totalSatang - a.totalSatang);
    }

    return json({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      cycle: settings.budget_cycle,
      incomeSatang: totals.incomeSatang,
      expenseSatang: totals.expenseSatang,
      balanceSatang: totals.incomeSatang - totals.expenseSatang,
      accumulatedSatang: upToEnd.incomeSatang - upToEnd.expenseSatang,
      count: totals.count,
      offset,
      budgetSatang,
      categories,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recent: (recent.data ?? []).map((r: any) => toTxDto(r)),
    });
  });
}
