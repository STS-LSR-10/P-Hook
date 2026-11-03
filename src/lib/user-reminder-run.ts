import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { groupReminderPushText, reminderPushText } from "@/lib/line/messages";
import type { LineMessage } from "@/lib/types";
import { claimDueReminders } from "@/lib/user-reminder-repo";
import { REPEAT_LABEL } from "@/lib/user-reminder";

export interface UserReminderRunSummary {
  claimed: number;
  sent: number;
  errors: number;
}

/**
 * Every few minutes: push the reminders that are due. Each is taken first (a one-off is marked done, a
 * repeating one moves to its next time), then pushed, so a failing push (the person blocked the bot)
 * is not retried every run, and two overlapping runs never send the same reminder twice. One set in a
 * group is pushed to the group.
 */
export async function runUserReminders(
  db: SupabaseClient,
  push: (lineUserId: string, messages: LineMessage[]) => Promise<void>,
  now: Date,
  liffUrl?: string,
): Promise<UserReminderRunSummary> {
  const summary: UserReminderRunSummary = { claimed: 0, sent: 0, errors: 0 };
  const due = await claimDueReminders(db, now);
  summary.claimed = due.length;
  for (const r of due) {
    // a group's reminder goes to the group, and not at all once the bot has left it
    if (r.lineGroupId && !r.groupOpen) continue;
    try {
      await push(r.lineGroupId ?? r.lineUserId, [
        {
          type: "text",
          text: r.lineGroupId
            ? groupReminderPushText(r.body, r.repeat ? REPEAT_LABEL[r.repeat] : null)
            : reminderPushText(r.body, r.repeat ? REPEAT_LABEL[r.repeat] : null, liffUrl),
        },
      ]);
      summary.sent += 1;
    } catch (error) {
      summary.errors += 1;
      log.warn("user_reminder_push_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return summary;
}
