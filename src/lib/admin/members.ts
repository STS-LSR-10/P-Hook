import type { SupabaseClient } from "@supabase/supabase-js";
import { earlyBirdOffers, type EarlyBirdOffer } from "@/lib/early-bird-repo";
import { effectivePlan, PLAN_ORDER, type Plan } from "@/lib/plan";

export interface MembersData {
  /** Accounts by the plan in force now (an expired paid plan counts as Free). */
  byPlan: Record<Plan, number>;
  total: number;
  /** People who ever started a free trial. */
  trials: number;
  offers: EarlyBirdOffer[];
}

/** Count accounts by their plan in force: `rows` are the accounts that are not plain Free. */
export function countByPlan(
  rows: { plan: Plan; plan_expires_at: string | null }[],
  total: number,
  now: Date,
): Record<Plan, number> {
  const out = Object.fromEntries(PLAN_ORDER.map((p) => [p, 0])) as Record<Plan, number>;
  for (const r of rows) out[effectivePlan(r.plan, r.plan_expires_at, now)] += 1;
  out.free = Math.max(0, total - (out.starter + out.plus + out.ultimate));
  return out;
}

export async function loadMembers(db: SupabaseClient, now: Date): Promise<MembersData> {
  const [total, paid, trials, offers] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    db
      .from("users")
      .select("plan,plan_expires_at")
      .or("plan.neq.free,plan_expires_at.not.is.null")
      .limit(50_000),
    db.from("plan_trials").select("id", { count: "exact", head: true }),
    earlyBirdOffers(db),
  ]);
  if (total.error) throw new Error(`members: ${total.error.message}`);
  if (paid.error) throw new Error(`members: ${paid.error.message}`);
  const n = total.count ?? 0;
  return {
    byPlan: countByPlan((paid.data ?? []) as never, n, now),
    total: n,
    trials: trials.error ? 0 : (trials.count ?? 0),
    offers,
  };
}
