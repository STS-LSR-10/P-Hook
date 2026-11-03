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

/** Enough for anyone; more than this many ledgers and the oldest are left out. */
const MAX_GROUPS = 20;

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
  const { data, error } = await db
    .from("bot_groups")
    .select("id,line_group_id,is_active")
    .eq("owner_user_id", userId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_GROUPS);
  if (error) throw new Error(`list owned groups: ${error.message}`);
  const rows = (data ?? []) as { id: string; line_group_id: string; is_active: boolean }[];

  const kept = await Promise.all(
    rows.map(async (row) => {
      if (row.is_active) return true;
      const { count, error: countError } = await db
        .from("stored_files")
        .select("id", { count: "exact", head: true })
        .eq("group_id", row.id);
      if (countError) throw new Error(`count group files: ${countError.message}`);
      return (count ?? 0) > 0;
    }),
  );
  const shown = rows.filter((_, i) => kept[i]);

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
