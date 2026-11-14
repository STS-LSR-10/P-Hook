import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanOwlAnswer,
  MAX_QUESTION_LENGTH,
  needsPersonalData,
  splitChat,
  type Owl,
} from "@/lib/ai/owl";
import { clearAskWait, isAskWaitLive, startAskWait } from "@/lib/ask-repo";
import { log, safeMessage } from "@/lib/log";
import { looksSecret } from "@/lib/secret-text";
import { loadOwlFacts, renderOwlContext } from "@/lib/owl-context";
import { aiUnits, type AiCharge } from "@/lib/ai/ai-quota";
import { AI_CHAT_LIMIT, effectivePlan } from "@/lib/plan";
import { LIMITS, type LimitRule, type RateLimitResult } from "@/lib/rate-limit";
import type { UserRow } from "@/lib/repo";
import type { PersonaId } from "@/lib/personalize";
import type { LineMessage } from "@/lib/types";
import { monthKey, refundUsageAmount, takeUsageAmount } from "@/lib/usage";
import {
  OWL_DAY_LIMIT_TEXT,
  OWL_END_TEXT,
  OWL_EXAMPLES,
  OWL_FAILED_TEXT,
  OWL_NOT_IN_MODE_TEXT,
  OWL_PROMPT_TEXT,
  OWL_SECRET_TEXT,
  OWL_TOO_LONG_TEXT,
  OWL_UNAVAILABLE_TEXT,
  aiQuotaText,
  text,
} from "./messages";
import { upsellReply } from "./upsell-reply";

export interface OwlDeps {
  db: SupabaseClient;
  now: () => Date;
  /** Absent (no AI key) -> a polite "not available". */
  owl?: Owl;
  limit?: (bucket: string, subject: string, rule: LimitRule) => Promise<RateLimitResult>;
  /** The manner and call name this person chose (best effort: a failure means the usual tone). */
  manner?: (user: UserRow) => Promise<{ persona: PersonaId; name: string | null }>;
}

const MAX_QUICK_REPLIES = 13; // LINE's limit

const END_ACTION = {
  type: "action",
  action: { type: "postback", label: "จบการถาม", data: "a=owlx", displayText: "จบการถาม" },
} as const;

/** A text with quick replies: the example questions (when `examples`) and the way out. */
function withButtons(body: string, examples: boolean): LineMessage {
  return {
    type: "text",
    text: body,
    quickReply: {
      items: [
        ...(examples
          ? OWL_EXAMPLES.map((q) => ({
              type: "action",
              action: { type: "message", label: q.slice(0, 20), text: q },
            }))
          : []),
        END_ACTION,
      ],
    },
  };
}

/** After an action in the mode: another few minutes, and the way out under the last message. */
export async function keepOwlOpen(
  deps: OwlDeps,
  user: UserRow,
  replies: LineMessage[],
): Promise<LineMessage[]> {
  const last = replies.at(-1);
  const items = (last?.quickReply as { items: unknown[] } | undefined)?.items ?? [];
  if (items.includes(END_ACTION)) return replies;
  await startAskWait(deps.db, user.id, deps.now()).catch((e) =>
    log.warn("ask_wait_extend_failed", { reason: safeMessage(e) }),
  );
  // the person's confirm style can be no reply at all
  if (!last || items.length >= MAX_QUICK_REPLIES) return replies;
  return [...replies.slice(0, -1), { ...last, quickReply: { items: [...items, END_ACTION] } }];
}

/** "ถามพี่ฮูก": open the mode and show what can be asked. */
export async function owlStart(deps: OwlDeps, user: UserRow): Promise<LineMessage[]> {
  if (!deps.owl) return [text(OWL_UNAVAILABLE_TEXT)];
  try {
    await startAskWait(deps.db, user.id, deps.now());
  } catch (error) {
    // before migration 0044 is run: the one-question form still works
    log.warn("ask_wait_start_failed", { reason: safeMessage(error) });
    return [text('🦉 พี่ฮูกมาแล้ว พิมพ์ "ฮูก" ตามด้วยคำถามได้เลย เช่น "ฮูก เดือนนี้ใช้ไปเท่าไร"')];
  }
  return [withButtons(OWL_PROMPT_TEXT, true)];
}

/** "จบ" / the button: leave the mode. */
export async function owlEnd(deps: OwlDeps, user: UserRow): Promise<LineMessage[]> {
  const live = await isAskWaitLive(deps.db, user.id, deps.now());
  await clearAskWait(deps.db, user.id);
  return [text(live ? OWL_END_TEXT : OWL_NOT_IN_MODE_TEXT)];
}

