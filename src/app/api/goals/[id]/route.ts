import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { parseEmoji } from "@/lib/category-emoji";
import { MAX_GOAL_NAME } from "@/lib/goal";
import { deleteGoal, listGoals, updateGoal } from "@/lib/goal-repo";
import { toSatang } from "@/lib/money";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_GOAL_NAME),
    emoji: z.string().nullable(),
    target: z.union([z.string(), z.number()]),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

/** PATCH /api/goals/:id — rename, change the emoji, the target or the date. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
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

    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    let targetSatang: number | undefined;
    if (parsed.data.target !== undefined) {
      const target = String(parsed.data.target).replace(/,/g, "").trim();
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(target) || toSatang(target) <= 0) {
        return apiError("ยอดเป้าหมายไม่ถูกต้อง (เช่น 30000)", 400);
      }
      targetSatang = toSatang(target);
    }
    let emoji: string | null | undefined;
    if (parsed.data.emoji !== undefined) {
      const em = parseEmoji(parsed.data.emoji);
      if (!em.ok) return apiError("อีโมจิต้องเป็นรูปเดียว", 400);
      emoji = em.emoji;
    }
    const result = await updateGoal(db, auth.userId, id, {
      name: parsed.data.name,
      emoji,
      targetSatang,
      dueOn: parsed.data.dueOn,
    });
    if (result === "duplicate") return apiError("มีเป้าหมายชื่อนี้อยู่แล้ว", 409);
    return result === "ok" ? json({ ok: true }) : apiError("ไม่พบเป้าหมายนี้", 404);
  });
}

/** DELETE /api/goals/:id — remove the goal and its deposits. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบเป้าหมายนี้", 404);
    const db = getAdminClient();
    // look first so the answer says whether it was theirs
    const goal = (await listGoals(db, auth.userId, new Date())).find((g) => g.id === id);
    if (!goal) return apiError("ไม่พบเป้าหมายนี้", 404);
    await deleteGoal(db, auth.userId, id);
    return json({ ok: true, hadSavedSatang: goal.savedSatang });
  });
}
