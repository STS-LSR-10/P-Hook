import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { log } from "@/lib/log";
import { can } from "@/lib/plan";
import { getPlanInfo, loadMemoryIfAllowed } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { TX_SELECT, toTxDto } from "@/lib/dto";
import { getTransaction, loadCategories, patchTransactionRow, updateTransaction } from "@/lib/repo";
import { getSlip, learnMerchant } from "@/lib/slip-repo";
import { getAdminClient } from "@/lib/supabase/admin";
import { planEdit } from "@/lib/tx-edit";
import { listWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    title: z.string().max(200),
    amount: z.string().max(20),
    type: z.enum(["expense", "income"]),
    categoryId: z.string().uuid().nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    note: z.string().max(500).nullable(),
    accountId: z.string().uuid().nullable(),
  })
  .partial()
  .strict();

/** GET /api/transactions/:id — one of the user's own confirmed entries (the chat "แก้" button opens its editor). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการนี้", 404);

    const { data, error } = await getAdminClient()
      .from("transactions")
      .select(TX_SELECT)
      .eq("id", id)
      .eq("user_id", auth.userId)
      .eq("status", "confirmed")
      .maybeSingle();
    if (error) throw new Error(`load transaction: ${error.message}`);
    if (!data) return apiError("ไม่พบรายการนี้", 404);
    return json({ ...toTxDto(data as Parameters<typeof toTxDto>[0]), mine: true });
  });
}

/** PATCH /api/transactions/:id — edit a confirmed entry (title, amount, type, category, date, note). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการนี้", 404);

    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("กรอกข้อมูลไม่ครบหรือไม่ถูกต้อง", 400);

    const db = getAdminClient();
    const existing = await getTransaction(db, auth.userId, id);
    if (!existing || existing.status !== "confirmed") return apiError("ไม่พบรายการนี้", 404);

    if (parsed.data.accountId) {
      const wallets = await listWallets(db, auth.userId);
      if (!wallets.some((w) => w.id === parsed.data.accountId)) {
        return apiError("ไม่พบกระเป๋านี้", 400);
      }
    }

    const [categories, memory] = await Promise.all([
      loadCategories(db, auth.userId),
      loadMemoryIfAllowed(db, auth.userId),
    ]);
    const plan = planEdit({
      edit: parsed.data,
      existing,
      categories,
      memory,
      now: new Date(),
    });
    if (!plan.ok) return apiError(plan.error, 400);

    if (Object.keys(plan.patch).length > 0) {
      const updated = await patchTransactionRow(db, auth.userId, id, plan.patch);
      if (!updated) return apiError("ไม่พบรายการนี้", 404);
    }

    // Fixing the category of a slip entry teaches the recipient → category memory (Plus only).
    if (plan.categoryChanged && plan.categoryId && existing.slip_id) {
      try {
        const slip = await getSlip(db, auth.userId, existing.slip_id);
        const { plan: current } = await getPlanInfo(db, auth.userId);
        if (slip?.payee && can(current, "merchantMemory")) {
          await learnMerchant(db, {
            userId: auth.userId,
            payee: slip.payee,
            categoryId: plan.categoryId,
          });
        }
      } catch (error) {
        log.error("learn_merchant_failed", error);
      }
    }
    return json({ ok: true });
  });
}

/** DELETE /api/transactions/:id — soft delete (status = deleted). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบรายการนี้", 404);

    // The update is scoped by user_id, so another user's id simply matches nothing.
    const deleted = await updateTransaction(getAdminClient(), auth.userId, id, {
      status: "deleted",
    });
    if (!deleted) return apiError("ไม่พบรายการนี้", 404);
    return json({ ok: true });
  });
}
