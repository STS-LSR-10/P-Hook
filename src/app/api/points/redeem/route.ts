import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { POINTS_PER_PLUS_DAY } from "@/lib/config";
import { NotEnoughPointsError, redeemForPlus } from "@/lib/points";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ days: z.number().int().min(1).max(365) });

/** POST /api/points/redeem { days } — spend points on Plus days (atomic in SQL). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const limited = await limitOr429(getAdminClient(), "points", auth.userId, LIMITS.points);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("จำนวนวันไม่ถูกต้อง", 400);

    try {
      const expiresAt = await redeemForPlus(getAdminClient(), auth.userId, parsed.data.days);
      return json({
        ok: true,
        planExpiresAt: expiresAt,
        spent: parsed.data.days * POINTS_PER_PLUS_DAY,
      });
    } catch (error) {
      if (error instanceof NotEnoughPointsError) {
        return apiError(
          t("เหรียญสะสมไม่พอ (ต้องใช้ {0} แต้ม)", parsed.data.days * POINTS_PER_PLUS_DAY),
          400,
        );
      }
      throw error;
    }
  });
}
