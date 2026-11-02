import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupRow } from "@/lib/group";
import { getGroupById, memberNames, upsertMember } from "@/lib/group-repo";
import { log, safeMessage } from "@/lib/log";

const NAME_FALLBACK = "สมาชิกกลุ่ม";
/** A member the bot saw this recently is let in without asking LINE again. */
const FRESH_MS = 24 * 3_600_000;

/** Asks LINE whether someone is in a group: their profile there, or null when they are not. */
export type MemberCheck = (
  lineGroupId: string,
  lineUserId: string,
) => Promise<{ displayName?: string } | null>;

export interface GroupViewer {
  group: GroupRow;
  /** The owner of the ledger (whose space and limits the group uses). */
  isOwner: boolean;
}

/**
 * May this person see a group's files and reminders? Its owner may, and so may a member the bot saw in
 * the last day. Anyone else (a member seen long ago too: they may have left) is asked about at LINE,
 * and remembered when LINE says they are in the group. A closed ledger stays reachable, so what it kept
 * can still be removed. Null for a ledger never opened, and for anyone not in the group.
 */
export async function groupForViewer(
  db: SupabaseClient,
  groupId: string,
  viewer: { userId: string; lineUserId: string },
  check: MemberCheck,
  now: Date = new Date(),
): Promise<GroupViewer | null> {
  const group = await getGroupById(db, groupId);
  if (!group) return null;
  if (group.ownerUserId === viewer.userId) return { group, isOwner: true };
  const known = (await memberNames(db, group.id)).get(viewer.lineUserId);
  if (known && now.getTime() - new Date(known.updatedAt).getTime() < FRESH_MS) {
    return { group, isOwner: false };
  }
  try {
    const profile = await check(group.lineGroupId, viewer.lineUserId);
    if (!profile) return null;
    await upsertMember(
      db,
      group.id,
      viewer.lineUserId,
      profile.displayName?.trim() || NAME_FALLBACK,
    );
    return { group, isOwner: false };
  } catch (error) {
    // LINE could not be asked: a member the bot knows keeps access, nobody new gets it
    log.warn("group_member_check_failed", { reason: safeMessage(error) });
    return known ? { group, isOwner: false } : null;
  }
}
