import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { toSatang } from "@/lib/money";
import { getAdminClient } from "@/lib/supabase/admin";
import { MAX_TRANSFER_NOTE } from "@/lib/transfer";
import { createTransfer, listTransfers } from "@/lib/transfer-repo";
import { ensureWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/transfers — the latest transfers between the person's wallets. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    return json({ items: await listTransfers(getAdminClient(), auth.userId, 20) });
  });
}

const createSchema = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  amount: z.union([z.string(), z.number()]),
  occurredAt: z.string().datetime().optional(),
  note: z.string().trim().max(MAX_TRANSFER_NOTE).nullable().optional(),
});

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** POST /api/transfers — move money between two of the person's wallets (Pro and above). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "transfer");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลการโอนไม่ถูกต้อง", 400);
    const { fromId, toId, note, occurredAt } = parsed.data;
    const amount = String(parsed.data.amount).replace(/,/g, "").trim();
    if (!AMOUNT_PATTERN.test(amount) || toSatang(amount) <= 0) {
      return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 500 หรือ 500.50)", 400);
    }
    if (fromId === toId) return apiError("โอนไปกระเป๋าเดียวกันไม่ได้", 400);

    // shared wallets take income and expenses only for now: no transfers in or out
    const wallets = (await ensureWallets(db, auth.userId)).filter((w) => !w.shared);
    if (!wallets.some((w) => w.id === fromId) || !wallets.some((w) => w.id === toId)) {
      return apiError("ไม่พบกระเป๋า", 404);
    }
    const id = await createTransfer(db, auth.userId, {
      fromId,
      toId,
      amountSatang: toSatang(amount),
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      note: note || null,
    });
    return json({ id }, 201);
  });
}
