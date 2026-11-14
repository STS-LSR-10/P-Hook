import type { SupabaseClient } from "@supabase/supabase-js";
import { effectivePlan, GROUP_PUSH_PER_MONTH } from "@/lib/plan";
import { getUserPlanRow } from "@/lib/slip-repo";
import type { Mention } from "@/lib/group-mention";
import { addLateReminder, purgeLateReminders, reminderTargets } from "@/lib/group-reminder-repo";
import { getGroup } from "@/lib/group-repo";
import { groupReminderMessage, refusedAsMalformed } from "@/lib/line/group-riders";
import { groupReminderDirectText, reminderPushText } from "@/lib/line/messages";
import { reminderActions } from "@/lib/line/reminder-flex";
import { log } from "@/lib/log";
import type { LineMessage } from "@/lib/types";
import { monthKey, refundUsageAmount, takeUsageAmount } from "@/lib/usage";
import { claimDueReminders, type DueReminder } from "@/lib/user-reminder-repo";
import { REPEAT_LABEL } from "@/lib/user-reminder";
import { runInZone } from "@/lib/zone-scope";

/** The cron takes a group's reminder this long after its time (until then a message may carry it). */
const RIDE_MS = 5 * 60_000;

export interface UserReminderRunSummary {
  claimed: number;
  sent: number;
  errors: number;
  /** Group reminders that could not be pushed, now waiting for the next message in the group. */
  late: number;
}

/** What the run needs from LINE. All but `push` may be absent (then a group's reminder goes late). */
export interface ReminderLine {
  push: (to: string, messages: LineMessage[]) => Promise<void>;
  /** Whether the person has พี่ฮูก as a friend, so a push to them arrives. */
  isFriend?: (lineUserId: string) => Promise<boolean>;
  groupMemberCount?: (lineGroupId: string) => Promise<number | null>;
  groupName?: (lineGroupId: string) => Promise<string | null>;
}

/**
 * Every minute: push the reminders that are due. Each is taken first (a one-off is marked done, a
 * repeating one moves to its next time), then pushed, so a failing push (the person blocked the bot)
 * is not retried every run, and two overlapping runs never send the same reminder twice.
 *
 * A group's reminder is taken 5 minutes after its time, when no message in the group picked it up
 * for free. Then it goes to the people it tags, one by one (one message each), or else to the group
 * within the owner's monthly allowance; past that it waits for the next message in the group.
 */
