import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { budgetAlertsFor, dailyBudgetAlertsFor } from "@/lib/budget-alert";
import { categorizeByRules } from "@/lib/categorize/rules";
import { TX_SELECT, toTxDto } from "@/lib/dto";
import { toSatang } from "@/lib/money";
import { can, effectivePlan } from "@/lib/plan";
import { loadMemoryIfAllowed } from "@/lib/plan-server";
import { loadSearchTotals, parseSearchTerm, type SearchTarget } from "@/lib/search";
import { getUserPlanRow } from "@/lib/slip-repo";
import { awardActivity } from "@/lib/points";
import { insertTransaction, loadCategories } from "@/lib/repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { applyTxFilters, txFilterSchema } from "@/lib/tx-query";
import { listWallets } from "@/lib/wallet-repo";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A row as PostgREST returns it for TX_SELECT (its embeds are typed loosely on purpose). */
type ListRow = Parameters<typeof toTxDto>[0];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const listSchema = txFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/transactions?type&from&to&categoryId&q&limit&offset */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = listSchema.safeParse(params);
    if (!parsed.success) return apiError("ตัวกรองไม่ถูกต้อง", 400);
    const f = parsed.data;

    const wallets = f.accountId ? await listWallets(getAdminClient(), auth.userId) : [];
    const defaultAccountId = wallets.find((w) => w.isDefault)?.id ?? null;
    // looking at one shared wallet shows what everybody on it wrote (the wallet list above already
    // proves the person is on it); everything else is only their own entries
    const sharedView = f.accountId ? wallets.some((w) => w.id === f.accountId && w.shared) : false;
    const base = getAdminClient().from("transactions").select(TX_SELECT);
    const query = applyTxFilters(
      (sharedView ? base : base.eq("user_id", auth.userId)).eq("status", "confirmed"),
      f,
      { defaultAccountId },
    )
      .order("occurred_at", { ascending: false })
      .range(f.offset, f.offset + f.limit); // one extra row tells us if there is a next page

    const { data, error } = await query;
    if (error) throw new Error(`list transactions: ${error.message}`);
    const rows = data ?? [];

    // While searching, the first page also carries the totals of everything found (Pro and
    // above). They are added up by the database, so they cover more than the page that is shown.
    let totals: Awaited<ReturnType<typeof loadSearchTotals>> | null = null;
    const target: SearchTarget | null = f.q
      ? parseSearchTerm(f.q)
      : f.tag
        ? { q: null, tag: f.tag.replace(/^#/, "").toLowerCase() }
        : null;
    if (target && f.offset === 0) {
      const db = getAdminClient();
      const row = await getUserPlanRow(db, auth.userId);
      if (can(effectivePlan(row.plan, row.plan_expires_at, new Date()), "searchTotals")) {
        totals = await loadSearchTotals(db, auth.userId, target);
      }
    }
    return json({
      items: rows.slice(0, f.limit).map((r: ListRow) => ({
        ...toTxDto(r),
        mine: r.user_id === auth.userId,
      })),
      hasMore: rows.length > f.limit,
      totals,
    });
  });
}

const createSchema = z.object({
  type: z.enum(["expense", "income"]),
  title: z.string().trim().min(1).max(60),
  /** Decimal string such as "50.50" — never a float. */
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

/** POST /api/transactions — add an entry by hand. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง", 400);
    const body = parsed.data;

    const amountSatang = toSatang(body.amount);
    if (amountSatang <= 0) return apiError("จำนวนเงินต้องมากกว่า 0", 400);

    const db = getAdminClient();
    const [categories, memory] = await Promise.all([
      loadCategories(db, auth.userId),
      loadMemoryIfAllowed(db, auth.userId),
    ]);

    let categoryId = body.categoryId ?? null;
    if (categoryId) {
      // Only allow a visible category of the same type that the user may use.
      const picked = categories.find((c) => c.id === categoryId);
      if (!picked || picked.type !== body.type) return apiError("หมวดหมู่ไม่ถูกต้อง", 400);
    } else {
      categoryId = categorizeByRules({
        title: body.title,
        type: body.type,
        categories,
        memory,
      }).categoryId;
    }

    const tx = await insertTransaction(db, {
      userId: auth.userId,
      type: body.type,
      title: body.title,
      amountSatang,
      categoryId,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      status: "confirmed",
      rawText: body.title,
      source: "manual",
    });
    // The day's point (and a pending referral bonus) for the first entry of the day.
    await awardActivity(db, auth.userId, new Date());

    // Budget alerts for an entry made in the web app come back in the response (the page shows them
    // right where the person is looking) instead of being pushed to the chat, which costs quota.
    const alerts: string[] = [];
    try {
      alerts.push(
        ...(await budgetAlertsFor(db, {
          userId: auth.userId,
          type: body.type,
          categoryId,
          amountSatang,
          occurredAt: new Date(tx.occurred_at),
          now: new Date(),
        })),
      );
      if (body.type === "expense") {
        alerts.push(
          ...(await dailyBudgetAlertsFor(db, {
            userId: auth.userId,
            amountSatang,
            occurredAt: new Date(tx.occurred_at),
            now: new Date(),
          })),
        );
      }
    } catch (error) {
      log.error("budget_alert_failed", error);
    }
    return json({ id: tx.id, alerts }, 201);
  });
}
