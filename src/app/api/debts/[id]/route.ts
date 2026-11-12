import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_DEBT_NOTE, MAX_PERSON } from "@/lib/debt";
import { deleteDebt, listDebts, updateDebt } from "@/lib/debt-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    person: z.string().trim().min(1).max(MAX_PERSON),
    amount: z.union([z.string(), z.number()]),
    accountId: z.string().uuid(),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    note: z.string().trim().max(MAX_DEBT_NOTE).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

/** PATCH /api/debts/:id — change the person, amount, wallet, due date or note. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
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

    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const debt = (await listDebts(db, auth.userId)).find((d) => d.id === id);
    if (!debt) return apiError("ไม่พบหนี้นี้", 404);

    let amountSatang: number | undefined;
    if (parsed.data.amount !== undefined) {
      const amount = String(parsed.data.amount).replace(/,/g, "").trim();
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || toSatang(amount) <= 0) {
        return apiError("จำนวนเงินไม่ถูกต้อง", 400);
      }
      amountSatang = toSatang(amount);
      if (amountSatang < debt.paidSatang) {
        return apiError("ยอดหนี้ต้องไม่น้อยกว่าที่ชำระมาแล้ว", 400);
      }
    }
    if (parsed.data.accountId) {
      const wallets = (await ensureWallets(db, auth.userId)).filter((w) => !w.shared);
      if (!wallets.some((w) => w.id === parsed.data.accountId))
        return apiError("ไม่พบกระเป๋า", 404);
    }
    const updated = await updateDebt(db, auth.userId, id, {
      person: parsed.data.person,
      amountSatang,
      accountId: parsed.data.accountId,
      dueAt:
        parsed.data.dueAt === undefined
          ? undefined
          : parsed.data.dueAt
            ? new Date(parsed.data.dueAt)
            : null,
      note: parsed.data.note,
    });
    return updated ? json({ ok: true }) : apiError("ไม่พบหนี้นี้", 404);
  });
}

/** DELETE /api/debts/:id — remove the debt and its payments (the wallets go back as they were). */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบหนี้นี้", 404);
    const removed = await deleteDebt(getAdminClient(), auth.userId, id);
    return removed ? json({ ok: true }) : apiError("ไม่พบหนี้นี้", 404);
  });
}
