import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { PASS_PACKS } from "@/lib/config";
import { NotEnoughPointsError, redeemForPlus } from "@/lib/points";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ pack: z.enum(PASS_PACKS.map((p) => p.id) as [string, ...string[]]) });

/** POST /api/points/redeem { pack } — spend HookCoins on a Pro Pass (atomic in SQL). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const limited = await limitOr429(getAdminClient(), "points", auth.userId, LIMITS.points);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("แพ็กที่เลือกไม่ถูกต้อง", 400);
    const pack = PASS_PACKS.find((p) => p.id === parsed.data.pack)!;

    try {
      const expiresAt = await redeemForPlus(getAdminClient(), auth.userId, pack.id);
      return json({ ok: true, planExpiresAt: expiresAt, spent: pack.coins, days: pack.days });
    } catch (error) {
      if (error instanceof NotEnoughPointsError) {
        return apiError(t("ฮูกคอยน์ไม่พอ (ต้องใช้ {0} ฮูกคอยน์)", pack.coins), 400);
      }
      throw error;
    }
  });
}
