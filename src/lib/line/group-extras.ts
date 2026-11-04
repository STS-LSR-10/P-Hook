import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanOwlAnswer, MAX_QUESTION_LENGTH, needsPersonalData } from "@/lib/ai/owl";
import { fileCapacity, fileDayLimit, formatBytes, type FileDto } from "@/lib/file";
import {
  listGroupFiles as listFilesOfGroup,
  startGroupFileWait,
  takeGroupFileWait,
  type RecentMedia,
} from "@/lib/file-repo";
import { saveFile, type FileOwner, type SaveFailure } from "@/lib/file-save";
import type { GroupRow } from "@/lib/group";
import type { Mention } from "@/lib/group-mention";
import { loadGroupOwlFacts, renderGroupOwlContext } from "@/lib/group-owl-context";
import { log, safeMessage } from "@/lib/log";
import { cleanNoteBody, MAX_NOTE_LENGTH, noteCapacity, noteTitle } from "@/lib/note";
import {
  countNotes,
  createNote,
  deleteGroupNote,
  getGroupNote,
  listGroupNotes,
} from "@/lib/note-repo";
import { effectivePlan, OWL_LIMIT, type Plan } from "@/lib/plan";
import { LIMITS } from "@/lib/rate-limit";
import { looksSecret } from "@/lib/secret-text";
import type { LineMessage } from "@/lib/types";
import { monthKey, refundUsage, takeUsage } from "@/lib/usage";
import { capacityOf, parseReminder, reminderKind } from "@/lib/user-reminder";
import {
  cancelGroupReminder,
  countActiveReminders,
  createReminder,
  listGroupReminders,
} from "@/lib/user-reminder-repo";
import { buildFileResults, buildFilesSavedCard } from "./file-flex";
import type { HandlerDeps } from "./handlers";
import {
  FILE_BLOCKED_TEXT,
  FILE_FAILED_TEXT,
  FILE_GONE_TEXT,
  FILE_TOO_LARGE_TEXT,
  FILE_UNAVAILABLE_TEXT,
  GROUP_FILE_EMPTY_TEXT,
  GROUP_FILE_SEND_NOW_TEXT,
  GROUP_NO_USER_TEXT,
  GROUP_NOTE_DENIED_TEXT,
  GROUP_NOTE_EMPTY_TEXT,
  GROUP_NOTE_GONE_TEXT,
  GROUP_NOTE_SECRET_TEXT,
  GROUP_OWL_USAGE_TEXT,
  GROUP_PAUSED_TEXT,
  GROUP_REMIND_DENIED_TEXT,
  GROUP_REMIND_EMPTY_TEXT,
  GROUP_REMIND_GONE_TEXT,
  OWL_DAY_LIMIT_TEXT,
  OWL_FAILED_TEXT,
  OWL_SECRET_TEXT,
  OWL_TOO_LONG_TEXT,
  OWL_UNAVAILABLE_TEXT,
  REMINDER_NO_TEXT_TEXT,
  REMINDER_PAST_TEXT,
  REMINDER_TOO_FAR_TEXT,
  groupFileDayLimitText,
  groupFileFullText,
  groupFileListText,
  groupFileNotFoundText,
  groupNoteFullText,
  groupNoteNotFoundText,
  groupNoteSavedText,
  groupOwlQuotaText,
  groupReminderFullText,
  groupRemindCancelledText,
  NOTE_EMPTY_TEXT,
  NOTE_TOO_LONG_TEXT,
  NOTE_UNDONE_TEXT,
  text,
} from "./messages";
import { buildGroupRemindersCard, buildNoteListCard } from "./list-flex";
import { t } from "@/lib/i18n";
import { buildReminderCard } from "./reminder-flex";

const MAX_FILES_SHOWN = 5;

