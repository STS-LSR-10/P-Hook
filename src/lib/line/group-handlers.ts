import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarMonthRange, dayRange } from "@/lib/budget-cycle";
import {
  MAX_GROUPS_PER_OWNER,
  MAX_GROUP_ENTRIES_PER_DAY,
  MAX_RECORDS_PER_MESSAGE,
  RECENT_COUNT,
  canDeleteEntry,
  parseGroupCommand,
  summarizePayers,
  type GroupCommand,
  type GroupRow,
} from "@/lib/group";
import {
  addEntries,
  closeGroup,
  closeTrip,
  closedTrips,
  createTrip,
  joinTrip,
  openTrip,
  tripEntries,
  tripMembers,
  countEntriesSince,
  countOwnedGroups,
  deleteEntry,
  getEntry,
  getGroup,
  getOwner,
  memberNames,
  openGroup,
  payerTotals,
  recentEntries,
  upsertMember,
} from "@/lib/group-repo";
import { log } from "@/lib/log";
import { formatBaht } from "@/lib/money";
import { parseMessage } from "@/lib/parse/text-parser";
import { can, effectivePlan } from "@/lib/plan";
import { LIMITS } from "@/lib/rate-limit";
import { ensureUser } from "@/lib/repo";
import { buildGroupHelpCard, buildGroupWelcomeCard } from "./help-flex";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { buildGroupSummaryCard, buildTripSummaryCard } from "./group-flex";
import { convertForeignEntries, fxNoteOf } from "./fx-entries";
import {
  computeSettlement,
  participantsOf,
  parseSplitClause,
  resolveNames,
  splitAmount,
} from "@/lib/trip";
import {
  BILL_POSTBACKS,
  handleBillPostback,
  runBillCommand,
  runDailyReminder,
} from "./split-bill-handlers";
import { checkGroupSlip } from "./split-bill-slip";
import {
  addGroupReminder,
  askOwlInGroup,
  cancelGroupReminderAt,
  cancelGroupReminderById,
  keepIfWaiting,
  listGroupFiles,
  listGroupRemindersText,
  startGroupKeep,
  type GroupExtraContext,
} from "./group-extras";
import type { HandlerDeps, LineEvent } from "./handlers";
import {
  GROUP_ALREADY_OPEN_TEXT,
  GROUP_CANNOT_DELETE_TEXT,
  GROUP_CLOSED_TEXT,
  GROUP_DAY_FULL_TEXT,
  GROUP_DELETED_TEXT,
  GROUP_ENTRY_GONE_TEXT,
  GROUP_EXPENSE_ONLY_TEXT,
  GROUP_LOCKED_TEXT,
  GROUP_NOT_OPEN_TEXT,
  GROUP_NOTHING_TO_DELETE_TEXT,
  GROUP_NO_USER_TEXT,
  GROUP_OPENED_TEXT,
  GROUP_OTHER_OWNER_TEXT,
  GROUP_OWNER_ONLY_TEXT,
  GROUP_PAUSED_TEXT,
  GROUP_RECENT_EMPTY_TEXT,
  GROUP_RECORD_USAGE_TEXT,
  GROUP_TOO_MANY_ENTRIES_TEXT,
  GROUP_TOO_MANY_TEXT,
  GROUP_NO_TRIP_TEXT,
  GROUP_SPLIT_NEEDS_TRIP_TEXT,
  GROUP_TRIP_CLOSE_DENIED_TEXT,
  GROUP_TRIP_EXISTS_TEXT,
  GROUP_TRIP_NO_EXIST_TEXT,
  GROUP_TRIP_OLD_EMPTY_TEXT,
  groupSplitAmbiguousText,
  groupSplitUnknownText,
  groupTripJoinedText,
  groupTripStartedText,
  text,
} from "./messages";

const NAME_FALLBACK = "สมาชิกกลุ่ม";
const NAME_REFRESH_MS = 7 * 86_400_000;

/**
 * Events from a LINE group. The bot answers only the explicit group commands (see
 * parseGroupCommand): ordinary chat is never recorded, and nothing personal is ever shown here.
 */
/** The public app URL without a trailing slash, when it is configured. */
function appBaseUrl(): string | undefined {
  return process.env.APP_BASE_URL?.replace(/\/$/, "") || undefined;
}

