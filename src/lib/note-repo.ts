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

export async function countNotes(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) fail("count notes", error);
  return count ?? 0;
}

/** Newest first. `q` keeps notes that contain it (any case); `before` pages back from a moment. */
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

export async function createNote(
  db: SupabaseClient,
  userId: string,
  body: string,
): Promise<NoteDto> {
  const { data, error } = await db
    .from("notes")
    .insert({ user_id: userId, body })
    .select(COLUMNS)
    .single();
  if (error) fail("create note", error);
  return toDto(data as NoteRow);
}

/** False when the note is not theirs (or is gone). */
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
    .select("id")
    .maybeSingle();
  if (error) fail("delete note", error);
  return data !== null;
}
