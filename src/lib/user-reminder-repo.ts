import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mention } from "@/lib/group-mention";
import type {
  ReminderCategory,
  ReminderDto,
  ReminderKind,
  ReminderStatus,
  Repeat,
} from "@/lib/user-reminder";

/** The finished reminders the page keeps showing. */
const MAX_DONE_SHOWN = 100;

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

interface Row {
  id: string;
  body: string;
  remind_at: string;
  repeat: Repeat | null;
  status?: ReminderStatus;
  category?: ReminderCategory | null;
}
const COLUMNS = "id,body,remind_at,repeat,status,category";
const toDto = (r: Row): ReminderDto => ({
  id: r.id,
  body: r.body,
  remindAt: r.remind_at,
  repeat: r.repeat,
  status: r.status ?? "active",
  category: r.category ?? null,
});

/** Reminders still waiting (not yet sent, or repeating), soonest first. */
export async function listReminders(
  db: SupabaseClient,
  userId: string,
  limit = 200,
): Promise<ReminderDto[]> {
  const { data, error } = await db
    .from("user_reminders")
    .select(COLUMNS)
    .eq("user_id", userId)
    .is("group_id", null)
    .eq("status", "active")
    .order("remind_at", { ascending: true })
    .limit(limit);
  if (error) fail("list reminders", error);
  return ((data ?? []) as Row[]).map(toDto);
}

/** For the page: all those waiting, and the latest ones finished. */
export async function listRemindersForPage(
  db: SupabaseClient,
  userId: string,
): Promise<ReminderDto[]> {
  const [waiting, finished] = await Promise.all([
    listReminders(db, userId),
    db
      .from("user_reminders")
      .select(COLUMNS)
      .eq("user_id", userId)
      .is("group_id", null)
      .eq("status", "done")
      .order("remind_at", { ascending: false })
      .limit(MAX_DONE_SHOWN),
  ]);
  if (finished.error) fail("list finished reminders", finished.error);
  return [...waiting, ...((finished.data ?? []) as Row[]).map(toDto)];
}

