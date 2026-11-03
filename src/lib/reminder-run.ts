import type { SupabaseClient } from "@supabase/supabase-js";
import { dueDebtsText } from "@/lib/debt";
import { listDebts } from "@/lib/debt-repo";
import { can, effectivePlan, type Plan } from "@/lib/plan";
import { bangkokDateKey, currentStreak, recentDailyKeys } from "@/lib/points";
import { isReminderDue, reminderText } from "@/lib/reminder";
import { dayRange } from "@/lib/budget-cycle";
import type { LineMessage } from "@/lib/types";
import { log } from "@/lib/log";
import { runInZone } from "@/lib/zone-scope";

export interface ReminderRunSummary {
  candidates: number;
  due: number;
  sent: number;
  skippedHadEntry: number;
  errors: number;
}

const BATCH = 1000;

/**
 * Push the daily nudge to Plus users who turned it on, whose chosen time has come, and who
 * have not recorded anything today. Run it often (hourly): each user is reminded at most once
 * per day (`last_reminded_on`). The time, "today" and the day's date are each person's own zone.
 */
export async function runReminders(
  db: SupabaseClient,
  push: (lineUserId: string, messages: LineMessage[]) => Promise<void>,
  now: Date,
): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = {
    candidates: 0,
    due: 0,
    sent: 0,
    skippedHadEntry: 0,
    errors: 0,
  };

  const settings = await db
    .from("user_settings")
    .select("user_id,daily_reminder_time,last_reminded_on,users(timezone,currency)")
    .eq("daily_reminder_enabled", true)
    .not("daily_reminder_time", "is", null)
    .limit(BATCH);
  if (settings.error) throw new Error(`load reminder settings: ${settings.error.message}`);
  const rows = (settings.data ?? []) as {
    user_id: string;
    daily_reminder_time: string;
    last_reminded_on: string | null;
    users: { timezone?: string | null; currency?: string | null } | null;
  }[];
  summary.candidates = rows.length;

  const zoneOf = (r: (typeof rows)[number]) => r.users?.timezone ?? null;
  const dueRows = rows.filter((r) =>
    runInZone(zoneOf(r), () =>
      isReminderDue({ now, time: r.daily_reminder_time, lastRemindedOn: r.last_reminded_on }),
    ),
  );
  summary.due = dueRows.length;
  if (dueRows.length === 0) return summary;

  const users = await db
    .from("users")
    .select("id,line_user_id,plan,plan_expires_at")
    .in(
      "id",
      dueRows.map((r) => r.user_id),
    );
  if (users.error) throw new Error(`load reminder users: ${users.error.message}`);
  const byId = new Map(
    (
      (users.data ?? []) as {
        id: string;
        line_user_id: string;
        plan: Plan;
        plan_expires_at: string | null;
      }[]
    ).map((u) => [u.id, u]),
  );

  for (const row of dueRows) {
    await runInZone(zoneOf(row), () => remindOne(row.user_id), row.users?.currency);
  }
  return summary;

  async function remindOne(userId: string): Promise<void> {
    const today = bangkokDateKey(now);
    const range = dayRange(now);
    const user = byId.get(userId);
    // Plus only (a lapsed Plus keeps its settings but stops getting reminders)
    if (!user || !can(effectivePlan(user.plan, user.plan_expires_at, now), "dailyReminder")) {
      return;
    }
    try {
      const entries = await db
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "confirmed")
        .gte("created_at", range.from.toISOString())
        .lt("created_at", range.to.toISOString());
      if (entries.error) throw new Error(`count today: ${entries.error.message}`);
      if ((entries.count ?? 0) > 0) {
        summary.skippedHadEntry += 1;
        return;
      }

      const streak = currentStreak(await recentDailyKeys(db, user.id), now);
      // Mark first: a failing push (blocked account) must not be retried every hour.
      const mark = await db
        .from("user_settings")
        .update({ last_reminded_on: today })
        .eq("user_id", user.id);
      if (mark.error) throw new Error(`mark reminded: ${mark.error.message}`);

      const messages: LineMessage[] = [{ type: "text", text: reminderText(now, streak) }];
      // Elite: debts that are overdue or due soon ride along (a failure here must not stop the nudge)
      if (can(effectivePlan(user.plan, user.plan_expires_at, now), "debts")) {
        const note = await listDebts(db, user.id)
          .then((debts) => dueDebtsText(debts, now))
          .catch((error: unknown) => {
            log.error("reminder_debts_failed", error);
            return null;
          });
        if (note) messages.push({ type: "text", text: note });
      }
      await push(user.line_user_id, messages);
      summary.sent += 1;
    } catch (error) {
      summary.errors += 1;
      log.error("reminder_failed", error);
    }
  }
}
