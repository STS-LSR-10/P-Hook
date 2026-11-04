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
import {
  googleEventOf,
  removeGoogleEvent,
  skipGoogleRound,
  syncReminderToGoogle,
} from "@/lib/google/sync";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  cancelReminder,
  getReminder,
  reopenReminder,
  setReminderDone,
  skipReminderRound,
  updateReminder,
} from "@/lib/user-reminder-repo";
import { reminderKind } from "@/lib/user-reminder";

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
      // waiting again, or waiting as the other kind (one-off <-> repeat): it needs room there
      const kind = reminderKind(edit.data.repeat);
      const joins =
        (reminder.status === "done" && !keepsDone) ||
        (reminder.status === "active" && kind !== reminderKind(reminder.repeat));
      if (joins) {
        const full = await reminderRoomProblem(db, auth.userId, kind);
        if (full) return full;
      }
      const updated = await updateReminder(db, auth.userId, id, {
        body: edit.data.body,
        remindAt,
        repeat: edit.data.repeat ?? null,
        category: edit.data.category ?? null,
        status: keepsDone ? "done" : "active",
      });
      if (!updated) return apiError(NOT_FOUND, 404);
      // only the words changed: the event is renamed, so a series keeps its past rounds
      const onlyText = sameTime && (edit.data.repeat ?? null) === reminder.repeat;
      await syncReminderToGoogle(
        db,
        auth.userId,
        updated,
        undefined,
        onlyText ? { onlyText: true } : {},
      );
      return json({ reminder: updated });
    }

    if (action.data?.action === "undo") {
      if (new Date(reminder.remindAt).getTime() <= Date.now() + 30_000) {
        return apiError("เลยเวลาแล้ว กดแก้เพื่อตั้งเวลาใหม่นะ", 409);
      }
      const full = await reminderRoomProblem(db, auth.userId, reminderKind(reminder.repeat));
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
      if (!(await skipReminderRound(db, auth.userId, id, reminder.remindAt, next))) {
        return apiError(MOVED, 409);
      }
      await skipGoogleRound(db, auth.userId, id, reminder.remindAt);
      return json({ ok: true, skipped: true });
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
    const eventId = await googleEventOf(db, auth.userId, id);
    if (!(await cancelReminder(db, auth.userId, id))) return apiError(NOT_FOUND, 404);
    await removeGoogleEvent(db, auth.userId, eventId);
    return json({ ok: true });
  });
}
