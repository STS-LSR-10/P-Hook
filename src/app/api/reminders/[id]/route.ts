import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { roundAfter } from "@/lib/reminder-calendar";
import {
  REMINDER_INVALID_TEXT,
  reminderRoomProblem,
  reminderSchema,
  reminderTimeProblem,
} from "@/lib/reminder-input";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  cancelReminder,
  getReminder,
  reopenReminder,
  setReminderDone,
  skipReminderRound,
  updateReminder,
} from "@/lib/user-reminder-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = "ไม่พบเตือนนี้";
const MOVED = "เตือนนี้เพิ่งเปลี่ยนไปแล้ว ดูรายการล่าสุดนะ";
const actionSchema = z.discriminatedUnion("action", [
  /** `remindAt` is the round the person saw: a tick never applies to any other. */
  z.object({ action: z.literal("done"), remindAt: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal("undo") }),
]);

/**
 * PATCH /api/reminders/:id — { action: "done", remindAt } ticks a round: a one-off will not be sent,
 * a repeat skips it and goes on. { action: "undo" } takes the tick back while its time is still
 * ahead. Any other body is the whole reminder, rewritten; a new time brings a finished one back.
 */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const input: unknown = await request.json().catch(() => null);
    const action = actionSchema.safeParse(input);
    const edit = action.success ? null : reminderSchema.safeParse(input);
    if (edit && !edit.success) return apiError(REMINDER_INVALID_TEXT, 400);

    const reminder = await getReminder(db, auth.userId, id);
    if (!reminder) return apiError(NOT_FOUND, 404);

    if (edit?.data) {
      const remindAt = new Date(edit.data.remindAt);
      const sameTime = remindAt.getTime() === new Date(reminder.remindAt).getTime();
      // a spelling fix on a ticked reminder leaves it ticked
      const keepsDone = reminder.status === "done" && sameTime;
      if (!sameTime) {
        const problem = reminderTimeProblem(remindAt);
        if (problem) return apiError(problem, 400);
      }
      if (reminder.status === "done" && !keepsDone) {
        const full = await reminderRoomProblem(db, auth.userId);
        if (full) return full;
      }
      const updated = await updateReminder(db, auth.userId, id, {
        body: edit.data.body,
        remindAt,
        repeat: edit.data.repeat ?? null,
        category: edit.data.category ?? null,
        status: keepsDone ? "done" : "active",
      });
      return updated ? json({ reminder: updated }) : apiError(NOT_FOUND, 404);
    }

    if (action.data?.action === "undo") {
      if (new Date(reminder.remindAt).getTime() <= Date.now() + 30_000) {
        return apiError("เลยเวลาแล้ว กดแก้เพื่อตั้งเวลาใหม่นะ", 409);
      }
      const full = await reminderRoomProblem(db, auth.userId);
      if (full) return full;
      return (await reopenReminder(db, auth.userId, id))
        ? json({ ok: true })
        : apiError(MOVED, 409);
    }

    const seen = action.data?.remindAt ?? "";
    if (new Date(seen).getTime() !== new Date(reminder.remindAt).getTime()) {
      return apiError(MOVED, 409);
    }
    if (reminder.repeat) {
      const next = roundAfter(new Date(reminder.remindAt), reminder.repeat, new Date());
      return (await skipReminderRound(db, auth.userId, id, reminder.remindAt, next))
        ? json({ ok: true, skipped: true })
        : apiError(MOVED, 409);
    }
    return (await setReminderDone(db, auth.userId, id)) ? json({ ok: true }) : apiError(MOVED, 409);
  });
}

/** DELETE /api/reminders/:id — cancel a reminder. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError(NOT_FOUND, 404);
    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    return (await cancelReminder(db, auth.userId, id))
      ? json({ ok: true })
      : apiError(NOT_FOUND, 404);
  });
}