/** The group as a member sees it: who owns it, and whether the owner's plan still allows it. */
export interface GroupExtraContext {
  db: SupabaseClient;
  deps: HandlerDeps;
  group: GroupRow;
  owner: { lineUserId: string; plan: string; planExpiresAt: string | null } | null;
  /** The owner is still on Elite: new files, reminders and questions are allowed. */
  writable: boolean;
  /** The LINE id of the member who sent the message (absent when LINE does not say). */
  userId: string | undefined;
  isOwner: boolean;
  /** A page of the app through LIFF. */
  pageUrl: (path: string) => string | undefined;
  /** Who the message tags (not พี่ฮูก), for a reminder to tag them again. */
  mentions?: Mention[];
}

/** The owner as the one whose space, limits and quota a group uses. */
function ownerOf(ctx: GroupExtraContext): (FileOwner & { plan: Plan }) | null {
  if (!ctx.owner) return null;
  return {
    id: ctx.group.ownerUserId,
    plan: ctx.owner.plan as Plan,
    plan_expires_at: ctx.owner.planExpiresAt,
  };
}

const ownerPlan = (ctx: GroupExtraContext, owner: FileOwner) =>
  effectivePlan(owner.plan, owner.plan_expires_at, ctx.deps.now());

// the vault and reminders pages, switched to this group
const groupFilesPath = (ctx: GroupExtraContext) => `/vault?g=${ctx.group.id}`;
const groupRemindersPath = (ctx: GroupExtraContext) => `/reminders?g=${ctx.group.id}`;
const groupNotesPath = (ctx: GroupExtraContext) => `/vault?g=${ctx.group.id}&tab=note`;
const openUrlOf = (ctx: GroupExtraContext) => (id: string) =>
  ctx.pageUrl(`${groupFilesPath(ctx)}&open=${id}`);

// ───────────── files ─────────────

/** "เก็บไฟล์": the next file this member sends in the group is kept there. */
export async function startGroupKeep(
  ctx: GroupExtraContext,
  name: string | null,
): Promise<LineMessage[]> {
  if (!ctx.userId) return [text(GROUP_NO_USER_TEXT)];
  if (!ctx.writable) return [text(GROUP_PAUSED_TEXT)];
  if (!ctx.deps.files) return [text(FILE_UNAVAILABLE_TEXT)];
  await startGroupFileWait(ctx.db, ctx.group.id, ctx.userId, name, ctx.deps.now());
  return [text(GROUP_FILE_SEND_NOW_TEXT)];
}

/**
 * A file, picture or video in the group: kept when its sender said "เก็บไฟล์" a moment ago.
 * Null when nobody is waiting, so a picture can still be looked at as a bill slip.
 */
export async function keepIfWaiting(
  ctx: GroupExtraContext,
  media: Omit<RecentMedia, "id">,
): Promise<LineMessage[] | null> {
  const files = ctx.deps.files;
  if (!ctx.userId || !files) return null;
  const wait = await takeGroupFileWait(ctx.db, ctx.group.id, ctx.userId, ctx.deps.now());
  if (!wait) return null;
  const owner = ownerOf(ctx);
  if (!ctx.writable || !owner) return [text(GROUP_PAUSED_TEXT)];
  const result = await saveFile(
    {
      db: ctx.db,
      now: ctx.deps.now,
      store: files.store,
      fetchFile: files.fetchFile,
      fetchPreview: files.fetchPreview,
    },
    owner,
    media,
    wait.name,
    { groupId: ctx.group.id, savedBy: ctx.userId },
  );
  if (result.ok) {
    return [
      buildFilesSavedCard({
        files: [result.file],
        openUrl: openUrlOf(ctx),
        listUrl: ctx.pageUrl(groupFilesPath(ctx)),
      }),
    ];
  }
  return [await saveFailureText(ctx, owner, result.reason)];
}

