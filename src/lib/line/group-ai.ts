import type { AiCharge } from "@/lib/ai/ai-quota";
import { ROUTER_ACT_CONFIDENCE, type IntentDecision } from "@/lib/ai/intent-router";
import { runRouter } from "@/lib/ai/route-text";
import type { GroupCommand } from "@/lib/group";
import { getGroup } from "@/lib/group-repo";
import { log, safeMessage } from "@/lib/log";
import { effectivePlan } from "@/lib/plan";
import { ensureUser } from "@/lib/repo";
import type { HandlerDeps } from "./handlers";

/**
 * A message in a group that is meant for the bot but is no exact command ("@พี่ฮูก ช่วยจดค่าข้าว 120",
 * "ฮูก ตั้งเตือนพรุ่งนี้บ่ายสาม"): the AI reads it, on the "ถาม AI" quota of the one who typed it, and
 * it becomes the group commands that do the work. Null when the AI cannot help (the group is not open,
 * no AI, the typer's quota is used up, it failed or the text looks secret): the caller then does what
 * it did before. A group answers for everyone, so nothing here asks a question back: what the AI is
 * unsure of, or the group cannot do, goes to พี่ฮูก as a question.
 */
export async function readGroupWithAi(
  said: string,
  lineUserId: string,
  lineGroupId: string,
  deps: HandlerDeps,
): Promise<{ commands: GroupCommand[] } | null> {
  if (!deps.router) return null;
  try {
    // an unopened or closed ledger answers by itself: no use is taken for it
    const group = await getGroup(deps.db, lineGroupId);
    if (!group?.isActive) return null;
    const user = await ensureUser(deps.db, lineUserId, () => deps.getProfile(lineUserId));
    let charge: AiCharge | null = null;
    const decision = await runRouter(
      { router: deps.router, now: deps.now, onCharged: (c) => (charge = c) },
      {
        db: deps.db,
        userId: user.id,
        plan: effectivePlan(user.plan, user.plan_expires_at, deps.now()),
        text: said,
      },
    );
    if (!decision || !charge) return null;
    const paid = { userId: user.id, ...(charge as AiCharge) };
    return { commands: toGroupCommands(decision, said, paid) };
  } catch (error) {
    log.warn("group_ai_failed", { reason: safeMessage(error) });
    return null;
  }
}

/** What the AI's reading means in a group. Anything it cannot do there is a question to พี่ฮูก. */
export function toGroupCommands(
  d: IntentDecision,
  said: string,
  paid: { userId: string; units: number; month: string },
): GroupCommand[] {
  const ask: GroupCommand = { kind: "owl", question: said, prepaid: paid };
  if (d.confidence < ROUTER_ACT_CONFIDENCE) return [ask];
  switch (d.intent) {
    case "money":
      return [{ kind: "record", body: said }];
    case "reminder_add":
      return [{ kind: "remind-add", text: d.reminderText ?? said }];
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
