import { loadBonus } from "@/lib/addons-repo";
import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { getPlanInfo } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  REMINDER_INVALID_TEXT,
  reminderRoomProblem,
  reminderSchema,
  reminderTimeProblem,
} from "@/lib/reminder-input";
import { reminderCapacity, reminderKind, repeatCapacity } from "@/lib/user-reminder";
import {
  countActiveReminders,
  createReminder,
  listRemindersForPage,
} from "@/lib/user-reminder-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reminders — those waiting, the latest ones finished, and how many the plan allows:
 * one-offs (`active` of `limit`) and repeating ones (`repeating` of `repeatLimit`) apart.
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const [items, active, repeating, { plan }] = await Promise.all([
      listRemindersForPage(db, auth.userId),
      countActiveReminders(db, auth.userId, "once"),
      countActiveReminders(db, auth.userId, "repeat"),
      getPlanInfo(db, auth.userId),
    ]);
    const limit = reminderCapacity(plan, (await loadBonus(db, auth.userId)).alerts);
    const repeatLimit = repeatCapacity(plan);
    const canAddOnce = active < limit;
    const canAddRepeat = repeating < repeatLimit;
    return json({
      items,
      active,
      limit,
      repeating,
      repeatLimit,
      canAdd: canAddOnce || canAddRepeat,
      canAddOnce,
      canAddRepeat,
    });
  });
}

/** POST /api/reminders { body, remindAt, repeat? } — a new reminder. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = reminderSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError(REMINDER_INVALID_TEXT, 400);
    const remindAt = new Date(parsed.data.remindAt);
    const problem = reminderTimeProblem(remindAt);
    if (problem) return apiError(problem, 400);

    const full = await reminderRoomProblem(db, auth.userId, reminderKind(parsed.data.repeat));
    if (full) return full;
    const reminder = await createReminder(db, auth.userId, {
      body: parsed.data.body,
      remindAt,
      repeat: parsed.data.repeat ?? null,
      category: parsed.data.category ?? null,
    });
    return json({ reminder }, 201);
  });
}