/** A page of the web app, through the LIFF link inside LINE (undefined when no address is known). */
function pageUrl(path: string): string | undefined {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}${path}`;
  const base = appBaseUrl();
  return base ? `${base}${path}` : undefined;
}

/** What the files, reminders and พี่ฮูก of a group need. */
async function extraContext(
  group: GroupRow,
  userId: string | undefined,
  deps: HandlerDeps,
): Promise<GroupExtraContext> {
  const { owner, writable } = await ownerState(deps.db, group, deps.now());
  return {
    db: deps.db,
    deps,
    group,
    owner,
    writable,
    userId,
    isOwner: owner !== null && userId !== undefined && owner.lineUserId === userId,
    pageUrl,
  };
}

export async function handleGroupEvent(event: LineEvent, deps: HandlerDeps): Promise<void> {
  const groupId = event.source?.groupId;
  if (!groupId) return;
  const reply = async (messages: LineMessage[]) => {
    if (event.replyToken && messages.length > 0) await deps.reply(event.replyToken, messages);
  };

  switch (event.type) {
    case "join":
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      await reply([
        buildGroupWelcomeCard({
          appUrl: appBaseUrl(),
          openUrl: liffId ? `https://liff.line.me/${liffId}/group-open` : undefined,
        }),
      ]);
      return;
    case "leave":
      await closeGroup(deps.db, groupId);
      return;
    case "postback":
      await handleGroupPostback(event, groupId, deps, reply);
      return;
    case "message": {
      // a file, picture or video right after "เก็บไฟล์" is kept for the group; any other picture
      // may be a slip from someone who owes on a bill (anyone else's gets no answer)
      const message = event.message;
      if (
        message?.id &&
        (message.type === "image" || message.type === "video" || message.type === "file")
      ) {
        const kept = await keepGroupMedia(event, groupId, deps, {
          messageId: message.id,
          kind: message.type,
          fileName: message.type === "file" ? (message.fileName ?? null) : null,
          fileSize: message.type === "file" ? (message.fileSize ?? null) : null,
        });
        if (kept) {
          await reply(kept);
          return;
        }
        if (message.type === "image")
          await handleGroupImage(event, groupId, message.id, deps, reply);
        return;
      }
      if (event.message?.type !== "text" || event.message.text === undefined) return;
      const command = parseGroupCommand(event.message.text);
      if (!command) {
        // ordinary chat: stay quiet, except for the once-a-day reminder of unpaid bills
        await remindIfDue(groupId, deps, reply);
        return;
      }
      if (deps.limit) {
        const result = await deps.limit("group", groupId, LIMITS.chat);
        if (!result.allowed) return;
      }
      await runGroupCommand(command, event, groupId, deps, reply);
      return;
    }
    default:
      return;
  }
}

type Reply = (messages: LineMessage[]) => Promise<void>;

/** Ordinary chat in a group: if a bill still has people who have not paid, the day's reminder rides on it. */
async function remindIfDue(groupId: string, deps: HandlerDeps, reply: Reply): Promise<void> {
  try {
    const group = await getGroup(deps.db, groupId);
    if (!group || !group.isActive) return;
    const { writable } = await ownerState(deps.db, group, deps.now());
    await runDailyReminder(
      {
        db: deps.db,
        group,
        userId: undefined,
        writable,
        isOwner: false,
        knownName: (id) => knownName(deps.db, group, id, deps),
        appUrl: appBaseUrl(),
        reply,
      },
      deps.now(),
    );
  } catch (error) {
    log.error("bill_reminder_failed", error);
  }
}

/** Keep the file when its sender asked to; null otherwise (and for a video stored outside LINE). */
async function keepGroupMedia(
  event: LineEvent,
  groupId: string,
  deps: HandlerDeps,
  media: {
    messageId: string;
    kind: "image" | "video" | "file";
    fileName: string | null;
    fileSize: number | null;
  },
): Promise<LineMessage[] | null> {
  if (!event.source?.userId || !deps.files) return null;
  if (media.kind === "video" && event.message?.contentProvider?.type === "external") return null;
  const group = await getGroup(deps.db, groupId);
  if (!group || !group.isActive) return null;
  return keepIfWaiting(await extraContext(group, event.source.userId, deps), media);
}

