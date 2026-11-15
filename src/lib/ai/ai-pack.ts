import type { SupabaseClient } from "@supabase/supabase-js";
import { refundPushPack, takePushPack } from "@/lib/addons-repo";
import { log, safeMessage } from "@/lib/log";
import { AI_CHAT_LIMIT, type Plan } from "@/lib/plan";
import { refundUsageAmount, takeUsageAmount } from "@/lib/usage";

/** Where a use of "ถาม AI" was paid from: the plan's monthly allowance, or a pack bought on top. */
export type AiSource = "plan" | "pack";

/**
 * Take `units` of "ถาม AI": from the plan's allowance for the month first, and when that cannot
 * cover them from the person's AI packs. Null when neither can. Throws when a counter is out of reach.
 */
export async function takeAi(
  db: SupabaseClient,
  userId: string,
  plan: Plan,
  units: number,
  month: string,
): Promise<AiSource | null> {
  if (await takeUsageAmount(db, userId, "ai_chat", units, AI_CHAT_LIMIT[plan], month)) return "plan";
  // the plan is out: a pack that cannot be reached (before migration 0079) counts as none
  try {
    if (await takePushPack(db, userId, "ai", units)) return "pack";
  } catch (error) {
    log.warn("ai_pack_unreachable", { reason: safeMessage(error) });
  }
  return null;
}

/** Give back what `takeAi` took, to where it came from. A charge with no source came from the plan. */
export async function giveAi(
  db: SupabaseClient,
  userId: string,
  units: number,
  month: string,
  source: AiSource = "plan",
): Promise<void> {
  if (source === "pack") await refundPushPack(db, userId, "ai", units);
  else await refundUsageAmount(db, userId, "ai_chat", units, month);
}
