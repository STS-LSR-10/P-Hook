import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_GOAL_NOTE } from "@/lib/goal";
import { addDeposit, listDeposits, listGoals } from "@/lib/goal-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/goals/:id/deposits — deposits and withdrawals, newest first. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบเป้าหมายนี้", 404);
    return json({ items: await listDeposits(getAdminClient(), auth.userId, id) });
  });
}

const depositSchema = z.object({
  /** Always a positive amount; `direction` says whether it goes in or out. */
  amount: z.union([z.string(), z.number()]),
  direction: z.enum(["in", "out"]).default("in"),
  note: z.string().trim().max(MAX_GOAL_NOTE).nullable().optional(),
});

/** POST /api/goals/:id/deposits — put money in, or take it out (never below zero). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบเป้าหมายนี้", 404);
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "savingsGoal");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = depositSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);
    const amount = String(parsed.data.amount).replace(/,/g, "").trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || toSatang(amount) <= 0) {
      return apiError("จำนวนเงินไม่ถูกต้อง (เช่น 2000 หรือ 2000.50)", 400);
    }

    const goal = (await listGoals(db, auth.userId, new Date())).find((g) => g.id === id);
    if (!goal) return apiError("ไม่พบเป้าหมายนี้", 404);
    const satang = toSatang(amount);
    if (parsed.data.direction === "out" && satang > goal.savedSatang) {
      return apiError("ถอนเกินยอดที่ออมไว้ไม่ได้", 400);
    }
    const depositId = await addDeposit(db, auth.userId, id, {
      amountSatang: parsed.data.direction === "out" ? -satang : satang,
      occurredAt: new Date(),
      note: parsed.data.note || null,
    });
    const savedAfter = goal.savedSatang + (parsed.data.direction === "out" ? -satang : satang);
    return json(
      {
        id: depositId,
        savedSatang: savedAfter,
        reachedTarget: goal.savedSatang < goal.targetSatang && savedAfter >= goal.targetSatang,
      },
      201,
    );
  });
}