/** A picture in a group: only looked at when the sender still owes on a bill of this ledger. */
async function handleGroupImage(
  event: LineEvent,
  groupId: string,
  messageId: string,
  deps: HandlerDeps,
  reply: Reply,
): Promise<void> {
  const userId = event.source?.userId;
  if (!userId || !deps.slip) return;
  const group = await getGroup(deps.db, groupId);
  if (!group || !group.isActive) return;
  const { owner, writable } = await ownerState(deps.db, group, deps.now());
  await checkGroupSlip(
    {
      db: deps.db,
      group,
      userId,
      writable,
      isOwner: owner !== null && owner.lineUserId === userId,
      knownName: (id) => knownName(deps.db, group, id, deps),
      appUrl: appBaseUrl(),
      reply,
    },
    deps,
    messageId,
  );
}

/** Is the ledger usable for writing: its owner still on Elite? */
async function ownerState(db: SupabaseClient, group: GroupRow, now: Date) {
  const owner = await getOwner(db, group.ownerUserId);
  const writable =
    owner !== null &&
    can(
      effectivePlan(owner.plan as "free" | "plus" | "ultimate", owner.planExpiresAt, now),
      "groupLedger",
    );
  return { owner, writable };
}

async function runGroupCommand(
  command: GroupCommand,
  event: LineEvent,
  groupId: string,
  deps: HandlerDeps,
  reply: Reply,
): Promise<void> {
  const { db } = deps;
  const userId = event.source?.userId;
  const now = deps.now();

  if (command.kind === "help") return reply([buildGroupHelpCard({ appUrl: appBaseUrl() })]);

  if (command.kind === "open") {
    if (!userId) return reply([text(GROUP_NO_USER_TEXT)]);
    const user = await ensureUser(db, userId, () => deps.getProfile(userId));
    if (!can(effectivePlan(user.plan, user.plan_expires_at, now), "groupLedger")) {
      return reply([text(GROUP_LOCKED_TEXT)]);
    }
    const existing = await getGroup(db, groupId);
    if (existing?.isActive) {
      if (existing.ownerUserId === user.id) return reply([text(GROUP_ALREADY_OPEN_TEXT)]);
      // somebody else owns it: only when their Elite has run out may it change hands
      if ((await ownerState(db, existing, now)).writable)
        return reply([text(GROUP_OTHER_OWNER_TEXT)]);
    }
    if (
      existing?.ownerUserId !== user.id &&
      (await countOwnedGroups(db, user.id)) >= MAX_GROUPS_PER_OWNER
    ) {
      return reply([text(GROUP_TOO_MANY_TEXT)]);
    }
    await openGroup(db, groupId, user.id);
    return reply([text(GROUP_OPENED_TEXT)]);
  }

  const group = await getGroup(db, groupId);
  if (!group || !group.isActive) return reply([text(GROUP_NOT_OPEN_TEXT)]);
  const { owner, writable } = await ownerState(db, group, now);
  const isOwner = owner !== null && userId !== undefined && owner.lineUserId === userId;

  switch (command.kind) {
    case "close":
      if (!isOwner) return reply([text(GROUP_OWNER_ONLY_TEXT)]);
      await closeGroup(db, groupId);
      return reply([text(GROUP_CLOSED_TEXT)]);

    case "summary": {
      const range = command.scope === "today" ? dayRange(now) : calendarMonthRange(now);
      const [rows, names] = await Promise.all([
        payerTotals(db, group.id, range.from, range.to),
        memberNames(db, group.id),
      ]);
      const summary = summarizePayers(rows, new Map([...names].map(([id, v]) => [id, v.name])));
      if (summary.count === 0) return reply([text(GROUP_RECENT_EMPTY_TEXT)]);
      return reply([
        buildGroupSummaryCard({
          title: command.scope === "today" ? "สมุดกลุ่ม · วันนี้" : "สมุดกลุ่ม · เดือนนี้",
          subtitle: formatThaiDate(now),
          summary,
        }),
      ]);
    }

    case "recent": {
      const [entries, names] = await Promise.all([
        recentEntries(db, group.id, RECENT_COUNT),
        memberNames(db, group.id),
      ]);
      if (entries.length === 0) return reply([text(GROUP_RECENT_EMPTY_TEXT)]);
      const lines = entries.map(
        (e) =>
          `• ${e.title} ฿${formatBaht(e.amountSatang)} · ${names.get(e.payerLineUserId)?.name ?? NAME_FALLBACK}`,
      );
      return reply([text(["รายการล่าสุดของกลุ่ม", ...lines].join("\n"))]);
    }

    case "delete-last": {
      if (!userId) return reply([text(GROUP_NO_USER_TEXT)]);
      if (!writable) return reply([text(GROUP_PAUSED_TEXT)]);
      const [mine] = await recentEntries(db, group.id, 1, userId);
      if (!mine) return reply([text(GROUP_NOTHING_TO_DELETE_TEXT)]);
      await deleteEntry(db, group.id, mine.id);
      return reply([
        text(`${GROUP_DELETED_TEXT}: ${mine.title} ฿${formatBaht(mine.amountSatang)}`),
      ]);
    }

    case "record":
      return recordInGroup(command.body, userId, group, writable, deps, reply);

    case "bill-new":
    case "bill-usage":
    case "bill-chase":
    case "bill-open":
    case "bill-close":
    case "bill-cancel":
    case "bill-paid":
    case "bill-unpaid":
    case "bill-claim":
    case "bill-announce":
      return runBillCommand(command, {
        db,
        group,
        userId,
        writable,
        isOwner,
        knownName: (id) => knownName(db, group, id, deps),
        appUrl: appBaseUrl(),
        reply,
      });

    case "trip-start":
    case "trip-join":
    case "trip-status":
    case "trip-summary":
    case "trip-close":
    case "trip-old":
      return runTripCommand(command, userId, group, writable, isOwner, deps, reply);

    case "file-keep":
    case "file-list":
    case "remind-add":
    case "remind-list":
    case "remind-cancel":
    case "owl": {
      const ctx: GroupExtraContext = {
        db,
        deps,
        group,
        owner,
        writable,
        userId,
        isOwner,
        pageUrl,
      };
      if (command.kind === "file-keep") return reply(await startGroupKeep(ctx, command.name));
      if (command.kind === "file-list") return reply(await listGroupFiles(ctx, command.term));
      if (command.kind === "remind-add") return reply(await addGroupReminder(ctx, command.text));
      if (command.kind === "remind-list") return reply(await listGroupRemindersText(ctx));
      if (command.kind === "remind-cancel")
        return reply(await cancelGroupReminderAt(ctx, command.index));
      return reply(await askOwlInGroup(ctx, command.question));
    }

    default:
      return;
  }
}