async function saveFailureText(
  ctx: GroupExtraContext,
  owner: FileOwner,
  reason: SaveFailure,
): Promise<LineMessage> {
  const plan = ownerPlan(ctx, owner);
  switch (reason) {
    case "blocked":
      return text(FILE_BLOCKED_TEXT);
    case "too_large":
      return text(FILE_TOO_LARGE_TEXT);
    case "day_limit":
      return text(groupFileDayLimitText(fileDayLimit(plan)));
    case "full":
      return text(groupFileFullText(formatBytes(fileCapacity(plan))));
    case "gone":
      // the file left LINE before it could be read: wait for it once more
      if (ctx.userId) {
        await startGroupFileWait(ctx.db, ctx.group.id, ctx.userId, null, ctx.deps.now());
      }
      return text(FILE_GONE_TEXT);
    case "unavailable":
      return text(FILE_UNAVAILABLE_TEXT);
    case "failed":
      return text(FILE_FAILED_TEXT);
  }
}

/** "ไฟล์กลุ่ม" / "หาไฟล์ …": the group's latest files, or those whose name holds `term`. */
export async function listGroupFiles(
  ctx: GroupExtraContext,
  term: string | null,
): Promise<LineMessage[]> {
  const { items } = await listFilesOfGroup(ctx.db, ctx.group.id, {
    q: term ?? undefined,
    limit: MAX_FILES_SHOWN,
  });
  if (items.length === 0) {
    return [text(term ? groupFileNotFoundText(term) : GROUP_FILE_EMPTY_TEXT)];
  }
  const files: FileDto[] = items;
  return [
    text(groupFileListText(ctx.pageUrl(groupFilesPath(ctx)))),
    buildFileResults(files, openUrlOf(ctx)),
  ];
}

// ───────────── reminders ─────────────

/**
 * "เตือน พรุ่งนี้ 9 โมง ประชุม": pushed to the group at that time. A message with no time in it
 * ("เตือน ด้วยนะ") is ordinary chat and gets no answer.
 */
export async function addGroupReminder(
  ctx: GroupExtraContext,
  input: string,
): Promise<LineMessage[]> {
  const parsed = parseReminder(input, ctx.deps.now());
  if (!parsed.ok) {
    if (parsed.reason === "past") return [text(REMINDER_PAST_TEXT)];
    if (parsed.reason === "too_far") return [text(REMINDER_TOO_FAR_TEXT)];
    if (parsed.reason === "no_text") return [text(REMINDER_NO_TEXT_TEXT)];
    return [];
  }
  if (!ctx.userId) return [text(GROUP_NO_USER_TEXT)];
  const owner = ownerOf(ctx);
  if (!ctx.writable || !owner) return [text(GROUP_PAUSED_TEXT)];

  const kind = reminderKind(parsed.repeat);
  const limit = capacityOf(ownerPlan(ctx, owner), kind);
  if ((await countActiveReminders(ctx.db, owner.id, kind)) >= limit) {
    return [text(groupReminderFullText(limit, kind === "repeat"))];
  }
  const made = await createReminder(ctx.db, owner.id, {
    body: parsed.body,
    remindAt: parsed.remindAt,
    repeat: parsed.repeat,
    groupId: ctx.group.id,
    createdBy: ctx.userId,
    // only the tags still in what it will say (one in the time part, "@แอน 9 โมง", is gone)
    mentions: (ctx.mentions ?? []).filter((m) => parsed.body.includes(m.label)),
  });
  // the phone's own calendar reminds for free; opened outside LINE, which cannot add it
  const link = await ctx.deps.calendarLink?.(made.id).catch(() => undefined);
  const calendar = link
    ? {
        google: `${link}&to=google&openExternalBrowser=1`,
        ics: `${link}&to=ics&openExternalBrowser=1`,
      }
    : undefined;
  return [
    buildReminderCard({
      id: made.id,
      body: made.body,
      remindAt: parsed.remindAt,
      repeat: parsed.repeat,
      timeDefaulted: parsed.timeDefaulted,
      rolledToTomorrow: parsed.rolledToTomorrow,
      title: "ตั้งเตือนกลุ่มแล้ว",
      now: ctx.deps.now(),
      cancelData: `a=grmx&id=${made.id}`,
      listUrl: ctx.pageUrl(groupRemindersPath(ctx)),
      calendar,
    }),
  ];
}

