import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ROUTER_ACT_CONFIDENCE,
  type IntentDecision,
  type IntentRouter,
  type RoutedIntent,
} from "@/lib/ai/intent-router";
import { clockIsTheAmount, runRouter } from "@/lib/ai/route-text";
import type { Command } from "@/lib/commands";
import type { ParseResult } from "@/lib/parse/text-parser";
import { putPendingIntent, takePendingIntent } from "@/lib/pending-intent-repo";
import { can, effectivePlan } from "@/lib/plan";
import { matchReminders } from "@/lib/reminder-match";
import type { UserRow } from "@/lib/repo";
import { looksSecret } from "@/lib/secret-text";
import type { LineMessage } from "@/lib/types";
import { bangkokParts } from "@/lib/thai-date";
import { moveReminderTime, type ReminderDto } from "@/lib/user-reminder";
import { listReminders, rescheduleReminder } from "@/lib/user-reminder-repo";
import {
  INTENT_CANCELLED_TEXT,
  INTENT_CONFIRM_TEXT,
  INTENT_EXPIRED_TEXT,
  INTENT_UNCLEAR_TEXT,
  MONEY_HINT_TEXT,
  REMINDER_GONE_TEXT,
  REMINDER_NOT_MATCHED_TEXT,
  REMINDER_PAST_TEXT,
  REMINDER_TOO_FAR_TEXT,
  REMINDER_USAGE_TEXT,
  REMINDER_WHICH_MORE_TEXT,
  REMINDER_WHICH_TEXT,
  ROUTER_REMINDER_HINT_TEXT,
  SECRET_ASK_TEXT,
  text,
} from "./messages";
import { buildReminderCard } from "./reminder-flex";

const MAX_REMINDER_CHOICES = 4;
const MAX_LABEL = 20; // LINE's limit for a quick reply
const UUID_RE = /^[0-9a-f-]{36}$/;

const CONFIRM_LABEL: Record<RoutedIntent, string> = {
  money: "จดเป็นรายการเงิน",
  reminder_add: "ตั้งเตือน",
  reminder_edit: "เลื่อนเตือน",
  note_add: "จดเป็นโน้ต",
  search: "ค้นหาในโน้ต",
  file_save: "เก็บไฟล์",
  ask: "ให้พี่ฮูกตอบ",
  unclear: "จัดการข้อความนี้",
};

export interface IntentDeps {
  db: SupabaseClient;
  now: () => Date;
  router?: IntentRouter;
  run: (command: Command) => Promise<LineMessage[]>;
  ask: (question: string) => Promise<LineMessage[]>;
  recordMoney: (input: string) => Promise<LineMessage[]>;
  listUrl: string | undefined;
}

/** A text with postback buttons that answer the waiting message `id`. */
function choices(message: string, id: string, picks: [label: string, pick: string][]): LineMessage {
  return {
    ...text(message),
    quickReply: {
      items: picks.map(([label, pick]) => ({
        type: "action",
        action: {
          type: "postback",
          label: label.slice(0, MAX_LABEL),
          data: `a=irp&id=${id}&p=${pick}`,
          displayText: label,
        },
      })),
    },
  };
}

async function moveReminder(
  reminder: ReminderDto,
  decision: IntentDecision,
  user: UserRow,
  deps: IntentDeps,
): Promise<LineMessage[]> {
  const parsed = moveReminderTime(decision.whenText ?? "", new Date(reminder.remindAt), deps.now());
  if (!parsed.ok) {
    if (parsed.reason === "past") return [text(REMINDER_PAST_TEXT)];
    if (parsed.reason === "too_far") return [text(REMINDER_TOO_FAR_TEXT)];
    return [text(REMINDER_USAGE_TEXT)];
  }
  const repeat = parsed.repeat ?? reminder.repeat;
  const made = await rescheduleReminder(deps.db, user.id, reminder.id, {
    remindAt: parsed.remindAt,
    repeat,
  });
  if (!made) return [text(REMINDER_GONE_TEXT)];
  return [
    buildReminderCard({
      id: made.id,
      body: made.body,
      remindAt: parsed.remindAt,
      repeat,
      timeDefaulted: false,
      rolledToTomorrow: parsed.rolledToTomorrow,
      listUrl: deps.listUrl,
    }),
  ];
}

/** What tells two reminders apart on a button: "2/11 08:00 กินยา". */
function reminderLabel(reminder: ReminderDto): string {
  const p = bangkokParts(new Date(reminder.remindAt));
  const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return `${p.day}/${p.month} ${clock} ${reminder.body}`;
}

async function editReminder(
  input: string,
  decision: IntentDecision,
  user: UserRow,
  deps: IntentDeps,
): Promise<LineMessage[]> {
  const waiting = await listReminders(deps.db, user.id);
  const found = matchReminders(waiting, decision.reminderQuery ?? "");
  const [only] = found;
  if (!only) return [text(REMINDER_NOT_MATCHED_TEXT)];
  if (found.length === 1) return moveReminder(only, decision, user, deps);
  const id = await putPendingIntent(deps.db, user.id, { text: input, decision }, deps.now());
  return [
    choices(
      found.length > MAX_REMINDER_CHOICES ? REMINDER_WHICH_MORE_TEXT : REMINDER_WHICH_TEXT,
      id,
      found.slice(0, MAX_REMINDER_CHOICES).map((r) => [reminderLabel(r), `rm:${r.id}`]),
    ),
  ];
}

