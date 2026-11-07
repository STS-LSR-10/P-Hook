import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CHASE, parseChase, type ChaseSchedule } from "@/lib/chase-schedule";
import type { GroupEntryRow, GroupRow, TripRow } from "@/lib/group";
import type { SplitMode } from "@/lib/trip";
import { satangToString, toSatang } from "@/lib/money";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

interface GroupDb {
  id: string;
  line_group_id: string;
  owner_user_id: string;
  is_active: boolean;
}
const toGroup = (r: GroupDb): GroupRow => ({
  id: r.id,
  lineGroupId: r.line_group_id,
  ownerUserId: r.owner_user_id,
  isActive: r.is_active,
});

/** The ledger of a LINE group (open or closed), or null if it was never opened. */
export async function getGroup(db: SupabaseClient, lineGroupId: string): Promise<GroupRow | null> {
  const { data, error } = await db
    .from("bot_groups")
    .select("id,line_group_id,owner_user_id,is_active")
    .eq("line_group_id", lineGroupId)
    .maybeSingle();
  if (error) fail("get group", error);
  return data ? toGroup(data as GroupDb) : null;
}

/** A ledger by its own id (the one a page link carries). */
export async function getGroupById(db: SupabaseClient, id: string): Promise<GroupRow | null> {
  const { data, error } = await db
    .from("bot_groups")
    .select("id,line_group_id,owner_user_id,is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("get group by id", error);
  return data ? toGroup(data as GroupDb) : null;
}

/** How many open ledgers this person owns. */
export async function countOwnedGroups(db: SupabaseClient, ownerUserId: string): Promise<number> {
  const { count, error } = await db
    .from("bot_groups")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", ownerUserId)
    .eq("is_active", true);
  if (error) fail("count owned groups", error);
  return count ?? 0;
}

/** Open a ledger for the group, or reopen a closed one under a (new) owner. */
export async function openGroup(
  db: SupabaseClient,
  lineGroupId: string,
  ownerUserId: string,
): Promise<GroupRow> {
  const { data, error } = await db
    .from("bot_groups")
    .upsert(
      { line_group_id: lineGroupId, owner_user_id: ownerUserId, is_active: true, closed_at: null },
      { onConflict: "line_group_id" },
    )
    .select("id,line_group_id,owner_user_id,is_active")
    .single();
  if (error) fail("open group", error);
  return toGroup(data as GroupDb);
}

/** Close the ledger (the data stays). Used when the owner says so or the bot leaves the group. */
export async function closeGroup(db: SupabaseClient, lineGroupId: string): Promise<void> {
  const { error } = await db
    .from("bot_groups")
    .update({ is_active: false, closed_at: new Date().toISOString() })
    .eq("line_group_id", lineGroupId);
  if (error) fail("close group", error);
}

/** Members who left the LINE group: they no longer see its files and reminders. */
export async function removeMembers(
  db: SupabaseClient,
  groupId: string,
  lineUserIds: string[],
): Promise<void> {
  if (lineUserIds.length === 0) return;
  const { error } = await db
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .in("line_user_id", lineUserIds);
  if (error) fail("remove members", error);
}

export async function upsertMember(
  db: SupabaseClient,
  groupId: string,
  lineUserId: string,
  displayName: string,
): Promise<void> {
  const { error } = await db.from("group_members").upsert(
    {
      group_id: groupId,
      line_user_id: lineUserId,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "group_id,line_user_id" },
  );
  if (error) fail("save member", error);
}

/** Known members of the group: LINE user id -> the name shown. */
export async function memberNames(
  db: SupabaseClient,
  groupId: string,
): Promise<Map<string, { name: string; updatedAt: string }>> {
  const { data, error } = await db
    .from("group_members")
    .select("line_user_id,display_name,updated_at")
    .eq("group_id", groupId);
  if (error) fail("load members", error);
  return new Map(
    ((data ?? []) as { line_user_id: string; display_name: string; updated_at: string }[]).map(
      (r) => [r.line_user_id, { name: r.display_name, updatedAt: r.updated_at }],
    ),
  );
}

export interface NewGroupEntry {
  title: string;
  amountSatang: number;
  occurredAt: Date;
  raw: string;
  tripId?: string | null;
  splitMode?: SplitMode;
  splitUsers?: string[];
  foreign?: { currency: string; minor: number; rate: number } | null;
}

export async function addEntries(
  db: SupabaseClient,
  groupId: string,
  payerLineUserId: string,
  entries: NewGroupEntry[],
): Promise<GroupEntryRow[]> {
  const { data, error } = await db
    .from("group_entries")
    .insert(
      entries.map((e) => ({
        group_id: groupId,
        payer_line_user_id: payerLineUserId,
        title: e.title,
        amount: satangToString(e.amountSatang),
        occurred_at: e.occurredAt.toISOString(),
        raw_text: e.raw,
        // the trip / currency columns are only sent when used (works before migration 0028)
        ...(e.tripId ? { trip_id: e.tripId } : {}),
        ...(e.splitMode && e.splitMode !== "all" ? { split_mode: e.splitMode } : {}),
        ...(e.splitUsers && e.splitUsers.length > 0 ? { split_users: e.splitUsers } : {}),
        ...(e.foreign
          ? {
              orig_currency: e.foreign.currency,
              orig_amount: satangToString(e.foreign.minor),
              fx_rate: e.foreign.rate,
            }
          : {}),
      })),
    )
    .select(ENTRY_COLUMNS);
  if (error) fail("add group entries", error);
  return ((data ?? []) as EntryDb[]).map(toEntry);
}

const ENTRY_COLUMNS =
  "id,payer_line_user_id,title,amount,occurred_at,trip_id,split_users,orig_currency,orig_amount,fx_rate";

interface EntryDb {
  id: string;
  payer_line_user_id: string;
  title: string;
  amount: number | string;
  occurred_at: string;
  trip_id?: string | null;
  split_users?: string[] | null;
  orig_currency?: string | null;
  orig_amount?: number | string | null;
  fx_rate?: number | string | null;
}
const toEntry = (r: EntryDb): GroupEntryRow => ({
  id: r.id,
  payerLineUserId: r.payer_line_user_id,
  title: r.title,
  amountSatang: toSatang(r.amount),
  occurredAt: r.occurred_at,
  tripId: r.trip_id ?? null,
  splitUsers: r.split_users ?? [],
  origCurrency: r.orig_currency ?? null,
  origMinor: r.orig_amount === null || r.orig_amount === undefined ? null : toSatang(r.orig_amount),
  fxRate: r.fx_rate === null || r.fx_rate === undefined ? null : Number(r.fx_rate),
});

/** The newest entries (not deleted) first; `payer` limits it to one member. */
export async function recentEntries(
  db: SupabaseClient,
  groupId: string,
  limit: number,
  payer?: string,
): Promise<GroupEntryRow[]> {
  let query = db
    .from("group_entries")
    .select(ENTRY_COLUMNS)
    .eq("group_id", groupId)
    .eq("status", "confirmed");
  if (payer) query = query.eq("payer_line_user_id", payer);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error) fail("recent group entries", error);
  return ((data ?? []) as EntryDb[]).map(toEntry);
}

