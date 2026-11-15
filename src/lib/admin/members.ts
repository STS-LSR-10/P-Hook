import type { SupabaseClient } from "@supabase/supabase-js";
import { ADDONS, RETIRED_ADDONS } from "@/lib/addons";
import { earlyBirdOffers, type EarlyBirdOffer } from "@/lib/early-bird-repo";
import { memberCodeOf } from "@/lib/member";
import {
  AI_CHAT_LIMIT,
  effectivePlan,
  GROUP_PUSH_PER_MONTH,
  OWL_LIMIT,
  PDF_LIMIT,
  PLAN_ORDER,
  PRIVATE_PUSH_PER_MONTH,
  SLIP_LIMIT,
  trialLimit,
  VOICE_LIMIT,
  type Plan,
} from "@/lib/plan";
import { monthKey } from "@/lib/usage";

export interface MembersData {
  /** Accounts by the plan in force now (an expired paid plan counts as Free). */
  byPlan: Record<Plan, number>;
  total: number;
  /** People who ever started a free trial. */
  trials: number;
  offers: EarlyBirdOffer[];
  /** Trials that used 80% of a trial limit within their first two days. */
  trialBurn: TrialFlag[];
  /** Add-on boosters: how many were ever bought and how many are in force now, per add-on. */
  addons: { sku: string; sold: number; active: number }[];
}

export interface TrialFlag {
  code: string;
  plan: Plan;
  /** The limit: "slips" or a usage counter kind. */
  what: string;
  percent: number;
}

const TRIAL_LIMITS: Record<string, Record<Plan, number>> = {
  slips: SLIP_LIMIT,
  voice: VOICE_LIMIT,
  pdf: PDF_LIMIT,
  owl: OWL_LIMIT,
  ai_chat: AI_CHAT_LIMIT,
  private_push: PRIVATE_PUSH_PER_MONTH,
  group_push: GROUP_PUSH_PER_MONTH,
};
const BURN_FROM = 0.8;
const BURN_WITHIN_MS = 2 * 86_400_000;

/** Trials under two days old that are close to the end of a trial limit: worth a look, not a ban. */
export function flagTrialBurn(
  trials: { user_id: string; plan: Plan; started_at: string; code: string }[],
  counters: { user_id: string; kind: string; used: number }[],
  slips: { user_id: string; created_at: string }[],
  now: Date,
): TrialFlag[] {
  const flags: TrialFlag[] = [];
  for (const t of trials) {
    if (now.getTime() - Date.parse(t.started_at) > BURN_WITHIN_MS) continue;
    const used = new Map<string, number>(
      counters.filter((c) => c.user_id === t.user_id).map((c) => [c.kind, c.used]),
    );
    used.set(
      "slips",
      slips.filter((s) => s.user_id === t.user_id && s.created_at >= t.started_at).length,
    );
    for (const [what, table] of Object.entries(TRIAL_LIMITS)) {
      const limit = trialLimit(table[t.plan]);
      const share = limit > 0 ? (used.get(what) ?? 0) / limit : 0;
      if (share >= BURN_FROM) {
        flags.push({ code: t.code, plan: t.plan, what, percent: Math.round(share * 100) });
      }
    }
  }
  return flags.sort((a, b) => b.percent - a.percent);
}

async function loadTrialBurn(db: SupabaseClient, now: Date): Promise<TrialFlag[]> {
  const since = new Date(now.getTime() - BURN_WITHIN_MS).toISOString();
  const { data, error } = await db
    .from("plan_trials")
    .select("user_id,plan,started_at,users(plan,member_code)")
    .gte("started_at", since)
    .neq("plan", "ultimate")
    .limit(500);
  if (error || !data?.length) return [];
  const ids = data.map((r) => r.user_id as string);
  const [counters, slips] = await Promise.all([
    db
      .from("usage_counters")
      .select("user_id,kind,used")
      .in("user_id", ids)
      .eq("month", monthKey(now)),
    db
      .from("slips")
      .select("user_id,created_at")
      .in("user_id", ids)
      .gte("created_at", since)
      .limit(5000),
  ]);
  const trials = data.map((r) => {
    const u = (r.users ?? {}) as { member_code?: string };
    return {
      user_id: r.user_id as string,
      plan: r.plan as Plan,
      started_at: r.started_at as string,
      code: u.member_code
        ? memberCodeOf(r.plan as Plan, u.member_code)
        : (r.user_id as string).slice(0, 8),
    };
  });
  return flagTrialBurn(trials, (counters.data ?? []) as never, (slips.data ?? []) as never, now);
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
  const skus = [
    ...ADDONS.map((a) => a.sku),
    ...RETIRED_ADDONS.map((a) => a.sku).filter((k) => by.has(k)),
  ];
  return skus.map((sku) => ({ sku, ...(by.get(sku) ?? { sold: 0, active: 0 }) }));
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
  const [total, paid, trials, offers, addons, trialBurn] = await Promise.all([
    db.from("users").select("id", { count: "exact", head: true }),
    db
      .from("users")
      .select("plan,plan_expires_at")
      .or("plan.neq.free,plan_expires_at.not.is.null")
      .limit(50_000),
    db.from("plan_trials").select("id", { count: "exact", head: true }),
    earlyBirdOffers(db),
    db.from("addons").select("sku,remaining,expires_at").limit(50_000),
    loadTrialBurn(db, now).catch(() => []),
  ]);
  if (total.error) throw new Error(`members: ${total.error.message}`);
  if (paid.error) throw new Error(`members: ${paid.error.message}`);
  const n = total.count ?? 0;
  return {
    byPlan: countByPlan((paid.data ?? []) as never, n, now),
    total: n,
    trials: trials.error ? 0 : (trials.count ?? 0),
    offers,
    trialBurn,
    addons: addons.error ? [] : countAddons((addons.data ?? []) as never, now),
  };
}
