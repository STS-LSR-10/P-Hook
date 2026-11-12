import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_DEBT_NOTE } from "@/lib/debt";
import { addPayments, listDebts, listPayments } from "@/lib/debt-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/debts/:id/payments — the payments made on one debt, newest first. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบหนี้นี้", 404);
    return json({ items: await listPayments(getAdminClient(), auth.userId, id) });
  });
}

const paySchema = z.object({
  amount: z.union([z.string(), z.number()]),
  accountId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(MAX_DEBT_NOTE).nullable().optional(),
});

/**
 * POST /api/debts/:id/payments — a part (or the rest) of the debt paid. For money lent the wallet
 * receives it, for money borrowed the wallet pays it. More than is left is refused.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบหนี้นี้", 404);
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "debts");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = paySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);
    const amount = String(parsed.data.amount).replace(/,/g, "").trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || toSatang(amount) <= 0) {
      return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 200 หรือ 200.50)", 400);
    }

    const debt = (await listDebts(db, auth.userId)).find((d) => d.id === id);
    if (!debt) return apiError("ไม่พบหนี้นี้", 404);
    if (toSatang(amount) > debt.remainingSatang) {
      return apiError("ชำระเกินยอดที่เหลือไม่ได้", 400);
    }

    const wallets = (await ensureWallets(db, auth.userId)).filter((w) => !w.shared);
    const wallet = parsed.data.accountId
      ? wallets.find((w) => w.id === parsed.data.accountId)
      : (wallets.find((w) => w.id === debt.accountId) ?? wallets.find((w) => w.isDefault));
    if (!wallet) return apiError("ไม่พบกระเป๋า", 404);

    const [paymentId] = await addPayments(
      db,
      auth.userId,
      [{ debtId: id, amountSatang: toSatang(amount) }],
      { accountId: wallet.id, paidAt: new Date(), note: parsed.data.note || null },
    );
    return json({ id: paymentId, settled: toSatang(amount) === debt.remainingSatang }, 201);
  });
}
