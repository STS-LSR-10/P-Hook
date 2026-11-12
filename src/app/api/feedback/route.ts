import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_FEEDBACK_LENGTH, cleanFeedback } from "@/lib/feedback";
import { addFeedback } from "@/lib/feedback-repo";
import { getPlanInfo } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/feedback { body } — a suggestion or comment for the admin, from the settings page. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const parsed = z.object({ body: z.string() }).safeParse(await readJson(request));
    const body = parsed.success ? cleanFeedback(parsed.data.body) : "";
    if (!body || body.length > MAX_FEEDBACK_LENGTH) {
      return apiError("เขียนข้อเสนอแนะให้ไม่ว่างและไม่เกิน 1,000 ตัวอักษรนะ", 400);
    }
    const db = getAdminClient();
    // the same daily ceiling as the chat's "เสนอแนะ" (they count together)
    const limited = await limitOr429(db, "feedback_day", auth.lineUserId, LIMITS.feedbackDay);
    if (limited) return limited;
    const { plan } = await getPlanInfo(db, auth.userId);
    await addFeedback(db, { userId: auth.userId, plan, body, source: "app" });
    return json({ ok: true });
  });
}
