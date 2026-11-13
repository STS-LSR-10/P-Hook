import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import {
  deleteReminderCategory,
  listReminderCategories,
  updateReminderCategory,
} from "@/lib/reminder-category-repo";
import {
  REMINDER_CATEGORY_INVALID_TEXT,
  readReminderCategory,
} from "@/lib/reminder-category-input";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const NOT_FOUND = "ไม่พบหมวดนี้";

/** PATCH /api/reminders/categories/:id { name, emoji } — rename it or change its emoji. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const input = readReminderCategory(await readJson(request));
    if (!input) return apiError(REMINDER_CATEGORY_INVALID_TEXT, 400);
    const own = await listReminderCategories(db, auth.userId);
    if (own.some((c) => c.id !== id && c.name.toLowerCase() === input.name.toLowerCase())) {
      return apiError("มีหมวดชื่อนี้แล้วนะ", 409);
    }
    const result = await updateReminderCategory(db, auth.userId, id, input);
    if (result === "taken") return apiError("มีหมวดชื่อนี้แล้วนะ", 409);
    return result === "ok" ? json({ category: { id, ...input } }) : apiError(NOT_FOUND, 404);
  });
}

/** DELETE /api/reminders/categories/:id — its reminders stay, with no category. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    return (await deleteReminderCategory(db, auth.userId, id))
      ? json({ ok: true })
      : apiError(NOT_FOUND, 404);
  });
}