/** "จด ข้าวเที่ยง 350": write the entries with the person who typed them as the payer. */
async function recordInGroup(
  body: string,
  userId: string | undefined,
  group: GroupRow,
  writable: boolean,
  deps: HandlerDeps,
  reply: Reply,
): Promise<void> {
  const { db } = deps;
  if (!userId) return reply([text(GROUP_NO_USER_TEXT)]);
  if (!writable) return reply([text(GROUP_PAUSED_TEXT)]);

  // during a trip the entry is shared between people: everyone on it, or "หาร …" / "ไม่หาร …" some
  const trip = await openTrip(db, group.id);
  const split = parseSplitClause(body);
  if (!trip && split.mode !== "all") return reply([text(GROUP_SPLIT_NEEDS_TRIP_TEXT)]);

  const parsed = parseMessage(split.body, deps.now(), { currencies: true }).entries;
  if (parsed.length === 0) return reply([text(GROUP_RECORD_USAGE_TEXT)]);
  if (parsed.length > MAX_RECORDS_PER_MESSAGE) return reply([text(GROUP_TOO_MANY_ENTRIES_TEXT)]);
  if (parsed.some((e) => e.type === "income")) return reply([text(GROUP_EXPENSE_ONLY_TEXT)]);

  // "1500 JPY" is turned into baht at the rate of that day; an amount without a currency is baht
  const converted = await convertForeignEntries(parsed, deps);
  if (typeof converted === "string") return reply([text(converted)]);
  const entries = converted;

  const today = dayRange(deps.now());
  if (
    (await countEntriesSince(db, group.id, today.from)) + entries.length >
    MAX_GROUP_ENTRIES_PER_DAY
  ) {
    return reply([text(GROUP_DAY_FULL_TEXT)]);
  }

  const names = await memberNames(db, group.id);
  const name = await knownName(db, group, userId, deps);
  names.set(userId, { name, updatedAt: deps.now().toISOString() });

  let participants: string[] = [];
  if (trip) {
    await joinTrip(db, trip.id, userId); // writing in a trip puts you on it
    const members = await tripMembers(db, trip.id);
    const people = members.map((id) => ({ id, name: names.get(id)?.name ?? NAME_FALLBACK }));
    let named: string[] = [];
    if (split.mode !== "all") {
      const found = resolveNames(split.names, people);
      if (!found.ok) {
        return reply([
          text(
            found.unknown.length > 0
              ? groupSplitUnknownText(found.unknown)
              : groupSplitAmbiguousText(found.ambiguous),
          ),
        ]);
      }
      named = found.ids;
    }
    participants = participantsOf(split.mode, named, members, userId);
  }

  const saved = await addEntries(
    db,
    group.id,
    userId,
    entries.map((e) => ({
      title: e.title,
      amountSatang: e.amountSatang,
      occurredAt: e.occurredAt,
      raw: e.raw,
      tripId: trip?.id ?? null,
      splitMode: trip ? split.mode : "all",
      splitUsers: participants,
      foreign: e.fx ? { currency: e.fx.currency, minor: e.fx.minor, rate: e.fx.rate } : null,
    })),
  );

  /** "หาร 3 คน คนละ ฿116.75" / "หาร แอน, บ๊อบ คนละประมาณ ฿450" for an entry in a trip. */
  const shareLine = (amountSatang: number) => {
    if (!trip) return "";
    const shares = [...splitAmount(amountSatang, participants, userId).values()];
    const same = shares.every((v) => v === shares[0]);
    const people =
      split.mode === "all"
        ? `${participants.length} คน`
        : participants.map((id) => names.get(id)?.name ?? NAME_FALLBACK).join(", ");
    return `\nหาร ${people} คนละ${same ? "" : "ประมาณ"} ฿${formatBaht(Math.max(...shares))}`;
  };

  if (saved.length === 1 && saved[0] && entries[0]) {
    const e = saved[0];
    const fx = entries[0].fx ? ` (${fxNoteOf(entries[0].fx)})` : "";
    return reply([
      {
        type: "text",
        text: `จดแล้ว: ${e.title} ฿${formatBaht(e.amountSatang)}${fx}\nจ่ายโดย ${name}${shareLine(e.amountSatang)}`,
        quickReply: {
          items: [
            {
              type: "action",
              action: {
                type: "postback",
                label: "↩ ยกเลิก",
                data: `a=gdx&id=${e.id}`,
                displayText: "ยกเลิก",
              },
            },
          ],
        },
      },
    ]);
  }
  const lines = saved.map((e) => `• ${e.title} ฿${formatBaht(e.amountSatang)}`);
  const total = saved.reduce((s, e) => s + e.amountSatang, 0);
  return reply([
    text(
      [
        `จดแล้ว ${saved.length} รายการ · จ่ายโดย ${name}${trip ? ` · หาร ${participants.length} คน` : ""}`,
        ...lines,
        `รวม ฿${formatBaht(total)}`,
      ].join("\n"),
    ),
  ]);
}