/** Do what was decided, through the same commands the typed words use. */
function execute(
  input: string,
  decision: IntentDecision,
  user: UserRow,
  deps: IntentDeps,
): Promise<LineMessage[]> {
  switch (decision.intent) {
    case "reminder_add":
      return deps.run({ kind: "remind-add", text: decision.reminderText ?? input });
    case "reminder_edit":
      return editReminder(input, decision, user, deps);
    case "note_add":
      return deps.run({ kind: "note-add", body: input });
    case "search":
      return deps.run({ kind: "note-search", term: decision.searchTerm });
    case "file_save":
      return deps.run({ kind: "file-save", name: decision.fileName });
    case "ask":
      return deps.ask(input);
    case "money":
      return deps.recordMoney(input);
    case "unclear":
      return Promise.resolve([text(INTENT_EXPIRED_TEXT)]);
  }
}

/** Text that looks secret stays away from the AI: ask what to do with it. */
export async function askAboutSecret(
  input: string,
  canBeMoney: boolean,
  user: UserRow,
  deps: IntentDeps,
): Promise<LineMessage[]> {
  const id = await putPendingIntent(deps.db, user.id, { text: input, decision: null }, deps.now());
  const picks: [string, string][] = [
    ["บันทึกเป็นโน้ต", "note"],
    ["ไม่บันทึก", "no"],
  ];
  if (canBeMoney) picks.splice(1, 0, ["จดเป็นรายการเงิน", "money"]);
  return [choices(SECRET_ASK_TEXT, id, picks)];
}

/**
 * Sort a message the rules cannot be trusted with, then act or ask. Null carries on down the money
 * path: it was money, or the AI could not help and the message reads as an ordinary entry.
 */
export async function routeText(
  input: string,
  parsed: ParseResult,
  user: UserRow,
  deps: IntentDeps,
): Promise<LineMessage[] | null> {
  const { db } = deps;
  if (looksSecret(input)) return askAboutSecret(input, parsed.entries.length > 0, user, deps);

  const hold = (decision: IntentDecision) =>
    putPendingIntent(db, user.id, { text: input, decision }, deps.now());
  const plan = effectivePlan(user.plan, user.plan_expires_at, deps.now());
  const decision = await runRouter(
    { router: deps.router, now: deps.now },
    { db, userId: user.id, plan, text: input },
  );
  if (!decision) {
    return clockIsTheAmount(input, parsed.entries) ? [text(ROUTER_REMINDER_HINT_TEXT)] : null;
  }
  if (decision.intent === "unclear") {
    const id = await hold(decision);
    return [
      choices(INTENT_UNCLEAR_TEXT, id, [
        ["จดเป็นรายการเงิน", "money"],
        ["จดเป็นโน้ต", "note"],
        ["ตั้งเตือน", "reminder"],
        ["ไม่ทำอะไร", "no"],
      ]),
    ];
  }
  if (decision.confidence < ROUTER_ACT_CONFIDENCE) {
    const id = await hold(decision);
    return [
      choices(INTENT_CONFIRM_TEXT(CONFIRM_LABEL[decision.intent]), id, [
        ["ใช่", "yes"],
        ["ไม่ใช่", "no"],
      ]),
    ];
  }
  if (decision.intent === "money") {
    return parsed.entries.length === 0 && !can(plan, "smartParse") ? [text(MONEY_HINT_TEXT)] : null;
  }
  return execute(input, decision, user, deps);
}

/** The answer to `choices`. The waiting message is taken once, so a second tap does nothing. */
export async function handleIntentPick(
  id: string,
  pick: string,
  user: UserRow,
  deps: IntentDeps,
): Promise<LineMessage[]> {
  const pending = await takePendingIntent(deps.db, user.id, id, deps.now());
  if (!pending) return [text(INTENT_EXPIRED_TEXT)];
  const { input, decision } = pending;

  if (pick === "yes" && decision) return execute(input, decision, user, deps);
  if (pick === "note") return deps.run({ kind: "note-add", body: input });
  if (pick === "reminder") return deps.run({ kind: "remind-add", text: input });
  if (pick === "money") return deps.recordMoney(input);
  if (pick === "no") return [text(INTENT_CANCELLED_TEXT)];
  if (pick.startsWith("rm:") && decision) {
    const reminderId = pick.slice(3);
    if (!UUID_RE.test(reminderId)) return [text(INTENT_EXPIRED_TEXT)];
    const waiting = await listReminders(deps.db, user.id);
    const reminder = waiting.find((r) => r.id === reminderId);
    if (!reminder) return [text(REMINDER_GONE_TEXT)];
    return moveReminder(reminder, decision, user, deps);
  }
  return [text(INTENT_EXPIRED_TEXT)];
}
