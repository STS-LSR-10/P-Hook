import type { SupabaseClient } from "@supabase/supabase-js";
import { type PushKind, refundPushPack, takePushPack } from "@/lib/addons-repo";
import { refundUsageAmount, takeUsageAmount } from "@/lib/usage";

/** Where a push was paid from: the plan's monthly allowance, or a pack bought on top. */
export type PushSource = "plan" | "pack";

/**
 * Take `amount` pushes: from the plan's allowance for the month first, and when that cannot cover it
 * from the person's packs. Null when neither can. Throws when a counter cannot be reached.
 */
export async function takePush(
  db: SupabaseClient,
  userId: string,
  kind: PushKind,
  amount: number,
  allowance: number,
  month: string,
): Promise<PushSource | null> {
  if (await takeUsageAmount(db, userId, kind, amount, allowance, month)) return "plan";
  if (await takePushPack(db, userId, kind, amount)) return "pack";
  return null;
}

/** Give back what `takePush` took, to where it came from: the message did not go out. */
export async function givePush(
  db: SupabaseClient,
  userId: string,
  kind: PushKind,
  amount: number,
  source: PushSource,
  month: string,
): Promise<void> {
  if (source === "plan") await refundUsageAmount(db, userId, kind, amount, month);
  else await refundPushPack(db, userId, kind, amount);
}
