import type { SupabaseClient } from "@supabase/supabase-js";
import { withExtensionOf, type FileDto, type FileKind, type MediaKind } from "@/lib/file";
import { escapeLike } from "@/lib/note-repo";

const WAIT_MS = 5 * 60_000;
const RECENT_MS = 30 * 60_000;
const MAX_RECENT = 5;

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

interface FileRow {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number | string;
  r2_key: string;
  created_at: string;
  has_thumb?: boolean;
}
const COLUMNS = "id,name,mime_type,size_bytes,r2_key,created_at,has_thumb";
const toDto = (r: FileRow): FileDto => ({
  id: r.id,
  name: r.name,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  createdAt: r.created_at,
  hasThumb: r.has_thumb === true,
});

/** Reserve the space and add the row as pending. False when it would pass `capacity`. */
export async function reserveFile(
  db: SupabaseClient,
  input: {
    id: string;
    userId: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    r2Key: string;
    capacity: number;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc("file_reserve", {
    p_id: input.id,
    p_user: input.userId,
    p_name: input.name,
    p_mime: input.mimeType,
    p_size: input.sizeBytes,
    p_key: input.r2Key,
    p_capacity: input.capacity,
  });
  if (error) fail("reserve file", error);
  return data === true;
}

export async function markFileReady(
  db: SupabaseClient,
  userId: string,
  id: string,
  hasThumb: boolean,
): Promise<void> {
  const { error } = await db
    .from("stored_files")
    .update({ status: "ready", has_thumb: hasThumb })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) fail("mark file ready", error);
}

export async function dropFileRow(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await db.from("stored_files").delete().eq("id", id).eq("user_id", userId);
  if (error) fail("drop file row", error);
}

export async function getReadyFile(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<(FileDto & { r2Key: string }) | null> {
  const { data, error } = await db
    .from("stored_files")
    .select(COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) fail("get file", error);
  if (!data) return null;
  const row = data as FileRow;
  return { ...toDto(row), r2Key: row.r2_key };
}

/** Newest first. `q` keeps files whose name contains it; `before` pages back from a moment. */
export async function listFiles(
  db: SupabaseClient,
  userId: string,
  options: { q?: string; before?: string; limit?: number; kind?: FileKind } = {},
): Promise<{ items: FileDto[]; hasMore: boolean }> {
  const limit = options.limit ?? 30;
  let query = db
    .from("stored_files")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  const q = options.q?.trim();
  if (q) query = query.ilike("name", `%${escapeLike(q)}%`);
  if (options.kind === "image") query = query.like("mime_type", "image/%");
  if (options.kind === "file") query = query.not("mime_type", "like", "image/%");
  if (options.before) query = query.lt("created_at", options.before);
  const { data, error } = await query;
  if (error) fail("list files", error);
  const rows = (data ?? []) as FileRow[];
  return { items: rows.slice(0, limit).map(toDto), hasMore: rows.length > limit };
}

/** False when the file is not theirs (or is gone). */
export async function renameFile(
  db: SupabaseClient,
  userId: string,
  id: string,
  name: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("stored_files")
    .update({ name })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) fail("rename file", error);
  return data !== null;
}

/** Rename what they kept last: "ชื่อไฟล์ รูปบัตร" right after sending a picture. */
export async function renameLatestFile(
  db: SupabaseClient,
  userId: string,
  name: string,
): Promise<FileDto | null> {
  const { items } = await listFiles(db, userId, { limit: 1 });
  const [latest] = items;
  if (!latest) return null;
  const named = withExtensionOf(name, latest.name);
  return (await renameFile(db, userId, latest.id, named)) ? { ...latest, name: named } : null;
}

/** Bytes in use, pending files too, the same sum `file_reserve` makes. */
export async function fileUsage(db: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await db.rpc("file_usage", { p_user: userId });
  if (error) fail("file usage", error);
  return Number(data ?? 0);
}

export async function hasFiles(db: SupabaseClient, userId: string): Promise<boolean> {
  const { count, error } = await db
    .from("stored_files")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) fail("count files", error);
  return (count ?? 0) > 0;
}

/** Files that never finished: the upload died between the reserve and the end. */
export async function listStalePending(
  db: SupabaseClient,
  before: Date,
  limit = 200,
): Promise<{ id: string; userId: string; r2Key: string }[]> {
  const { data, error } = await db
    .from("stored_files")
    .select("id,user_id,r2_key")
    .eq("status", "pending")
    .lt("created_at", before.toISOString())
    .limit(limit);
  if (error) fail("list stale files", error);
  return ((data ?? []) as { id: string; user_id: string; r2_key: string }[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    r2Key: r.r2_key,
  }));
}