/** "เตือนกลุ่ม": the group's reminders waiting, numbered for "ยกเลิกเตือน 2". */
export async function listGroupRemindersText(ctx: GroupExtraContext): Promise<LineMessage[]> {
  const items = await listGroupReminders(ctx.db, ctx.group.id, 20);
  if (items.length === 0) return [text(GROUP_REMIND_EMPTY_TEXT)];
  return [buildGroupRemindersCard({ items })];
}

/** Cancel the `index`-th reminder of "เตือนกลุ่ม" (1 is the soonest). */
export async function cancelGroupReminderAt(
  ctx: GroupExtraContext,
  index: number,
): Promise<LineMessage[]> {
  const items = await listGroupReminders(ctx.db, ctx.group.id, 20);
  const target = items[index - 1];
  if (!target) return [text(GROUP_REMIND_GONE_TEXT)];
  return cancelGroupReminderById(ctx, target.id);
}

/** The cancel button, or a number: whoever set it, or the owner, may cancel it. */
export async function cancelGroupReminderById(
  ctx: GroupExtraContext,
  id: string,
): Promise<LineMessage[]> {
  if (!ctx.userId) return [text(GROUP_NO_USER_TEXT)];
  const items = await listGroupReminders(ctx.db, ctx.group.id, 200);
  const target = items.find((r) => r.id === id);
  if (!target) return [text(GROUP_REMIND_GONE_TEXT)];
  if (!ctx.isOwner && target.createdBy !== ctx.userId) return [text(GROUP_REMIND_DENIED_TEXT)];
  const gone = await cancelGroupReminder(ctx.db, ctx.group.id, id);
  return [text(gone ? groupRemindCancelledText(target.body) : GROUP_REMIND_GONE_TEXT)];
}

// ───────────── notes ─────────────

const MAX_NOTES_SHOWN = 5;

/** "โน้ต ซื้อน้ำแข็ง": a note for the group, on the owner's note limit. */
export async function addGroupNote(ctx: GroupExtraContext, raw: string): Promise<LineMessage[]> {
  const body = cleanNoteBody(raw);
  if (!body) return [text(NOTE_EMPTY_TEXT)];
  if (body.length > MAX_NOTE_LENGTH) return [text(NOTE_TOO_LONG_TEXT(MAX_NOTE_LENGTH))];
  if (!ctx.userId) return [text(GROUP_NO_USER_TEXT)];
  const owner = ownerOf(ctx);
  if (!ctx.writable || !owner) return [text(GROUP_PAUSED_TEXT)];

  const limit = noteCapacity(ownerPlan(ctx, owner));
  if ((await countNotes(ctx.db, owner.id)) >= limit) return [text(groupNoteFullText(limit))];
  const note = await createNote(ctx.db, owner.id, body, {
    groupId: ctx.group.id,
    createdBy: ctx.userId,
  });
  const saved = groupNoteSavedText(noteTitle(body, 60), ctx.pageUrl(groupNotesPath(ctx)));
  return [
    {
      ...text(looksSecret(body) ? `${saved}\n\n${GROUP_NOTE_SECRET_TEXT}` : saved),
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "postback",
              label: "↩️ ยกเลิกโน้ตนี้",
              data: `a=gntx&id=${note.id}`,
              displayText: "ยกเลิกโน้ตนี้",
            },
          },
        ],
      },
    },
  ];
}

