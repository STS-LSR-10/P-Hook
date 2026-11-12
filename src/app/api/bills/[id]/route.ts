import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_BILL_NAME, MAX_BILL_NOTE, firstDue, todayKey, type BillCadence } from "@/lib/bill";
import { deleteBill, listBills, updateBill } from "@/lib/bill-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_BILL_NAME),
    amount: z.union([z.string(), z.number()]).nullable(),
    cadence: z.enum(["monthly", "yearly", "once"]),
    dayOfMonth: z.number().int().min(1).max(31),
    monthOfYear: z.number().int().min(1).max(12).nullable(),
    remindDays: z.array(z.number().int().min(0).max(30)).min(1).max(5),
    remindHour: z.number().int().min(0).max(23),
    note: z.string().trim().max(MAX_BILL_NOTE).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

/** PATCH /api/bills/:id — change the name, amount, schedule or reminder days / hour. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
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

    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);
    const b = parsed.data;

    const current = (await listBills(db, auth.userId)).find((x) => x.id === id);
    if (!current) return apiError("ไม่พบบิลนี้", 404);

    let amountSatang: number | null | undefined;
    if (b.amount !== undefined) {
      if (b.amount === null || String(b.amount).trim() === "") amountSatang = null;
      else {
        const amount = String(b.amount).replace(/,/g, "").trim();
        if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || toSatang(amount) <= 0) {
          return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 1250)", 400);
        }
        amountSatang = toSatang(amount);
      }
    }

    // a changed schedule moves the next due date to the first one that fits it
    const scheduleChanged =
      b.cadence !== undefined || b.dayOfMonth !== undefined || b.monthOfYear !== undefined;
    const cadence = (b.cadence ?? current.cadence) as BillCadence;
    const dayOfMonth = b.dayOfMonth ?? current.dayOfMonth;
    const monthOfYear = cadence === "monthly" ? null : (b.monthOfYear ?? current.monthOfYear);
    if (cadence !== "monthly" && !monthOfYear) return apiError("ใส่เดือนที่ครบกำหนดด้วยนะ", 400);

    const result = await updateBill(db, auth.userId, id, {
      name: b.name,
      amountSatang,
      cadence: b.cadence,
      dayOfMonth: b.dayOfMonth,
      monthOfYear: scheduleChanged ? monthOfYear : undefined,
      nextDueOn: scheduleChanged
        ? firstDue(cadence, dayOfMonth, monthOfYear, todayKey(new Date()))
        : undefined,
      remindDays: b.remindDays ? [...new Set(b.remindDays)].sort((x, y) => y - x) : undefined,
      remindHour: b.remindHour,
      note: b.note,
    });
    if (result === "duplicate") return apiError("มีบิลชื่อนี้อยู่แล้ว", 409);
    return result === "ok" ? json({ ok: true }) : apiError("ไม่พบบิลนี้", 404);
  });
}

/** DELETE /api/bills/:id — stop reminding about it. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบบิลนี้", 404);
    const removed = await deleteBill(getAdminClient(), auth.userId, id);
    return removed ? json({ ok: true }) : apiError("ไม่พบบิลนี้", 404);
  });
}
