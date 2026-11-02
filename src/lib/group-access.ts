import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupRow } from "@/lib/group";
import { getGroupById, memberNames, upsertMember } from "@/lib/group-repo";
import { log, safeMessage } from "@/lib/log";

const NAME_FALLBACK = "สมาชิกกลุ่ม";

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
 * May this person see a group's files and reminders? Its owner may, and so may a member the bot knows.
 * Anyone else is asked about at LINE, and remembered when LINE says they are in the group. Null for a
 * ledger that is closed or was never opened, and for anyone else.
 */
export async function groupForViewer(
  db: SupabaseClient,
  groupId: string,
  viewer: { userId: string; lineUserId: string },
  check: MemberCheck,
): Promise<GroupViewer | null> {
  const group = await getGroupById(db, groupId);
  if (!group || !group.isActive) return null;
  if (group.ownerUserId === viewer.userId) return { group, isOwner: true };
  if ((await memberNames(db, group.id)).has(viewer.lineUserId)) return { group, isOwner: false };
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
    log.warn("group_member_check_failed", { reason: safeMessage(error) });
    return null;
  }
}
