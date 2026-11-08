import type { SupabaseClient } from "@supabase/supabase-js";
import { thumbKey } from "@/lib/file";
import { groupFileKeys } from "@/lib/file-repo";
import type { FileStore } from "@/lib/file-store";
import {
  deleteGroupRow,
  getGroup,
  getOwner,
  listActiveGroups,
  listGroupsLeftBefore,
  markGroupLeft,
} from "@/lib/group-repo";
import { GROUP_LEFT_TEXT, text } from "@/lib/line/messages";
import { log, safeMessage } from "@/lib/log";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { endGroupReminders } from "@/lib/user-reminder-repo";

/** How long a group's data is kept after the bot is taken out of it. */
export const GROUP_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
/** Groups asked about per hourly run; the rest follow in later runs, so every group is asked in turn. */
const CHECK_PER_RUN = 40;
const PURGE_LIMIT = 20;
const DELETE_CHUNK = 500;

type Push = (lineUserId: string, messages: LineMessage[]) => Promise<void>;
/** Is the bot still in this LINE group? null when LINE does not say clearly. */
export type BotInGroup = (lineGroupId: string) => Promise<boolean | null>;

/**
 * The bot is no longer in this group: close its ledger (the count of groups goes down), stop its
 * reminders, and tell the owner how long the data is kept. Does nothing for a ledger that is already
 * closed, so an owner's own "ปิดสมุด" is never turned into a deletion date.
 */
export async function handleBotLeft(
  db: SupabaseClient,
  lineGroupId: string,
  now: Date,
  push?: Push,
): Promise<void> {
  const group = await getGroup(db, lineGroupId);
  if (!group) return;
  if (!(await markGroupLeft(db, lineGroupId, now))) return;
  try {
    await endGroupReminders(db, group.id);
  } catch (error) {
    // the ledger is closed already; a retry would find it closed and do nothing, so this is only logged
    log.warn("group_left_reminders_failed", { reason: safeMessage(error) });
  }
  if (!push) return;
  try {
    const owner = await getOwner(db, group.ownerUserId);
    if (!owner) return;
    const until = formatThaiDate(new Date(now.getTime() + GROUP_KEEP_DAYS * DAY_MS));
    await push(owner.lineUserId, [text(GROUP_LEFT_TEXT(until))]);
  } catch (error) {
    log.warn("group_left_notice_failed", { reason: safeMessage(error) });
  }
}

/**
 * Hourly: an event can be missed (LINE down, our webhook failing), so ask LINE about every open ledger
 * and close the ones whose group the bot is no longer in. An unclear answer changes nothing.
 */
export async function reconcileGroups(
  db: SupabaseClient,
  isBotIn: BotInGroup,
  push: Push | undefined,
  now: Date,
): Promise<{ closed: number }> {
  const all = await listActiveGroups(db);
  // a window of the list that moves on each hour, so a large list is asked about in turn
  const start =
    all.length === 0 ? 0 : (Math.floor(now.getTime() / 3_600_000) * CHECK_PER_RUN) % all.length;
  const batch = [...all.slice(start), ...all.slice(0, start)].slice(0, CHECK_PER_RUN);
  let closed = 0;
  for (const group of batch) {
    try {
      if ((await isBotIn(group.lineGroupId)) !== false) continue;
      await handleBotLeft(db, group.lineGroupId, now, push);
      closed += 1;
    } catch (error) {
      log.warn("group_reconcile_failed", { reason: safeMessage(error) });
    }
  }
  return { closed };
}

/**
 * Delete for good the groups the bot left 30 days ago or more: the group itself first (it takes its
 * entries, members, bills, notes and reminders with it, and only goes if nobody opened it again), then
 * its files.
 */
export async function purgeLeftGroups(
  db: SupabaseClient,
  store: FileStore | null,
  now: Date,
  isBotIn?: BotInGroup,
): Promise<{ purged: number; skipped: number }> {
  const before = new Date(now.getTime() - GROUP_KEEP_DAYS * DAY_MS);
  let purged = 0;
  let skipped = 0;
  for (const group of await listGroupsLeftBefore(db, before, PURGE_LIMIT)) {
    try {
      // the bot is back in the group (and the owner just has not typed "เปิดสมุดกลุ่ม" yet): not ours to delete
      if (isBotIn && (await isBotIn(group.lineGroupId)) === true) {
        skipped += 1;
        continue;
      }
      const keys = await groupFileKeys(db, group.id);
      if (keys.length > 0 && !store) {
        skipped += 1; // nowhere to delete the objects from: wait rather than leave them behind
        continue;
      }
      // the row first, and only if nobody opened the group again meanwhile: whoever rescues the group
      // at the last minute keeps their files
      if (!(await deleteGroupRow(db, group.id, before))) {
        skipped += 1;
        continue;
      }
      purged += 1;
      if (store && keys.length > 0) {
        const all = keys.flatMap((k) => [k, thumbKey(k)]);
        try {
          for (let i = 0; i < all.length; i += DELETE_CHUNK) {
            await store.delete(all.slice(i, i + DELETE_CHUNK));
          }
        } catch (error) {
          // the group is gone; objects that could not be removed are only a leak of space
          log.warn("group_purge_files_leaked", { files: keys.length, reason: safeMessage(error) });
        }
      }
    } catch (error) {
      log.warn("group_purge_failed", { reason: safeMessage(error) });
      skipped += 1;
    }
  }
  return { purged, skipped };
}