/** "โน้ตกลุ่ม" / "หาโน้ต …": the group's latest notes, or those that hold `term`. */
export async function listGroupNotesText(
  ctx: GroupExtraContext,
  term: string | null,
): Promise<LineMessage[]> {
  const { items, hasMore } = await listGroupNotes(ctx.db, ctx.group.id, {
    q: term ?? undefined,
    limit: MAX_NOTES_SHOWN,
  });
  if (items.length === 0) {
    return [text(term ? groupNoteNotFoundText(term) : GROUP_NOTE_EMPTY_TEXT)];
  }
  const title = term ? t('โน้ตของกลุ่มที่มี "{0}"', term) : t("โน้ตล่าสุดของกลุ่ม");
  return [
    buildNoteListCard({
      title,
      items,
      url: ctx.pageUrl(groupNotesPath(ctx)),
      more: hasMore,
    }),
  ];
}

/** "↩️ ยกเลิกโน้ตนี้": whoever wrote it, or the owner, may remove it. */
export async function undoGroupNote(ctx: GroupExtraContext, id: string): Promise<LineMessage[]> {
  if (!ctx.userId) return [text(GROUP_NO_USER_TEXT)];
  const note = id ? await getGroupNote(ctx.db, ctx.group.id, id) : null;
  if (!note) return [text(GROUP_NOTE_GONE_TEXT)];
  if (!ctx.isOwner && note.createdBy !== ctx.userId) return [text(GROUP_NOTE_DENIED_TEXT)];
  const gone = await deleteGroupNote(ctx.db, ctx.group.id, id);
  return [text(gone ? NOTE_UNDONE_TEXT : GROUP_NOTE_GONE_TEXT)];
}

// ───────────── พี่ฮูก ─────────────

/**
 * "ฮูก …" in a group: one question, answered for everyone to see. It uses the owner's monthly quota and
 * knows only the group's own ledger, never a member's own records.
 */
export async function askOwlInGroup(
  ctx: GroupExtraContext,
  question: string,
): Promise<LineMessage[]> {
  const owl = ctx.deps.owl;
  if (!owl) return [text(OWL_UNAVAILABLE_TEXT)];
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return [text(GROUP_OWL_USAGE_TEXT)];
  if (!ctx.userId) return [text(GROUP_NO_USER_TEXT)];
  if (q.length > MAX_QUESTION_LENGTH) return [text(OWL_TOO_LONG_TEXT(MAX_QUESTION_LENGTH))];
  if (looksSecret(q)) return [text(OWL_SECRET_TEXT)];
  const owner = ownerOf(ctx);
  if (!ctx.writable || !owner) return [text(GROUP_PAUSED_TEXT)];

  // the owner's monthly quota first: a question it refuses does not use up the member's day
  const now = ctx.deps.now();
  const limit = OWL_LIMIT[ownerPlan(ctx, owner)];
  const month = monthKey(now);
  try {
    if (!(await takeUsage(ctx.db, owner.id, "owl", limit, month))) {
      return [text(groupOwlQuotaText(limit))];
    }
  } catch (error) {
    log.error("owl_quota_failed", error);
    return [text(OWL_FAILED_TEXT)];
  }

  let answered = false;
  try {
    if (ctx.deps.limit) {
      const day = await ctx.deps.limit("owl_day", ctx.userId, LIMITS.owlDay);
      if (!day.allowed) return [text(OWL_DAY_LIMIT_TEXT)];
    }
    // the ledger goes to the AI only for a question about money; "แปลว่าอะไร" gets none
    const data = needsPersonalData(q)
      ? renderGroupOwlContext(await loadGroupOwlFacts(ctx.db, ctx.group.id, now))
      : "";
    const reply = cleanOwlAnswer(await owl.answer({ question: q, data, group: true }));
    if (!reply) return [text(OWL_FAILED_TEXT)];
    answered = true;
    return [text(reply)];
  } catch (error) {
    log.warn("owl_failed", { owl: owl.name, reason: safeMessage(error) });
    return [text(OWL_FAILED_TEXT)];
  } finally {
    if (!answered) {
      await refundUsage(ctx.db, owner.id, "owl", month).catch((e) =>
        log.error("owl_refund_failed", e),
      );
    }
  }
}