export async function runUserReminders(
  db: SupabaseClient,
  line: ReminderLine,
  now: Date,
  liffUrl?: string,
): Promise<UserReminderRunSummary> {
  const summary: UserReminderRunSummary = { claimed: 0, sent: 0, errors: 0, late: 0 };
  await purgeLateReminders(db, now).catch((e) => log.error("late_reminders_purge_failed", e));
  const due = await claimDueReminders(db, now);
  summary.claimed = due.length;
  const groupIds = due.filter((r) => r.lineGroupId && r.groupOpen).map((r) => r.id);
  // they are already taken: a failure here must not cost the others (a group's then goes untagged)
  const targets =
    groupIds.length > 0
      ? await reminderTargets(db, groupIds).catch((e) => {
          log.error("reminder_targets_failed", e);
          return new Map<string, { groupId: string | null; mentions: Mention[] }>();
        })
      : new Map<string, { groupId: string | null; mentions: Mention[] }>();

  // a personal reminder speaks the person's language (a group's stays Thai)
  const people = await peopleOf(
    db,
    due.filter((r) => !r.lineGroupId).map((r) => r.userId),
  );

  for (const r of due) {
    // a group's reminder goes to the group, and not at all once the bot has left it
    if (r.lineGroupId && !r.groupOpen) continue;
    try {
      if (r.lineGroupId) {
        const target = targets.get(r.id) ?? { groupId: null, mentions: [] };
        const outcome = await sendGroupReminder(db, line, r, r.lineGroupId, target, now);
        if (outcome === "late") summary.late += 1;
        else summary.sent += 1;
        continue;
      }
      const person = people.get(r.userId);
      await runInZone(
        person?.timezone,
        () =>
          line.push(r.lineUserId, [
            {
              type: "text",
              text: reminderPushText(r.body, r.repeat ? REPEAT_LABEL[r.repeat] : null, liffUrl),
              quickReply: reminderActions(r.id),
            },
          ]),
        person?.currency,
        person?.locale,
      );
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

async function sendGroupReminder(
  db: SupabaseClient,
  line: ReminderLine,
  r: DueReminder,
  lineGroupId: string,
  target: { groupId: string | null; mentions: Mention[] },
  now: Date,
): Promise<"sent" | "late"> {
  const repeatLabel = r.repeat ? REPEAT_LABEL[r.repeat] : null;
  const people = target.mentions.filter((m) => m.userId);
  const everyone = target.mentions.some((m) => m.all);

  const month = monthKey(now);
  // the owner's plan sets the month's allowance; a plan that cannot be read gives none, so the
  // reminder waits for the next message in the group rather than being lost
  const allowance = await getUserPlanRow(db, r.userId)
    .then((row) => GROUP_PUSH_PER_MONTH[effectivePlan(row.plan, row.plan_expires_at, now)])
    .catch((e) => {
      log.error("group_push_plan_failed", e);
      return 0;
    });
  // every message pushed counts against the owner's allowance; a counter that cannot be reached
  // counts as no room, so the reminder waits rather than being lost
  const take = (amount: number) =>
    takeUsageAmount(db, r.userId, "group_push", amount, allowance, month).catch((e) => {
      log.error("group_push_count_failed", e);
      return false;
    });
  const giveBack = (amount: number) =>
    refundUsageAmount(db, r.userId, "group_push", amount, month).catch(() => undefined);

  // 1. tagged people only: one message each, to those who have พี่ฮูก as a friend
  let unreached: Mention[] = target.mentions;
  if (people.length > 0 && !everyone && line.isFriend) {
    const name = await line.groupName?.(lineGroupId).catch(() => null);
    const text = groupReminderDirectText(name ?? null, r.body, repeatLabel);
    unreached = [];
    for (const person of people) {
      const id = person.userId;
      let reached = false;
      if (id && (await line.isFriend(id).catch(() => false)) && (await take(1))) {
        reached = await line
          .push(id, [{ type: "text", text }])
          .then(() => true)
          .catch(() => false);
        if (!reached) await giveBack(1);
      }
      if (!reached) unreached.push(person);
    }
    if (unreached.length === 0) return "sent";
  }

  // 2. the group, tagging whoever was not reached, within the owner's monthly allowance
  const members = await line.groupMemberCount?.(lineGroupId).catch(() => null);
  if (members && (await take(members))) {
    const { tagged, plain } = groupReminderMessage([
      { body: r.body, repeat: r.repeat, mentions: unreached },
    ]);
    try {
      // plain text only when LINE turned the tagged form down: any other failure may have been sent
      await line.push(lineGroupId, [tagged]).catch((error: unknown) => {
        if (!refusedAsMalformed(error)) throw error;
        return line.push(lineGroupId, [plain]);
      });
      return "sent";
    } catch (error) {
      log.warn("group_reminder_push_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      await giveBack(members);
    }
  }

  // 3. wait for the next message in the group (for 12 hours)
  const groupId = target.groupId ?? (await getGroup(db, lineGroupId))?.id;
  if (!groupId) throw new Error("group reminder without its group");
  await addLateReminder(db, {
    groupId,
    body: r.body,
    repeat: r.repeat,
    mentions: target.mentions,
    dueAt: new Date(Math.floor((now.getTime() - RIDE_MS) / 60_000) * 60_000),
  });
  return "late";
}

/** The zone, currency and language of these people (none when they cannot be read: Thai, Bangkok). */
async function peopleOf(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, { timezone?: string; currency?: string; locale?: string }>> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await db
      .from("users")
      .select("id,timezone,currency,locale")
      .in("id", [...new Set(ids)]);
    if (error) throw new Error(error.message);
    return new Map(
      ((data ?? []) as { id: string; timezone?: string; currency?: string; locale?: string }[]).map(
        (u) => [u.id, u],
      ),
    );
  } catch (error) {
    log.error("reminder_people_failed", error);
    return new Map();
  }
}
