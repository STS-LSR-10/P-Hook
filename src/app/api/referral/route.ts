import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { REFERRAL_FAIL_TEXT, REFERRAL_OK_TEXT } from "@/lib/line/messages";
import { applyReferralCode } from "@/lib/points";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(4).max(16) });

/** POST /api/referral { code } — attach a referrer. Bonuses are paid at the first entry. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const limited = await limitOr429(getAdminClient(), "points", auth.userId, LIMITS.points);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("กรอกรหัสชวนเพื่อนให้ถูกต้องนะ", 400);

    const outcome = await applyReferralCode(getAdminClient(), auth.userId, parsed.data.code);
    if (outcome !== "ok") return apiError(REFERRAL_FAIL_TEXT[outcome], 400);
    return json({ ok: true, message: REFERRAL_OK_TEXT });
  });
}
