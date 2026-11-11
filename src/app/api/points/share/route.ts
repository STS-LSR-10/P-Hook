import { guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { SHARE_BONUS } from "@/lib/config";
import { awardShare } from "@/lib/points";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/points/share — the person shared their summary (the share button of the summary page).
 * Pays the monthly share bonus once a month. The server cannot see what was posted where, so this
 * trusts the button; the once-a-month cap is what keeps it small.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const limited = await limitOr429(db, "points", auth.userId, LIMITS.points);
    if (limited) return limited;
    const paid = await awardShare(db, auth.userId, new Date());
    return json({ awarded: paid, coins: paid ? SHARE_BONUS : 0 });
  });
}
