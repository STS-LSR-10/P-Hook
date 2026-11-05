import type { AiCharge } from "@/lib/ai/ai-quota";
import { ROUTER_ACT_CONFIDENCE, type IntentDecision } from "@/lib/ai/intent-router";
import { ASKS_RE, runRouter } from "@/lib/ai/route-text";
import type { GroupCommand, GroupRow } from "@/lib/group";
import { getGroup } from "@/lib/group-repo";
import { log, safeMessage } from "@/lib/log";
import { parseMessage } from "@/lib/parse/text-parser";
import { looksSecret } from "@/lib/secret-text";
import { parseReminder } from "@/lib/user-reminder";
import { refundUsageAmount } from "@/lib/usage";
import { effectivePlan } from "@/lib/plan";
import { ensureUser } from "@/lib/repo";
import type { HandlerDeps } from "./handlers";
import { QUESTION_RE } from "./intent-handlers";

/** The use of the AI a group message took, and who it was taken from. */
export type GroupCharge = AiCharge & { userId: string };

/**
 * A message in a group that is meant for the bot but is no exact command ("@พี่ฮูก ช่วยจดค่าข้าว 120",
 * "ฮูก ตั้งเตือนพรุ่งนี้บ่ายสาม"): the AI reads it, on the "ถาม AI" quota of the one who typed it, and
 * it becomes the group commands that do the work. Null when the AI cannot help (the group is not open
 * or its owner's plan has run out, no AI, the typer's quota is used up, it failed or the text looks
 * secret): the caller then does what it did before, and nothing was taken. A group answers for
 * everyone, so nothing here asks a question back: what the AI is unsure of, or the group cannot do,
 * goes to พี่ฮูก as a question.
 */
export async function readGroupWithAi(
  said: string,
  lineUserId: string,
  lineGroupId: string,
  deps: HandlerDeps,
  /** Can the group still be written to (its owner is still on Elite)? */
  canWrite: (group: GroupRow) => Promise<boolean>,
): Promise<{ commands: GroupCommand[]; charge: GroupCharge } | null> {
  if (!deps.router || !said.trim() || looksSecret(said)) return null;
  try {
    // a closed ledger, or one whose owner's plan ran out, answers by itself: no use is taken for it
    const group = await getGroup(deps.db, lineGroupId);
    if (!group?.isActive || !(await canWrite(group))) return null;
    const user = await ensureUser(deps.db, lineUserId, () => deps.getProfile(lineUserId));
    let charged: AiCharge | null = null;
    const decision = await runRouter(
      { router: deps.router, now: deps.now, onCharged: (c) => (charged = c) },
      {
        db: deps.db,
        userId: user.id,
        plan: effectivePlan(user.plan, user.plan_expires_at, deps.now()),
        text: said,
      },
    );
    if (!decision || !charged) return null;
    const charge: GroupCharge = { userId: user.id, ...(charged as AiCharge) };
    return { commands: toGroupCommands(decision, said, charge, deps.now()), charge };
  } catch (error) {
    log.warn("group_ai_failed", { reason: safeMessage(error) });
    return null;
  }
}

/** Give a use back: the AI read the message but nothing came of it. Never throws. */
export async function refundGroupCharge(deps: HandlerDeps, charge: GroupCharge): Promise<void> {
  await refundUsageAmount(deps.db, charge.userId, "ai_chat", charge.units, charge.month).catch(
    (error) => log.error("group_ai_refund_failed", error),
  );
}

/** "ช่วยจดค่าข้าว 120 หน่อยนะ" -> "ค่าข้าว 120": the words that asked the bot are not the entry. */
export function entryOf(said: string): string {
  return said
    .replace(/^\s*(?:ช่วย)?(?:จด|บันทึก|ลง)(?:ให้)?\s*/, "")
    .replace(/\s*เมื่อกี้\s*/g, " ")
    .replace(/(?:\s*(?:หน่อย|ด้วย|นะ|น้า|ครับ|ค่ะ|คะ|จ้า))+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the AI's reading means in a group. Anything it cannot do there is a question to พี่ฮูก. */
export function toGroupCommands(
  d: IntentDecision,
  said: string,
  paid: GroupCharge,
  now: Date,
): GroupCommand[] {
  const ask: GroupCommand = { kind: "owl", question: said, prepaid: paid };
  if (d.confidence < ROUTER_ACT_CONFIDENCE) return [ask];
  switch (d.intent) {
    case "money": {
      // a question with an amount ("ค่าไฟ 2000 แพงไหม") is a question; so is what cannot be read as an entry
      if (QUESTION_RE.test(said) || ASKS_RE.test(said)) return [ask];
      const body = entryOf(said);
      return parseMessage(body, now).entries.length > 0 ? [{ kind: "record", body }] : [ask];
    }
    case "reminder_add": {
      const text = d.reminderText ?? said;
      return parseReminder(text, now).ok ? [{ kind: "remind-add", text }] : [ask];
    }
    case "note_add":
      return [{ kind: "note-add", body: said }];
    case "file_save":
      return [{ kind: "file-keep", name: d.fileName }];
    case "search": {
      const term = d.searchTerm ?? said;
      // the group's ledger is asked about as a question; notes and files are searched
      if (d.searchIn === "entries") return [ask];
      if (d.searchIn === "files") return [{ kind: "file-list", term }];
      if (d.searchIn === "notes") return [{ kind: "note-list", term }];
      return [
        { kind: "note-list", term },
        { kind: "file-list", term },
      ];
    }
    case "query":
      return d.period === "today" || d.period === "this_month" || !d.period
        ? [{ kind: "summary", scope: d.period === "today" ? "today" : "month" }]
        : [ask];
    default:
      return [ask];
  }
}