/** Start / join / look at / close a trip, and the old ones. */
async function runTripCommand(
  command: Extract<GroupCommand, { kind: `trip-${string}` }>,
  userId: string | undefined,
  group: GroupRow,
  writable: boolean,
  isOwner: boolean,
  deps: HandlerDeps,
  reply: Reply,
): Promise<void> {
  const { db } = deps;
  const open = await openTrip(db, group.id);
  const names = await memberNames(db, group.id);
  const nameOf = (id: string) => names.get(id)?.name ?? NAME_FALLBACK;

  switch (command.kind) {
    case "trip-start": {
      if (!userId) return reply([text(GROUP_NO_USER_TEXT)]);
      if (!writable) return reply([text(GROUP_PAUSED_TEXT)]);
      if (open) return reply([text(GROUP_TRIP_EXISTS_TEXT)]);
      await knownName(db, group, userId, deps);
      const created = await createTrip(db, group.id, command.name, userId);
      if (created === "exists") return reply([text(GROUP_TRIP_EXISTS_TEXT)]);
      await joinTrip(db, created.id, userId);
      return reply([
        {
          type: "text",
          text: groupTripStartedText(created.name),
          quickReply: {
            items: [
              {
                type: "action",
                action: {
                  type: "postback",
                  label: "🙋 ร่วมทริป",
                  data: `a=gtj&t=${created.id}`,
                  displayText: "ร่วมทริป",
                },
              },
            ],
          },
        },
      ]);
    }

    case "trip-join": {
      if (!open) return reply([text(GROUP_NO_TRIP_TEXT)]);
      return joinOpenTrip(open.id, open.name, userId, group, deps, reply);
    }

    case "trip-status": {
      if (!open) return reply([text(GROUP_NO_TRIP_TEXT)]);
      const [members, entries] = await Promise.all([
        tripMembers(db, open.id),
        tripEntries(db, open.id),
      ]);
      const total = entries.reduce((s, e) => s + e.amountSatang, 0);
      return reply([
        text(
          [
            `🧳 ${open.name}`,
            `ร่วมทริป ${members.length} คน: ${members.map(nameOf).join(", ")}`,
            `${entries.length} รายการ รวม ฿${formatBaht(total)}`,
            'พิมพ์ "สรุปทริป" ดูว่าใครต้องโอนให้ใคร',
          ].join("\n"),
        ),
      ]);
    }

    case "trip-summary": {
      const trip = open ?? (await closedTrips(db, group.id, 1))[0];
      if (!trip) return reply([text(GROUP_TRIP_NO_EXIST_TEXT)]);
      return reply([
        await tripSummaryCard(db, trip.id, trip.name, trip.status === "closed", nameOf),
      ]);
    }

    case "trip-close": {
      if (!open) return reply([text(GROUP_NO_TRIP_TEXT)]);
      if (!writable) return reply([text(GROUP_PAUSED_TEXT)]);
      if (!isOwner && open.startedBy !== userId) return reply([text(GROUP_TRIP_CLOSE_DENIED_TEXT)]);
      await closeTrip(db, open.id);
      return reply([
        text(`จบทริป "${open.name}" แล้ว สรุปยอดโอนด้านล่างนี้เลย 👇`),
        await tripSummaryCard(db, open.id, open.name, true, nameOf),
      ]);
    }

    case "trip-old": {
      const old = await closedTrips(db, group.id, 5);
      if (old.length === 0) return reply([text(GROUP_TRIP_OLD_EMPTY_TEXT)]);
      const lines = await Promise.all(
        old.map(async (t) => {
          const total = (await tripEntries(db, t.id)).reduce((s, e) => s + e.amountSatang, 0);
          return `• ${t.name} · ${t.closedAt ? formatThaiDate(new Date(t.closedAt)) : ""} · ฿${formatBaht(total)}`;
        }),
      );
      return reply([text(["ทริปที่จบแล้ว", ...lines].join("\n"))]);
    }
  }
}

