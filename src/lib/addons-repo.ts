import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { effectivePlan } from "@/lib/plan";
import { getUserPlanRow } from "@/lib/slip-repo";
import { type AddonRow, type Bonus, NO_BONUS, sumBonus } from "@/lib/addons";

/**
 * The extra quota a person has bought. Never throws: before migration 0066 (or if the read fails)
 * nobody has any, so the plan's own limits apply.
 */
export async function loadBonus(
  db: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<Bonus> {
  try {
    const { data, error } = await db
      .from("addons")
      .select("kind,units,remaining,expires_at")
      .eq("user_id", userId)
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .limit(500);
    if (error) return NO_BONUS;
    const rows = (data ?? []) as AddonRow[];
    // monthly add-ons (storage, group slots) belong to a paid plan: once it lapses to Free they rest,
    // while the packs people bought once (reminders, slips) stay
    if (rows.some((r) => r.expires_at !== null)) {
      const row = await getUserPlanRow(db, userId);
      if (effectivePlan(row.plan, row.plan_expires_at, now) === "free") {
        return sumBonus(
          rows.filter((r) => r.expires_at === null),
          now,
        );
      }
    }
    return sumBonus(rows, now);
  } catch (error) {
    log.warn("addons_load_failed", { reason: String(error).slice(0, 120) });
    return NO_BONUS;
  }
}

/** Spend one read of a slip pack. False when there is none left. */
export async function takeSlipPack(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("take_slip_pack", { p_user: userId });
  if (error) throw new Error(`take slip pack: ${error.message}`);
  return data === true;
}