/** Is the person in the mode right now (what they type is a question)? */
export function inOwlMode(deps: OwlDeps, user: UserRow): Promise<boolean> {
  if (!deps.owl) return Promise.resolve(false);
  return isAskWaitLive(deps.db, user.id, deps.now());
}

/**
 * One question. Order matters for cost: length -> daily cap -> monthly quota -> the person's data ->
 * the AI. A question that gets no answer gives its quota back. `inMode` keeps the mode open for
 * another few minutes and adds the way out under the answer.
 */
export async function owlAsk(
  deps: OwlDeps,
  user: UserRow,
  question: string,
  inMode: boolean,
  lineUserId: string,
  /**
   * `prepaid`: the AI already read this message and found a question. With what it took, that is
   * given back if no answer comes; `true` when it is no longer known.
   */
  options: { prepaid?: AiCharge | boolean; history?: () => Promise<string> } = {},
): Promise<LineMessage[]> {
  const prepaid = typeof options.prepaid === "object" ? options.prepaid : null;
  const outcome = { answered: false };
  try {
    return await askOwl(
      deps,
      user,
      question,
      inMode,
      lineUserId,
      Boolean(options.prepaid),
      outcome,
      options.history,
    );
  } finally {
    if (!outcome.answered && prepaid) {
      await refundUsageAmount(deps.db, user.id, "ai_chat", prepaid.units, prepaid.month).catch(
        (e) => log.error("owl_refund_failed", e),
      );
    }
  }
}

async function askOwl(
  deps: OwlDeps,
  user: UserRow,
  question: string,
  inMode: boolean,
  lineUserId: string,
  paid: boolean,
  outcome: { answered: boolean },
  history?: () => Promise<string>,
): Promise<LineMessage[]> {
  const { db } = deps;
  const owl = deps.owl;
  if (!owl) return [text(OWL_UNAVAILABLE_TEXT)];
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return owlStart(deps, user);
  if (q.length > MAX_QUESTION_LENGTH) return [text(OWL_TOO_LONG_TEXT(MAX_QUESTION_LENGTH))];
  if (looksSecret(q)) return [text(OWL_SECRET_TEXT)];

  const now = deps.now();
  if (deps.limit) {
    const day = await deps.limit("owl_day", lineUserId, LIMITS.owlDay);
    if (!day.allowed) return [text(OWL_DAY_LIMIT_TEXT)];
  }

  // one quota for all of the AI in the chat ("ถาม AI"): a use for each 20 words of the question
  const plan = effectivePlan(user.plan, user.plan_expires_at, now);
  const limit = AI_CHAT_LIMIT[plan];
  const month = monthKey(now);
  const units = paid ? 0 : aiUnits(q);
  if (units > 0) {
    let allowed = false;
    try {
      allowed = await takeUsageAmount(db, user.id, "ai_chat", units, limit, month);
    } catch (error) {
      log.error("owl_quota_failed", error);
      return [text(OWL_FAILED_TEXT)];
    }
    if (!allowed) {
      return plan === "free"
        ? upsellReply(db, user.id, now, "owl", aiQuotaText(plan, limit))
        : [text(aiQuotaText(plan, limit))];
    }
  }

  try {
    // the person's records go to the AI only for a question about them; "ทำไมท้องฟ้าสีฟ้า" gets none
    const data = needsPersonalData(q)
      ? renderOwlContext(await loadOwlFacts(db, user.id, q, now))
      : "";
    const manner = await deps.manner?.(user).catch((e) => {
      log.warn("owl_manner_failed", { reason: safeMessage(e) });
      return undefined;
    });
    const recent = (await history?.().catch(() => "")) ?? "";
    const reply = cleanOwlAnswer(
      await owl.answer({
        question: q,
        data,
        ...(recent ? { history: recent } : {}),
        ...(manner ? { persona: manner.persona, callName: manner.name } : {}),
      }),
    );
    if (!reply) return [text(OWL_FAILED_TEXT)];
    outcome.answered = true;
    if (inMode) {
      await startAskWait(db, user.id, now).catch((e) =>
        log.warn("ask_wait_extend_failed", { reason: safeMessage(e) }),
      );
    }
    // a bubble for each line, the way a friend chats; the buttons go under the last one
    const parts = splitChat(reply);
    return parts.map((t, i) =>
      inMode && i === parts.length - 1 ? withButtons(t, false) : text(t),
    );
  } catch (error) {
    log.warn("owl_failed", { owl: owl.name, reason: safeMessage(error) });
    return [text(OWL_FAILED_TEXT)];
  } finally {
    if (!outcome.answered && units > 0) {
      await refundUsageAmount(db, user.id, "ai_chat", units, month).catch((e) =>
        log.error("owl_refund_failed", e),
      );
    }
  }
}
