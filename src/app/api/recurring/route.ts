import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { categorizeByRules } from "@/lib/categorize/rules";
import { recurringLimit } from "@/lib/plan";
import { getPlanInfo } from "@/lib/plan-server";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { describeRule, firstRunAt } from "@/lib/recurring";
import { countRules, insertRule, listRules } from "@/lib/recurring-repo";
import { loadCategories } from "@/lib/repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/recurring — the user's rules (a lapsed Plus still sees, and can delete, its rules). */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const { plan } = await getPlanInfo(db, auth.userId, new Date());
    const [rules, categories] = await Promise.all([
      listRules(db, auth.userId),
      loadCategories(db, auth.userId),
    ]);
    const names = new Map(categories.map((c) => [c.id, c.name]));
    return json({
      limit: recurringLimit(plan),
      items: rules.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        amountSatang: toSatang(r.amount),
        categoryId: r.category_id,
        categoryName: r.category_id ? (names.get(r.category_id) ?? null) : null,
        cadence: r.cadence,
        dayOfPeriod: r.day_of_period,
        description: describeRule(r.cadence, r.day_of_period),
        nextRunAt: r.next_run_at,
        isActive: r.is_active,
      })),
    });
  });
}

const createSchema = z
  .object({
    type: z.enum(["expense", "income"]),
    title: z.string().trim().min(1).max(60),
    amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
    categoryId: z.string().uuid().nullable().optional(),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    dayOfPeriod: z.number().int().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.cadence === "weekly" &&
      !(
        v.dayOfPeriod !== null &&
        v.dayOfPeriod !== undefined &&
        v.dayOfPeriod >= 0 &&
        v.dayOfPeriod <= 6
      )
    ) {
      ctx.addIssue({ code: "custom", path: ["dayOfPeriod"], message: "weekly needs 0-6" });
    }
    if (
      v.cadence === "monthly" &&
      !(
        v.dayOfPeriod !== null &&
        v.dayOfPeriod !== undefined &&
        v.dayOfPeriod >= 1 &&
        v.dayOfPeriod <= 31
      )
    ) {
      ctx.addIssue({ code: "custom", path: ["dayOfPeriod"], message: "monthly needs 1-31" });
    }
  });

/** POST /api/recurring — Plus only. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const locked = await requireFeature(db, auth.userId, "recurring");
    if (locked) return locked;

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("กรอกข้อมูลรายการประจำให้ครบและถูกต้องนะ", 400);
    const body = parsed.data;

    const amountSatang = toSatang(body.amount);
    if (amountSatang <= 0) return apiError("จำนวนเงินต้องมากกว่า 0", 400);
    const { plan } = await getPlanInfo(db, auth.userId, new Date());
    const max = recurringLimit(plan);
    if ((await countRules(db, auth.userId)) >= max) {
      return apiError(t("ตั้งรายการประจำได้สูงสุด {0} รายการนะ", max), 400);
    }

    const categories = await loadCategories(db, auth.userId);
    let categoryId = body.categoryId ?? null;
    if (categoryId) {
      const picked = categories.find((c) => c.id === categoryId);
      if (!picked || picked.type !== body.type) return apiError("หมวดหมู่ไม่ถูกต้อง", 400);
    } else {
      categoryId = categorizeByRules({
        title: body.title,
        type: body.type,
        categories,
        memory: [],
      }).categoryId;
    }

    const dayOfPeriod = body.cadence === "daily" ? null : (body.dayOfPeriod ?? null);
    const id = await insertRule(db, {
      userId: auth.userId,
      type: body.type,
      amountSatang,
      title: body.title,
      categoryId,
      cadence: body.cadence,
      dayOfPeriod,
      firstRunAt: firstRunAt(new Date(), body.cadence, dayOfPeriod),
    });
    return json({ id }, 201);
  });
}