/** Put the person on the trip and say so (the name is looked up so others can use it in "หาร"). */
async function joinOpenTrip(
  tripId: string,
  tripName: string,
  userId: string | undefined,
  group: GroupRow,
  deps: HandlerDeps,
  reply: Reply,
): Promise<void> {
  if (!userId) return reply([text(GROUP_NO_USER_TEXT)]);
  const name = await knownName(deps.db, group, userId, deps);
  await joinTrip(deps.db, tripId, userId);
  const count = (await tripMembers(deps.db, tripId)).length;
  return reply([text(groupTripJoinedText(name, tripName, count))]);
}

/** The summary card of a trip: who paid, who owes, who transfers whom. */
async function tripSummaryCard(
  db: SupabaseClient,
  tripId: string,
  name: string,
  closed: boolean,
  nameOf: (id: string) => string,
): Promise<LineMessage> {
  const [entries, members] = await Promise.all([tripEntries(db, tripId), tripMembers(db, tripId)]);
  const settlement = computeSettlement(
    entries.map((e) => ({
      payer: e.payerLineUserId,
      amountSatang: e.amountSatang,
      participants: e.splitUsers && e.splitUsers.length > 0 ? e.splitUsers : [e.payerLineUserId],
    })),
    members,
  );
  return buildTripSummaryCard({ name, closed, entryCount: entries.length, settlement, nameOf });
}

