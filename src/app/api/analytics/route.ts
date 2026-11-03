import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { cycleRange } from "@/lib/budget-cycle";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { getSettings, loadCategories } from "@/lib/repo";
import { bucketStarts, fillSeries, type SeriesRow } from "@/lib/series";
import { getAdminClient } from "@/lib/supabase/admin";
import { currentZone } from "@/lib/thai-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  view: z.enum(["month", "week", "day"]).default("month"),
  scope: z.enum(["cycle", "all"]).default("cycle"),
  /** 0 = the latest stretch; -1 = the one before it, and so on (up to two years back). */
  offset: z.coerce.number().int().min(-12).max(0).default(0),
});

interface CategorySpendRow {
  category_id: string | null;
  name: string;
  color: string | null;
  total: number | string;
}

/**
 * GET /api/analytics?view=month|week|day&scope=cycle|all&offset=0|-1…
 * - series: income/expense per bucket (6 months, 8 weeks or 14 days)
 * - categories: expense share by category (current budget cycle, or all time)
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    // The charts are a Pro feature (Free reads the summaries in the chat instead).
    const locked = await requireFeature(getAdminClient(), auth.userId, "dashboard");
    if (locked) return locked;

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return apiError("ตัวเลือกไม่ถูกต้อง", 400);
    const { view, scope, offset } = parsed.data;

    const db = getAdminClient();
    const now = new Date();
    const { starts, to } = bucketStarts(now, view, offset);
    const first = starts[0];
    if (!first) throw new Error("empty bucket list");

    const settings = await getSettings(db, auth.userId);
    const cycle = cycleRange(now, settings.budget_cycle, settings.cycle_start_day);
    const catFrom = scope === "cycle" ? cycle.from : new Date(0);
    const catTo = scope === "cycle" ? cycle.to : new Date("2100-01-01T00:00:00Z");

    const [seriesRes, catRes, allCategories] = await Promise.all([
      db.rpc("analytics_series", {
        p_user: auth.userId,
        p_from: first.toISOString(),
        p_to: to.toISOString(),
        p_bucket: view,
        // buckets in the zone this request counts in (the session's), so they line up
        p_tz: currentZone(),
      }),
      db.rpc("spend_by_category", {
        p_user: auth.userId,
        p_from: catFrom.toISOString(),
        p_to: catTo.toISOString(),
        p_type: "expense",
      }),
      loadCategories(db, auth.userId),
    ]);
    if (seriesRes.error) throw new Error(`series: ${seriesRes.error.message}`);
    if (catRes.error) throw new Error(`categories: ${catRes.error.message}`);

    const iconById = new Map(allCategories.map((c) => [c.id, c.icon ?? null]));
    const categories = ((catRes.data ?? []) as CategorySpendRow[]).map((r) => ({
      categoryId: r.category_id,
      name: r.name,
      color: r.color,
      icon: (r.category_id ? iconById.get(r.category_id) : null) ?? null,
      totalSatang: toSatang(r.total),
    }));

    return json({
      view,
      scope,
      offset,
      series: fillSeries(starts, (seriesRes.data ?? []) as SeriesRow[], view, toSatang),
      categories,
      categoriesTotalSatang: categories.reduce((s, c) => s + c.totalSatang, 0),
      cycle: { from: cycle.from.toISOString(), to: cycle.to.toISOString() },
    });
  });
}