/** The next file they send should be kept, under `name` when one was given. */
export async function startFileWait(
  db: SupabaseClient,
  userId: string,
  name: string | null,
  now: Date,
): Promise<void> {
  const { error } = await db.from("file_waits").upsert(
    {
      user_id: userId,
      name,
      expires_at: new Date(now.getTime() + WAIT_MS).toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) fail("start file wait", error);
}

/** Take the wait for use, so only one file answers it. */
export async function takeFileWait(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ name: string | null } | null> {
  const { data, error } = await db
    .from("file_waits")
    .delete()
    .eq("user_id", userId)
    .gt("expires_at", now.toISOString())
    .select("name")
    .maybeSingle();
  if (error) fail("take file wait", error);
  return (data as { name: string | null } | null) ?? null;
}

export interface RecentMedia {
  id: string;
  messageId: string;
  kind: MediaKind;
  fileName: string | null;
  fileSize: number | null;
}

interface MediaRow {
  id: string;
  message_id: string;
  kind: MediaKind;
  file_name: string | null;
  file_size: number | string | null;
}
const MEDIA_COLUMNS = "id,message_id,kind,file_name,file_size";
const toMedia = (r: MediaRow): RecentMedia => ({
  id: r.id,
  messageId: r.message_id,
  kind: r.kind,
  fileName: r.file_name,
  fileSize: r.file_size === null ? null : Number(r.file_size),
});

/** Remember a file for a while, so a later "เก็บไว้" can reach it. Returns the id for its buttons. */
export async function rememberMedia(
  db: SupabaseClient,
  userId: string,
  media: Omit<RecentMedia, "id">,
  now: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await db.from("recent_media").upsert(
    {
      id,
      user_id: userId,
      message_id: media.messageId,
      kind: media.kind,
      file_name: media.fileName,
      file_size: media.fileSize,
      expires_at: new Date(now.getTime() + RECENT_MS).toISOString(),
    },
    { onConflict: "user_id,message_id" },
  );
  if (error) fail("remember media", error);
  return id;
}

/**
 * Take the newest files waiting and hand them back oldest first, for numbering. Deleting them here
 * means a second "เก็บไว้" finds nothing.
 */
export async function takeRecentMedia(
  db: SupabaseClient,
  userId: string,
  now: Date,
  limit = MAX_RECENT,
): Promise<RecentMedia[]> {
  const { data, error } = await db
    .from("recent_media")
    .select("id")
    .eq("user_id", userId)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("list recent media", error);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return [];
  const taken = await db
    .from("recent_media")
    .delete()
    .eq("user_id", userId)
    .in("id", ids)
    .select(`${MEDIA_COLUMNS},created_at`);
  if (taken.error) fail("take recent media", taken.error);
  return ((taken.data ?? []) as (MediaRow & { created_at: string })[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(toMedia);
}

/** Look at a file without taking it: reading a PDF leaves it there to be kept. */
export async function getMediaById(
  db: SupabaseClient,
  userId: string,
  id: string,
  now: Date,
): Promise<RecentMedia | null> {
  const { data, error } = await db
    .from("recent_media")
    .select(MEDIA_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (error) fail("get media", error);
  return data ? toMedia(data as MediaRow) : null;
}

/** A slip that was recorded already lives with its entry. */
export async function forgetMedia(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await db.from("recent_media").delete().eq("user_id", userId).eq("id", id);
  if (error) fail("forget media", error);
}

export async function takeMediaById(
  db: SupabaseClient,
  userId: string,
  id: string,
  now: Date,
): Promise<RecentMedia | null> {
  const { data, error } = await db
    .from("recent_media")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .gt("expires_at", now.toISOString())
    .select(MEDIA_COLUMNS)
    .maybeSingle();
  if (error) fail("take media", error);
  return data ? toMedia(data as MediaRow) : null;
}

export async function purgeExpiredMedia(db: SupabaseClient, now: Date): Promise<void> {
  const media = await db.from("recent_media").delete().lte("expires_at", now.toISOString());
  if (media.error) fail("purge recent media", media.error);
  const waits = await db.from("file_waits").delete().lte("expires_at", now.toISOString());
  if (waits.error) fail("purge file waits", waits.error);
}
