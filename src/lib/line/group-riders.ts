import type { SupabaseClient } from "@supabase/supabase-js";
import { getGroup } from "@/lib/group-repo";
import { mentionedMessage, type Mention } from "@/lib/group-mention";
import { addLateReminder, takeGroupRiders, type Rider } from "@/lib/group-reminder-repo";
import { log } from "@/lib/log";
import { toBangkokInputValue } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { REPEAT_LABEL } from "@/lib/user-reminder";
import { groupReminderPushText } from "./messages";

/** What a group's reminder says, and who it tags, as text and as a message that tags them. */
export function groupReminderMessage(
  items: {
    body: string;
    repeat: Rider["repeat"];
    mentions: Mention[];
    dueAt?: string;
    late?: boolean;
  }[],
): { tagged: LineMessage; plain: LineMessage } {
  const text = items
    .map((r) => {
      const said = groupReminderPushText(r.body, r.repeat ? REPEAT_LABEL[r.repeat] : null);
      return r.late && r.dueAt
        ? `${said}\n(เตือนตอน ${toBangkokInputValue(new Date(r.dueAt)).slice(11, 16)})`
        : said;
    })
    .join("\n\n");
  return {
    tagged: mentionedMessage(
      text,
      items.flatMap((r) => r.mentions),
    ),
    plain: { type: "text", text },
  };
}

type Reply = (messages: LineMessage[]) => Promise<void>;

/** LINE turned the message down as malformed (the tagged form), rather than failing to send it. */
export const refusedAsMalformed = (error: unknown) =>
  error instanceof Error && /: 400\b/.test(error.message);

/**
 * Someone wrote in the group: its reminders due around now (and those whose push could not go) ride
 * on the answer, for free. `handle` answers the message itself through the reply it is given; the
 * reminders go first in that answer, or alone when it has none. They are taken only as the answer
 * goes, so an answer that never goes (a slow command cut off) leaves them for the next message or the
 * cron. When LINE turns the tagged form down they go as plain text; when the answer fails for any
 * other reason they wait for the next message.
 */
export async function withGroupRiders(
  db: SupabaseClient,
  lineGroupId: string,
  now: Date,
  reply: Reply,
  handle: (reply: Reply) => Promise<void>,
): Promise<void> {
  let answered = false;
  const send = async (messages: LineMessage[]) => {
    let riders: Rider[] = [];
    try {
      riders = await takeGroupRiders(db, lineGroupId, now);
    } catch (error) {
      log.error("group_riders_failed", error);
    }
    if (riders.length === 0) return reply(messages);
    const { tagged, plain } = groupReminderMessage(riders);
    // the answer keeps its own messages; the reminders take the one place left over
    const withRider = (rider: LineMessage) => [rider, ...messages.slice(0, 4)];
    try {
      await reply(withRider(tagged));
    } catch (error) {
      log.warn("group_rider_reply_failed", { reason: error instanceof Error ? error.message : "" });
      if (!refusedAsMalformed(error)) return keepForLater(db, lineGroupId, riders);
      try {
        await reply(withRider(plain));
      } catch {
        await keepForLater(db, lineGroupId, riders);
      }
    }
  };
  try {
    await handle(async (messages) => {
      if (messages.length === 0) return;
      answered = true;
      await send(messages);
    });
  } finally {
    if (!answered) await send([]);
  }
}

async function keepForLater(db: SupabaseClient, lineGroupId: string, riders: Rider[]) {
  try {
    const group = await getGroup(db, lineGroupId);
    if (!group) return;
    for (const r of riders) {
      await addLateReminder(db, {
        groupId: group.id,
        body: r.body,
        repeat: r.repeat,
        mentions: r.mentions,
        dueAt: new Date(r.dueAt),
      });
    }
  } catch (error) {
    log.error("group_rider_keep_failed", error);
  }
}