export async function getEntry(
  db: SupabaseClient,
  groupId: string,
  id: string,
): Promise<GroupEntryRow | null> {
  const { data, error } = await db
    .from("group_entries")
    .select(ENTRY_COLUMNS)
    .eq("group_id", groupId)
    .eq("id", id)
    .eq("status", "confirmed")
    .maybeSingle();
  if (error) fail("get group entry", error);
  return data ? toEntry(data as EntryDb) : null;
}

export async function deleteEntry(
  db: SupabaseClient,
  groupId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("group_entries")
    .update({ status: "deleted" })
    .eq("group_id", groupId)
    .eq("id", id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();
  if (error) fail("delete group entry", error);
  return data !== null;
}

/** What each member paid between two moments, biggest first. */
export async function payerTotals(
  db: SupabaseClient,
  groupId: string,
  from: Date,
  to: Date,
): Promise<{ lineUserId: string; totalSatang: number; entries: number }[]> {
  const { data, error } = await db.rpc("group_payer_totals", {
    p_group: groupId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) fail("group payer totals", error);
  return (
    (data ?? []) as {
      payer_line_user_id: string;
      total: number | string;
      entries: number | string;
    }[]
  ).map((r) => ({
    lineUserId: r.payer_line_user_id,
    totalSatang: toSatang(r.total),
    entries: Number(r.entries),
  }));
}

/** Entries written to the group since `since` (for the daily cap). */
export async function countEntriesSince(
  db: SupabaseClient,
  groupId: string,
  since: Date,
): Promise<number> {
  const { count, error } = await db
    .from("group_entries")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId)
    .gte("created_at", since.toISOString());
  if (error) fail("count group entries", error);
  return count ?? 0;
}

/** The owner of a ledger: their LINE id (to know who is asking) and plan (the ledger needs Elite). */
export async function getOwner(
  db: SupabaseClient,
  ownerUserId: string,
): Promise<{ lineUserId: string; plan: string; planExpiresAt: string | null } | null> {
  const { data, error } = await db
    .from("users")
    .select("line_user_id,plan,plan_expires_at")
    .eq("id", ownerUserId)
    .maybeSingle();
  if (error) fail("load group owner", error);
  const r = data as { line_user_id: string; plan: string; plan_expires_at: string | null } | null;
  return r ? { lineUserId: r.line_user_id, plan: r.plan, planExpiresAt: r.plan_expires_at } : null;
}

// ───────────── trips ─────────────

interface TripDb {
  id: string;
  group_id: string;
  name: string;
  started_by: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
}
const TRIP_COLUMNS = "id,group_id,name,started_by,status,created_at,closed_at";
const toTrip = (r: TripDb): TripRow => ({
  id: r.id,
  groupId: r.group_id,
  name: r.name,
  startedBy: r.started_by,
  status: r.status,
  createdAt: r.created_at,
  closedAt: r.closed_at,
});

/** The group's open trip, if there is one. */
export async function openTrip(db: SupabaseClient, groupId: string): Promise<TripRow | null> {
  const { data, error } = await db
    .from("group_trips")
    .select(TRIP_COLUMNS)
    .eq("group_id", groupId)
    .eq("status", "open")
    .maybeSingle();
  if (error) fail("get open trip", error);
  return data ? toTrip(data as TripDb) : null;
}

/** Start a trip. "exists" when one is already open. */
export async function createTrip(
  db: SupabaseClient,
  groupId: string,
  name: string,
  startedBy: string,
): Promise<TripRow | "exists"> {
  const { data, error } = await db
    .from("group_trips")
    .insert({ group_id: groupId, name, started_by: startedBy })
    .select(TRIP_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return "exists";
    fail("start trip", error);
  }
  return toTrip(data as TripDb);
}

export async function closeTrip(db: SupabaseClient, tripId: string): Promise<void> {
  const { error } = await db
    .from("group_trips")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", tripId)
    .eq("status", "open");
  if (error) fail("close trip", error);
}

/** Closed trips, newest first. */
export async function closedTrips(
  db: SupabaseClient,
  groupId: string,
  limit: number,
): Promise<TripRow[]> {
  const { data, error } = await db
    .from("group_trips")
    .select(TRIP_COLUMNS)
    .eq("group_id", groupId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(limit);
  if (error) fail("list closed trips", error);
  return ((data ?? []) as TripDb[]).map(toTrip);
}

/** Put a person on the trip (again is fine). */
export async function joinTrip(
  db: SupabaseClient,
  tripId: string,
  lineUserId: string,
): Promise<void> {
  const { error } = await db
    .from("group_trip_members")
    .upsert({ trip_id: tripId, line_user_id: lineUserId }, { onConflict: "trip_id,line_user_id" });
  if (error) fail("join trip", error);
}

export async function tripMembers(db: SupabaseClient, tripId: string): Promise<string[]> {
  const { data, error } = await db
    .from("group_trip_members")
    .select("line_user_id")
    .eq("trip_id", tripId)
    .order("joined_at", { ascending: true });
  if (error) fail("load trip members", error);
  return ((data ?? []) as { line_user_id: string }[]).map((r) => r.line_user_id);
}

/** Every entry of a trip (not deleted), oldest first. */
export async function tripEntries(db: SupabaseClient, tripId: string): Promise<GroupEntryRow[]> {
  const { data, error } = await db
    .from("group_entries")
    .select(ENTRY_COLUMNS)
    .eq("trip_id", tripId)
    .eq("status", "confirmed")
    .order("occurred_at", { ascending: true });
  if (error) fail("load trip entries", error);
  return ((data ?? []) as EntryDb[]).map(toEntry);
}

/** How this group's unpaid bills are chased. The default when never set, or before migration 0060. */
export async function getChaseSchedule(
  db: SupabaseClient,
  groupId: string,
): Promise<ChaseSchedule> {
  const { data, error } = await db
    .from("bot_groups")
    .select("chase_every_days,chase_window")
    .eq("id", groupId)
    .maybeSingle();
  // 42703: the column is not there yet (migration 0060 not run): the old daily reminder, as before
  if (error?.code === "42703") return DEFAULT_CHASE;
  if (error) fail("get chase schedule", error);
  if (!data) return DEFAULT_CHASE;
  const row = data as { chase_every_days: number; chase_window: string };
  return parseChase({ everyDays: row.chase_every_days, window: row.chase_window }) ?? DEFAULT_CHASE;
}

export async function setChaseSchedule(
  db: SupabaseClient,
  groupId: string,
  schedule: ChaseSchedule,
): Promise<void> {
  const { error } = await db
    .from("bot_groups")
    .update({ chase_every_days: schedule.everyDays, chase_window: schedule.window })
    .eq("id", groupId);
  if (error) fail("set chase schedule", error);
}

/** Fix the title or amount of a group entry that is still there; false when it is gone. */
export async function updateEntry(
  db: SupabaseClient,
  groupId: string,
  id: string,
  patch: { title?: string; amountSatang?: number },
): Promise<boolean> {
  const { data, error } = await db
    .from("group_entries")
    .update({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      // a new amount is no longer "original amount x rate", so the foreign-currency note goes
      ...(patch.amountSatang !== undefined
        ? {
            amount: satangToString(patch.amountSatang),
            orig_currency: null,
            orig_amount: null,
            fx_rate: null,
          }
        : {}),
    })
    .eq("group_id", groupId)
    .eq("id", id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();
  if (error) fail("update group entry", error);
  return data !== null;
}
