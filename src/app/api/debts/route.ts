import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_DEBT_NOTE, MAX_OPEN_DEBTS_PER_PERSON, MAX_PERSON, cleanPerson } from "@/lib/debt";
import { createDebt, listDebts, openDebtsOf } from "@/lib/debt-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureWallets } from "@/lib/wallet-repo";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debts — every debt with what is paid and left, and what is owed each way. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const items = await listDebts(getAdminClient(), auth.userId);
    const sum = (direction: "lent" | "borrowed") =>
      items.filter((d) => d.direction === direction).reduce((s, d) => s + d.remainingSatang, 0);
    return json({ items, lentSatang: sum("lent"), borrowedSatang: sum("borrowed") });
  });
}

const createSchema = z.object({
  direction: z.enum(["lent", "borrowed"]),
  person: z.string().trim().min(1).max(MAX_PERSON),
  amount: z.union([z.string(), z.number()]),
  accountId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(MAX_DEBT_NOTE).nullable().optional(),
});

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** POST /api/debts — lend or borrow (Elite); the wallet's balance moves with it. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "debts");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ข้อมูลหนี้ไม่ถูกต้อง", 400);
    const amount = String(parsed.data.amount).replace(/,/g, "").trim();
    if (!AMOUNT_PATTERN.test(amount) || toSatang(amount) <= 0) {
      return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 500 หรือ 500.50)", 400);
    }

    // a debt moves money in or out of a private wallet (shared wallets take income / expenses only)
    const wallets = (await ensureWallets(db, auth.userId)).filter((w) => !w.shared);
    const wallet = parsed.data.accountId
      ? wallets.find((w) => w.id === parsed.data.accountId)
      : wallets.find((w) => w.isDefault);
    if (!wallet) return apiError("ไม่พบกระเป๋า", 404);

    const debts = await listDebts(db, auth.userId);
    if (
      openDebtsOf(debts, parsed.data.person, parsed.data.direction).length >=
      MAX_OPEN_DEBTS_PER_PERSON
    ) {
      return apiError(t("คนเดียวกันมีหนี้ค้างได้ไม่เกิน {0} ก้อน", MAX_OPEN_DEBTS_PER_PERSON), 400);
    }

    const id = await createDebt(db, auth.userId, {
      direction: parsed.data.direction,
      person: cleanPerson(parsed.data.person),
      amountSatang: toSatang(amount),
      accountId: wallet.id,
      occurredAt: new Date(),
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      note: parsed.data.note || null,
    });
    return json({ id }, 201);
  });
}
