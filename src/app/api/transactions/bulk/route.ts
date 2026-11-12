import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { bulkPatchTransactions, getConfirmedByIds, loadCategories } from "@/lib/repo";
import { getAdminClient } from "@/lib/supabase/admin";
import { MAX_BULK, planBulkMove } from "@/lib/tx-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ids = z.array(z.string().uuid()).min(1).max(MAX_BULK);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids }),
  z.object({ action: z.literal("move"), ids, categoryId: z.string().uuid() }),
]);

/**
 * POST /api/transactions/bulk
 * { action: "delete", ids } | { action: "move", ids, categoryId }
 * Returns { updated, skipped } — skipped = selected entries that were not touched
 * (already gone, or of a type that does not fit the target category).
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("เลือกรายการไม่ถูกต้อง (สูงสุด 100 รายการ)", 400);
    const body = parsed.data;
    const unique = [...new Set(body.ids)];

    if (body.action === "delete") {
      const updated = await bulkPatchTransactions(db, auth.userId, unique, { status: "deleted" });
      return json({ updated, skipped: unique.length - updated });
    }

    const categories = await loadCategories(db, auth.userId);
    const target = categories.find((c) => c.id === body.categoryId && !c.is_hidden);
    if (!target) return apiError("หมวดหมู่ไม่ถูกต้อง", 400);

    const owned = await getConfirmedByIds(db, auth.userId, unique);
    const plan = planBulkMove(owned, target);
    const updated = await bulkPatchTransactions(db, auth.userId, plan.moveIds, {
      category_id: target.id,
    });
    return json({ updated, skipped: unique.length - updated });
  });
}
