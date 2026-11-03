import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteDto } from "@/lib/note";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

interface NoteRow {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
}
const COLUMNS = "id,body,created_at,updated_at";
const toDto = (r: NoteRow): NoteDto => ({
  id: r.id,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** `%`, `_` and `\` in what the person typed must match themselves in a LIKE search. */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Every note this person's limit covers: their own and those kept in the groups whose ledger they own
 * (one limit for both, as with files).
 */
export async function countNotes(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) fail("count notes", error);
  return count ?? 0;
}

/**
 * Their own notes (none kept in a group), newest first. `q` keeps notes that contain it (any case);
 * `before` pages back from a moment.
 */
export async function listNotes(
  db: SupabaseClient,
  userId: string,
  options: { q?: string; before?: string; limit?: number; links?: boolean } = {},
): Promise<{ items: NoteDto[]; hasMore: boolean }> {
  const limit = options.limit ?? 30;
  let query = db
    .from("notes")
    .select(COLUMNS)
    .eq("user_id", userId)
    .is("group_id", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  const q = options.q?.trim();
  if (q) query = query.ilike("body", `%${escapeLike(q)}%`);
  if (options.links) query = query.or("body.ilike.%http://%,body.ilike.%https://%");
  if (options.before) query = query.lt("created_at", options.before);
  const { data, error } = await query;
  if (error) fail("list notes", error);
  const rows = (data ?? []) as NoteRow[];
  return { items: rows.slice(0, limit).map(toDto), hasMore: rows.length > limit };
}

/** A note of their own, or one kept in a group (`createdBy` is the member's LINE id), on their limit. */
export async function createNote(
  db: SupabaseClient,
  userId: string,
  body: string,
  group?: { groupId: string; createdBy: string },
): Promise<NoteDto> {
  const { data, error } = await db
    .from("notes")
    .insert({
      user_id: userId,
      body,
      ...(group ? { group_id: group.groupId, created_by: group.createdBy } : {}),
    })
    .select(COLUMNS)
    .single();
  if (error) fail("create note", error);
  return toDto(data as NoteRow);
}

/** False when the note is not their own (or is gone, or kept in a group). */
export async function updateNote(
  db: SupabaseClient,
  userId: string,
  id: string,
  body: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("notes")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .select("id")
    .maybeSingle();
  if (error) fail("update note", error);
  return data !== null;
}

export async function deleteNote(db: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const { data, error } = await db
    .from("notes")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .is("group_id", null)
    .select("id")
    .maybeSingle();
  if (error) fail("delete note", error);
  return data !== null;
}

/** A note kept in a group: who wrote it (LINE id) and whose limit it is on. */
export interface GroupNote extends NoteDto {
  createdBy: string | null;
  userId: string;
}
const GROUP_COLUMNS = `${COLUMNS},created_by,user_id`;
const toGroupNote = (r: NoteRow & { created_by: string | null; user_id: string }): GroupNote => ({
  ...toDto(r),
  createdBy: r.created_by,
  userId: r.user_id,
});

/** A group's notes, newest first, whoever owned the ledger when each was written. */
export async function listGroupNotes(
  db: SupabaseClient,
  groupId: string,
  options: { q?: string; before?: string; limit?: number; links?: boolean } = {},
): Promise<{ items: GroupNote[]; hasMore: boolean }> {
  const limit = options.limit ?? 30;
  let query = db
    .from("notes")
    .select(GROUP_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  const q = options.q?.trim();
  if (q) query = query.ilike("body", `%${escapeLike(q)}%`);
  if (options.links) query = query.or("body.ilike.%http://%,body.ilike.%https://%");
  if (options.before) query = query.lt("created_at", options.before);
  const { data, error } = await query;
  if (error) fail("list group notes", error);
  const rows = (data ?? []) as (NoteRow & { created_by: string | null; user_id: string })[];
  return { items: rows.slice(0, limit).map(toGroupNote), hasMore: rows.length > limit };
}

export async function getGroupNote(
  db: SupabaseClient,
  groupId: string,
  id: string,
): Promise<GroupNote | null> {
  const { data, error } = await db
    .from("notes")
    .select(GROUP_COLUMNS)
    .eq("id", id)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) fail("get group note", error);
  return data
    ? toGroupNote(data as NoteRow & { created_by: string | null; user_id: string })
    : null;
}

/** False when the note is not in this group (or is gone). Who may change it is the caller's to check. */
export async function updateGroupNote(
  db: SupabaseClient,
  groupId: string,
  id: string,
  body: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("notes")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("group_id", groupId)
    .select("id")
    .maybeSingle();
  if (error) fail("update group note", error);
  return data !== null;
}

export async function deleteGroupNote(
  db: SupabaseClient,
  groupId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("notes")
    .delete()
    .eq("id", id)
    .eq("group_id", groupId)
    .select("id")
    .maybeSingle();
  if (error) fail("delete group note", error);
  return data !== null;
}

/** How many of this person's notes are kept in their groups (their own list does not show them). */
export async function countGroupNotes(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("group_id", "is", null);
  if (error) fail("count group notes", error);
  return count ?? 0;
}

/** A ledger that changed hands: its notes now count against the new owner's limit. */
export async function moveGroupNotes(
  db: SupabaseClient,
  groupId: string,
  ownerUserId: string,
): Promise<void> {
  const { error } = await db.from("notes").update({ user_id: ownerUserId }).eq("group_id", groupId);
  if (error) fail("move group notes", error);
}
