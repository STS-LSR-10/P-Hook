import type { SupabaseClient } from "@supabase/supabase-js";
import { ADDONS } from "@/lib/addons";
import { earlyBirdOffers, type EarlyBirdOffer } from "@/lib/early-bird-repo";
import { effectivePlan, PLAN_ORDER, type Plan } from "@/lib/plan";

export interface MembersData {
  /** Accounts by the plan in force now (an expired paid plan counts as Free). */
  byPlan: Record<Plan, number>;
  total: number;
  /** People who ever started a free trial. */
  trials: number;
  offers: EarlyBirdOffer[];
  /** Add-on boosters: how many were ever bought and how many are in force now, per add-on. */
  addons: { sku: string; sold: number; active: number }[];
}

/** Per add-on: all purchases, and those still in force (not ended, and a slip pack with reads left). */
export function countAddons(
  rows: { sku: string; remaining: number | null; expires_at: string | null }[],
  now: Date,
): MembersData["addons"] {
  const by = new Map<string, { sold: number; active: number }>();
  for (const r of rows) {
    const c = by.get(r.sku) ?? { sold: 0, active: 0 };
    c.sold += 1;
    const ended = r.expires_at !== null && Date.parse(r.expires_at) <= now.getTime();
    if (!ended && (r.remaining === null || r.remaining > 0)) c.active += 1;
    by.set(r.sku, c);
  }
  return ADDONS.map((a) => ({ sku: a.sku, ...(by.get(a.sku) ?? { sold: 0, active: 0 }) }));
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
  const [total, paid, trials, offers, addons] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    db
      .from("users")
      .select("plan,plan_expires_at")
      .or("plan.neq.free,plan_expires_at.not.is.null")
      .limit(50_000),
    db.from("plan_trials").select("id", { count: "exact", head: true }),
    earlyBirdOffers(db),
    db.from("addons").select("sku,remaining,expires_at").limit(50_000),
  ]);
  if (total.error) throw new Error(`members: ${total.error.message}`);
  if (paid.error) throw new Error(`members: ${paid.error.message}`);
  const n = total.count ?? 0;
  return {
    byPlan: countByPlan((paid.data ?? []) as never, n, now),
    total: n,
    trials: trials.error ? 0 : (trials.count ?? 0),
    offers,
    addons: addons.error ? [] : countAddons((addons.data ?? []) as never, now),
  };
}