/**
 * The name to show for a member: the saved one, refreshed from LINE when it is new or a week old.
 * A profile that cannot be read leaves a neutral name (the entry is still recorded to their id).
 */
async function knownName(
  db: SupabaseClient,
  group: GroupRow,
  userId: string,
  deps: HandlerDeps,
): Promise<string> {
  const names = await memberNames(db, group.id);
  const known = names.get(userId);
  if (known && deps.now().getTime() - new Date(known.updatedAt).getTime() < NAME_REFRESH_MS)
    return known.name;
  try {
    const profile = await deps.getGroupMemberProfile?.(group.lineGroupId, userId);
    const name = profile?.displayName?.trim() || known?.name || NAME_FALLBACK;
    await upsertMember(db, group.id, userId, name);
    return name;
  } catch (error) {
    log.error("group_profile_failed", error);
    return known?.name ?? NAME_FALLBACK;
  }
}

/** The "↩ ยกเลิก" under an entry: its writer or the owner of the ledger may remove it. */
async function handleGroupPostback(
  event: LineEvent,
  groupId: string,
  deps: HandlerDeps,
  reply: Reply,
): Promise<void> {
  const params = new URLSearchParams(event.postback?.data ?? "");
  const action = params.get("a");
  if (
    action !== "gdx" &&
    action !== "gtj" &&
    action !== "grmx" &&
    !(action && BILL_POSTBACKS.has(action))
  )
    return;
  const userId = event.source?.userId;
  if (!userId) return reply([text(GROUP_NO_USER_TEXT)]);
  const { db } = deps;

  // "ยกเลิกเตือนนี้" under a group's reminder
  if (action === "grmx") {
    const group = await getGroup(db, groupId);
    if (!group || !group.isActive) return reply([text(GROUP_NOT_OPEN_TEXT)]);
    const ctx = await extraContext(group, userId, deps);
    return reply(await cancelGroupReminderById(ctx, params.get("id") ?? ""));
  }

  // the buttons on a split bill: join, close the list, cancel, my QR, got the money from …
  if (action && BILL_POSTBACKS.has(action)) {
    const group = await getGroup(db, groupId);
    if (!group || !group.isActive) return reply([text(GROUP_NOT_OPEN_TEXT)]);
    const { owner, writable } = await ownerState(db, group, deps.now());
    return handleBillPostback(action, params, {
      db,
      group,
      userId,
      writable,
      isOwner: owner !== null && owner.lineUserId === userId,
      knownName: (id) => knownName(db, group, id, deps),
      appUrl: appBaseUrl(),
      reply,
    });
  }

  // "🙋 ร่วมทริป" under the start of a trip
  if (action === "gtj") {
    const group = await getGroup(db, groupId);
    if (!group || !group.isActive) return reply([text(GROUP_NOT_OPEN_TEXT)]);
    const open = await openTrip(db, group.id);
    if (!open || open.id !== params.get("t")) return reply([text(GROUP_NO_TRIP_TEXT)]);
    return joinOpenTrip(open.id, open.name, userId, group, deps, reply);
  }

  const group = await getGroup(db, groupId);
  if (!group || !group.isActive) return reply([text(GROUP_NOT_OPEN_TEXT)]);
  const { owner, writable } = await ownerState(db, group, deps.now());
  if (!writable) return reply([text(GROUP_PAUSED_TEXT)]);

  const entry = await getEntry(db, group.id, params.get("id") ?? "");
  if (!entry) return reply([text(GROUP_ENTRY_GONE_TEXT)]);
  const allowed = canDeleteEntry({
    entryPayer: entry.payerLineUserId,
    requester: userId,
    requesterIsOwner: owner !== null && owner.lineUserId === userId,
  });
  if (!allowed) return reply([text(GROUP_CANNOT_DELETE_TEXT)]);
  await deleteEntry(db, group.id, entry.id);
  return reply([text(`${GROUP_DELETED_TEXT}: ${entry.title} ฿${formatBaht(entry.amountSatang)}`)]);
}
