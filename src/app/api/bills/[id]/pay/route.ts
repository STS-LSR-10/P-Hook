import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { recordBillExpense, settleBill } from "@/lib/bill-actions";
import { listBills } from "@/lib/bill-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { ensureUser } from "@/lib/repo";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** Also record an expense for it. */
  record: z.boolean().optional(),
  /** The amount to record (baht); the bill's usual amount when left out. */
  amount: z.union([z.string(), z.number()]).nullable().optional(),
});

/** POST /api/bills/:id/pay — paid (or skipped): move to the next due date; optionally record the expense. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบบิลนี้", 404);
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "billReminder");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse((await readJson(request)) ?? {});
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const bill = (await listBills(db, auth.userId)).find((b) => b.id === id);
    if (!bill) return apiError("ไม่พบบิลนี้", 404);

    let recordSatang: number | null = null;
    if (parsed.data.record) {
      const given =
        parsed.data.amount === null || parsed.data.amount === undefined
          ? null
          : String(parsed.data.amount).replace(/,/g, "").trim();
      if (given !== null) {
        if (!/^\d{1,10}(\.\d{1,2})?$/.test(given) || toSatang(given) <= 0) {
          return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 1250)", 400);
        }
        recordSatang = toSatang(given);
      } else recordSatang = bill.amountSatang;
      if (!recordSatang) return apiError("ใส่จำนวนเงินที่จะจดด้วยนะ", 400);
    }

    const now = new Date();
    if (recordSatang) {
      const user = await ensureUser(db, auth.lineUserId, async () => null);
      await recordBillExpense(db, user, bill, recordSatang, now);
    }
    const { nextDueOn } = await settleBill(db, auth.userId, bill, now);
    return json({ ok: true, nextDueOn, recorded: recordSatang !== null });
  });
}
