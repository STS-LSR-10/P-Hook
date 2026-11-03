import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";

/** A ledger its owner can switch the vault and reminders pages to. */
export interface OwnedGroup {
  id: string;
  name: string;
  isActive: boolean;
}

/** The name of a LINE group, or null when LINE does not say (the bot left it, say). */
export type GroupNameLookup = (lineGroupId: string) => Promise<string | null>;

/** Enough for anyone: every open ledger first, then the most recently closed ones that keep files. */
const MAX_GROUPS = 20;
/** Closed ledgers asked about at once, for whether they keep files. */
const CLOSED_BATCH = 10;

/**
 * The ledgers this person owns that have something to show: every open one, and a closed one that
 * still keeps files (they take the owner's space, so the owner can still remove them). Named as LINE
 * names the group, or "กลุ่ม N" when it cannot.
 */
export async function listOwnedGroups(
  db: SupabaseClient,
  userId: string,
  nameOf: GroupNameLookup,
): Promise<OwnedGroup[]> {
  type Row = { id: string; line_group_id: string; is_active: boolean };
  const rowsOf = async (active: boolean): Promise<Row[]> => {
    const { data, error } = await db
      .from("bot_groups")
      .select("id,line_group_id,is_active")
      .eq("owner_user_id", userId)
      .eq("is_active", active)
      .order(active ? "created_at" : "closed_at", { ascending: active });
    if (error) throw new Error(`list owned groups: ${error.message}`);
    return (data ?? []) as Row[];
  };
  const [open, closed] = await Promise.all([rowsOf(true), rowsOf(false)]);

  // a closed ledger counts only while it keeps files; asked a few at a time, newest closed first,
  // so a ledger with files is found however many empty ones were closed after it
  const shown = open.slice(0, MAX_GROUPS);
  for (let i = 0; i < closed.length && shown.length < MAX_GROUPS; i += CLOSED_BATCH) {
    const batch = closed.slice(i, i + CLOSED_BATCH);
    const kept = await Promise.all(
      batch.map(async (row) => {
        const { count, error } = await db
          .from("stored_files")
          .select("id", { count: "exact", head: true })
          .eq("group_id", row.id);
        if (error) throw new Error(`count group files: ${error.message}`);
        return (count ?? 0) > 0;
      }),
    );
    shown.push(...batch.filter((_, j) => kept[j]).slice(0, MAX_GROUPS - shown.length));
  }

  const names = await Promise.all(
    shown.map((row) =>
      nameOf(row.line_group_id).catch((err: unknown) => {
        log.warn("group_name_failed", { reason: safeMessage(err) });
        return null;
      }),
    ),
  );
  return shown.map((row, i) => ({
    id: row.id,
    name: names[i]?.trim() || `กลุ่ม ${i + 1}`,
    isActive: row.is_active,
  }));
}
