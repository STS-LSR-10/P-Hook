import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { parseEmoji } from "@/lib/category-emoji";
import { MAX_GOAL_NAME } from "@/lib/goal";
import { createGoal, listGoals } from "@/lib/goal-repo";
import { toSatang } from "@/lib/money";
import { goalCapacity, PLAN_LABEL } from "@/lib/plan";
import { getPlanInfo, requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/goals — the savings goals with progress, and how many the plan allows. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const [items, { plan }] = await Promise.all([
      listGoals(db, auth.userId, new Date()),
      getPlanInfo(db, auth.userId),
    ]);
    const limit = goalCapacity(plan);
    return json({ items, limit, canAdd: items.filter((g) => !g.archived).length < limit });
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_GOAL_NAME),
  emoji: z.string().nullable().optional(),
  target: z.union([z.string(), z.number()]),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** POST /api/goals — a new piggy bank (Pro and above). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "savingsGoal");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ตั้งชื่อเป้าหมายให้ถูกต้องนะ (ไม่เกิน 40 ตัวอักษร)", 400);
    const target = String(parsed.data.target).replace(/,/g, "").trim();
    if (!AMOUNT_PATTERN.test(target) || toSatang(target) <= 0) {
      return apiError("ยอดเป้าหมายไม่ถูกต้อง (เช่น 30000)", 400);
    }
    const em = parseEmoji(parsed.data.emoji ?? null);
    if (!em.ok) return apiError("อีโมจิต้องเป็นรูปเดียว", 400);
    const emoji = em.emoji;

    const { plan } = await getPlanInfo(db, auth.userId);
    const live = (await listGoals(db, auth.userId, new Date())).filter((g) => !g.archived).length;
    if (live >= goalCapacity(plan)) {
      return Response.json(
        {
          error:
            plan === "ultimate"
              ? `มีเป้าหมายได้สูงสุด ${goalCapacity(plan)} ใบ`
              : `แผน ${PLAN_LABEL[plan]} มีเป้าหมายได้ ${goalCapacity(plan)} ใบ อัปเกรดแผนเพื่อมีได้มากขึ้นนะ`,
          upgrade: plan !== "ultimate",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const id = await createGoal(db, auth.userId, {
      name: parsed.data.name,
      emoji,
      targetSatang: toSatang(target),
      dueOn: parsed.data.dueOn ?? null,
    });
    if (id === "duplicate") return apiError("มีเป้าหมายชื่อนี้อยู่แล้ว", 409);
    return json({ id }, 201);
  });
}
