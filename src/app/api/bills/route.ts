import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import {
  MAX_ACTIVE_BILLS,
  MAX_BILL_NAME,
  MAX_BILL_NOTE,
  cardBills,
  firstDue,
  todayKey,
  type BillCadence,
} from "@/lib/bill";
import { createBill, listBills } from "@/lib/bill-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { listWallets } from "@/lib/wallet-repo";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/bills — the person's bills, plus the due days of their credit cards (read only). */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const today = todayKey(new Date());
    const [own, wallets] = await Promise.all([
      listBills(db, auth.userId),
      listWallets(db, auth.userId),
    ]);
    const items = [...own, ...cardBills(wallets, today)].sort((a, b) =>
      a.nextDueOn.localeCompare(b.nextDueOn),
    );
    return json({ items, limit: MAX_ACTIVE_BILLS, canAdd: own.length < MAX_ACTIVE_BILLS });
  });
}

const billBodyFields = {
  name: z.string().trim().min(1).max(MAX_BILL_NAME),
  amount: z.union([z.string(), z.number()]).nullable(),
  cadence: z.enum(["monthly", "yearly", "once"]),
  dayOfMonth: z.number().int().min(1).max(31),
  monthOfYear: z.number().int().min(1).max(12).nullable(),
  remindDays: z.array(z.number().int().min(0).max(30)).min(1).max(5),
  remindHour: z.number().int().min(0).max(23),
  note: z.string().trim().max(MAX_BILL_NOTE).nullable(),
};

const createSchema = z.object({
  ...billBodyFields,
  amount: billBodyFields.amount.optional(),
  monthOfYear: billBodyFields.monthOfYear.optional(),
  remindDays: billBodyFields.remindDays.optional(),
  remindHour: billBodyFields.remindHour.optional(),
  note: billBodyFields.note.optional(),
});

/** POST /api/bills — a new bill to be reminded about (Elite). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "billReminder");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ข้อมูลบิลไม่ถูกต้อง", 400);
    const b = parsed.data;
    if (b.cadence !== "monthly" && !b.monthOfYear)
      return apiError("ใส่เดือนที่ครบกำหนดด้วยนะ", 400);

    let amountSatang: number | null = null;
    if (b.amount !== null && b.amount !== undefined && String(b.amount).trim() !== "") {
      const amount = String(b.amount).replace(/,/g, "").trim();
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || toSatang(amount) <= 0) {
        return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 1250)", 400);
      }
      amountSatang = toSatang(amount);
    }

    if ((await listBills(db, auth.userId)).length >= MAX_ACTIVE_BILLS) {
      return apiError(t("มีบิลได้สูงสุด {0} รายการ", MAX_ACTIVE_BILLS), 400);
    }
    const cadence = b.cadence as BillCadence;
    const id = await createBill(db, auth.userId, {
      name: b.name,
      amountSatang,
      cadence,
      dayOfMonth: b.dayOfMonth,
      monthOfYear: cadence === "monthly" ? null : (b.monthOfYear ?? null),
      nextDueOn: firstDue(cadence, b.dayOfMonth, b.monthOfYear ?? null, todayKey(new Date())),
      remindDays: [...new Set(b.remindDays ?? [1])].sort((x, y) => y - x),
      remindHour: b.remindHour ?? 9,
      note: b.note || null,
    });
    if (id === "duplicate") return apiError("มีบิลชื่อนี้อยู่แล้ว", 409);
    return json({ id }, 201);
  });
}
