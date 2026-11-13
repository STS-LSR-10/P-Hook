import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { createReminderCategory, listReminderCategories } from "@/lib/reminder-category-repo";
import {
  REMINDER_CATEGORY_INVALID_TEXT,
  readReminderCategory,
} from "@/lib/reminder-category-input";
import { getAdminClient } from "@/lib/supabase/admin";
import { t } from "@/lib/i18n";
import { MAX_CUSTOM_REMINDER_CATEGORIES } from "@/lib/user-reminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/reminders/categories { name, emoji } — a reminder category of the person's own. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const input = readReminderCategory(await readJson(request));
    if (!input) return apiError(REMINDER_CATEGORY_INVALID_TEXT, 400);
    const own = await listReminderCategories(db, auth.userId);
    if (own.length >= MAX_CUSTOM_REMINDER_CATEGORIES) {
      return apiError(t("สร้างหมวดเองได้สูงสุด {0} หมวดนะ", MAX_CUSTOM_REMINDER_CATEGORIES), 409);
    }
    if (own.some((c) => c.name.toLowerCase() === input.name.toLowerCase()))
      return apiError("มีหมวดชื่อนี้แล้วนะ", 409);
    const category = await createReminderCategory(db, auth.userId, input);
    if (!category) return apiError("มีหมวดชื่อนี้แล้วนะ", 409);
    return json({ category }, 201);
  });
}