export async function getReminder(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<ReminderDto | null> {
  const { data, error } = await db
    .from("user_reminders")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .maybeSingle();
  if (error) fail("get reminder", error);
  return data ? toDto(data as Row) : null;
}

/**
 * Reminders waiting: all of them, or only the one-offs / the repeating ones (each has its own limit).
 * Those set in the person's groups count too: a group's reminders take its owner's limits.
 */
export async function countActiveReminders(
  db: SupabaseClient,
  userId: string,
  kind?: ReminderKind,
): Promise<number> {
  let query = db
    .from("user_reminders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  if (kind === "once") query = query.is("repeat", null);
  if (kind === "repeat") query = query.not("repeat", "is", null);
  const { count, error } = await query;
  if (error) fail("count reminders", error);
  return count ?? 0;
}

export async function createReminder(
  db: SupabaseClient,
  userId: string,
  input: {
    body: string;
    remindAt: Date;
    repeat: Repeat | null;
    category?: ReminderCategory | null;
    /** A reminder set in a group (pushed to the group): which one, and the LINE id of who set it. */
    groupId?: string;
    createdBy?: string;
    /** Who it tags in the group, tagged again when it is sent. */
    mentions?: Mention[];
  },
): Promise<ReminderDto> {
  const { data, error } = await db
    .from("user_reminders")
    .insert({
      user_id: userId,
      body: input.body,
      remind_at: input.remindAt.toISOString(),
      repeat: input.repeat,
      category: input.category ?? null,
      ...(input.groupId
        ? {
            group_id: input.groupId,
            created_by: input.createdBy ?? null,
            mentions: input.mentions?.length ? input.mentions : null,
          }
        : {}),
    })
    .select(COLUMNS)
    .single();
  if (error) fail("create reminder", error);
  return toDto(data as Row);
}

/** False when it is not theirs, or already gone. */
export async function cancelReminder(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("user_reminders")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .select("id")
    .maybeSingle();
  if (error) fail("cancel reminder", error);
  return data !== null;
}

/** Move a reminder that is still waiting. Null when it is not theirs, or has gone or been sent. */
export async function rescheduleReminder(
  db: SupabaseClient,
  userId: string,
  id: string,
  input: { remindAt: Date; repeat: Repeat | null },
): Promise<ReminderDto | null> {
  const { data, error } = await db
    .from("user_reminders")
    .update({
      remind_at: input.remindAt.toISOString(),
      repeat: input.repeat,
      last_sent_at: null,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .eq("status", "active")
    .select(COLUMNS)
    .maybeSingle();
  if (error) fail("reschedule reminder", error);
  return data ? toDto(data as Row) : null;
}

/** Rewrite a reminder. */
export async function updateReminder(
  db: SupabaseClient,
  userId: string,
  id: string,
  input: {
    body: string;
    remindAt: Date;
    repeat: Repeat | null;
    category: ReminderCategory | null;
    status: ReminderStatus;
  },
): Promise<ReminderDto | null> {
  const { data, error } = await db
    .from("user_reminders")
    .update({
      body: input.body,
      remind_at: input.remindAt.toISOString(),
      repeat: input.repeat,
      category: input.category,
      status: input.status,
      ...(input.status === "active" ? { last_sent_at: null } : {}),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error) fail("update reminder", error);
  return data ? toDto(data as Row) : null;
}

/**
 * Skip a round of a repeat, but only the round the person saw: a second tap, or a page left open
 * while the job moved on, must not lose the round after it. False when it has moved.
 */
export async function skipReminderRound(
  db: SupabaseClient,
  userId: string,
  id: string,
  from: string,
  to: Date,
): Promise<boolean> {
  const { data, error } = await db
    .from("user_reminders")
    .update({ remind_at: to.toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .eq("status", "active")
    .eq("remind_at", from)
    .select("id")
    .maybeSingle();
  if (error) fail("skip reminder round", error);
  return data !== null;
}

async function moveStatus(
  db: SupabaseClient,
  userId: string,
  id: string,
  from: ReminderStatus,
  to: ReminderStatus,
): Promise<boolean> {
  const { data, error } = await db
    .from("user_reminders")
    .update({ status: to })
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) fail("change reminder status", error);
  return data !== null;
}

/** Ticked before its time: it will not be sent. False when it was sent or changed meanwhile. */
export const setReminderDone = (db: SupabaseClient, userId: string, id: string) =>
  moveStatus(db, userId, id, "active", "done");

/** The tick taken back. */
export const reopenReminder = (db: SupabaseClient, userId: string, id: string) =>
  moveStatus(db, userId, id, "done", "active");

export type GroupReminder = ReminderDto & { createdBy: string | null };

/** A group's reminders still waiting, soonest first. */
export async function listGroupReminders(
  db: SupabaseClient,
  groupId: string,
  limit = 200,
): Promise<GroupReminder[]> {
  const { data, error } = await db
    .from("user_reminders")
    .select(`${COLUMNS},created_by`)
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("remind_at", { ascending: true })
    .limit(limit);
  if (error) fail("list group reminders", error);
  return ((data ?? []) as (Row & { created_by: string | null })[]).map((r) => ({
    ...toDto(r),
    createdBy: r.created_by,
  }));
}

/**
 * Finish a group's reminders still waiting, so they stop taking anyone's limits: when the ledger closes,
 * and when it changes hands (`exceptOwner`: the new owner's own stay).
 */
export async function endGroupReminders(
  db: SupabaseClient,
  groupId: string,
  exceptOwner?: string,
): Promise<void> {
  let query = db
    .from("user_reminders")
    .update({ status: "done" })
    .eq("group_id", groupId)
    .eq("status", "active");
  if (exceptOwner) query = query.neq("user_id", exceptOwner);
  const { error } = await query;
  if (error) fail("end group reminders", error);
}

/** False when it is not this group's, or already gone. */
export async function cancelGroupReminder(
  db: SupabaseClient,
  groupId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("user_reminders")
    .delete()
    .eq("id", id)
    .eq("group_id", groupId)
    .select("id")
    .maybeSingle();
  if (error) fail("cancel group reminder", error);
  return data !== null;
}

export interface DueReminder {
  id: string;
  userId: string;
  lineUserId: string;
  body: string;
  repeat: Repeat | null;
  /** The LINE group it goes to (null: to the person). */
  lineGroupId: string | null;
  /** False when the bot has left that group: taken, but not sent. */
  groupOpen: boolean;
}

/** Take the reminders due at `now` (each one once; repeating ones are moved to their next time). */
export async function claimDueReminders(
  db: SupabaseClient,
  now: Date,
  limit = 200,
): Promise<DueReminder[]> {
  const { data, error } = await db.rpc("claim_due_reminders_with_groups", {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (error) fail("claim due reminders", error);
  return (
    (data ?? []) as {
      r_id: string;
      r_user: string;
      r_line: string;
      r_body: string;
      r_repeat: Repeat | null;
      r_group?: string | null;
      r_group_open?: boolean | null;
    }[]
  ).map((r) => ({
    id: r.r_id,
    userId: r.r_user,
    lineUserId: r.r_line,
    body: r.r_body,
    repeat: r.r_repeat,
    lineGroupId: r.r_group ?? null,
    groupOpen: r.r_group_open === true,
  }));
}
