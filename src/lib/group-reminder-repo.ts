import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mention } from "@/lib/group-mention";
import type { Repeat } from "@/lib/user-reminder";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

/** How long around its time a reminder rides on a message in the group (for free) instead of a push. */
export const RIDE_WINDOW = "5 minutes";
/** How long a reminder that could not be pushed waits for the next message in the group. */
const LATE_FOR_MS = 12 * 3_600_000;

/** A group's reminder taken to go with a reply. `late`: its push could not be sent at its time. */
export interface Rider {
  body: string;
  repeat: Repeat | null;
  mentions: Mention[];
  dueAt: string;
  late: boolean;
}

/**
 * Someone wrote in the group: take its reminders due within 5 minutes either side of now, and those
 * waiting since their push could not go. Each is taken once (a repeating one moves to its next time).
 */
export async function takeGroupRiders(
  db: SupabaseClient,
  lineGroupId: string,
  now: Date,
): Promise<Rider[]> {
  const { data, error } = await db.rpc("take_group_reminders_near", {
    p_line_group: lineGroupId,
    p_now: now.toISOString(),
    p_window: RIDE_WINDOW,
  });
  if (error) fail("take group reminders", error);
  return (
    (data ?? []) as {
      r_body: string;
      r_repeat: Repeat | null;
      r_mentions: Mention[] | null;
      r_due: string;
      r_late: boolean;
    }[]
  ).map((r) => ({
    body: r.r_body,
    repeat: r.r_repeat,
    mentions: r.r_mentions ?? [],
    dueAt: r.r_due,
    late: r.r_late === true,
  }));
}

/** The group (its own id) and the tags of each reminder the cron took. */
export async function reminderTargets(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, { groupId: string | null; mentions: Mention[] }>> {
  const out = new Map<string, { groupId: string | null; mentions: Mention[] }>();
  if (ids.length === 0) return out;
  const { data, error } = await db
    .from("user_reminders")
    .select("id,group_id,mentions")
    .in("id", ids);
  if (error) fail("reminder targets", error);
  for (const r of (data ?? []) as {
    id: string;
    group_id: string | null;
    mentions: Mention[] | null;
  }[]) {
    out.set(r.id, { groupId: r.group_id, mentions: r.mentions ?? [] });
  }
  return out;
}

/** A reminder that could not be pushed: it goes with the next reply in the group, for 12 hours. */
export async function addLateReminder(
  db: SupabaseClient,
  input: {
    groupId: string;
    body: string;
    repeat: Repeat | null;
    mentions: Mention[];
    dueAt: Date;
  },
): Promise<void> {
  const { error } = await db.from("group_late_reminders").insert({
    group_id: input.groupId,
    body: input.body,
    repeat: input.repeat,
    mentions: input.mentions,
    due_at: input.dueAt.toISOString(),
    expires_at: new Date(input.dueAt.getTime() + LATE_FOR_MS).toISOString(),
  });
  if (error) fail("add late reminder", error);
}

/** Forget the waiting reminders whose 12 hours are over. */
export async function purgeLateReminders(db: SupabaseClient, now: Date): Promise<void> {
  const { error } = await db
    .from("group_late_reminders")
    .delete()
    .lt("expires_at", now.toISOString());
  if (error) fail("purge late reminders", error);
}

/** A reminder as an "add to calendar" link shows it: still waiting, or not. */
export async function getCalendarReminder(
  db: SupabaseClient,
  id: string,
): Promise<{ body: string; remindAt: string; repeat: Repeat | null; active: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db
    .from("user_reminders")
    .select("body,remind_at,repeat,status")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("calendar reminder", error);
  if (!data) return null;
  const r = data as { body: string; remind_at: string; repeat: Repeat | null; status: string };
  return { body: r.body, remindAt: r.remind_at, repeat: r.repeat, active: r.status === "active" };
}
