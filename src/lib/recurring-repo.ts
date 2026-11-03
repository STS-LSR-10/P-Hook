import type { SupabaseClient } from "@supabase/supabase-js";
import { can, effectivePlan, type Plan } from "@/lib/plan";
import { satangToString, toSatang } from "@/lib/money";
import { dueRuns, resumeAfter, type Cadence } from "@/lib/recurring";
import type { TxType } from "@/lib/types";
import { log } from "@/lib/log";
import { runInZone } from "@/lib/zone-scope";

export interface RuleRow {
  id: string;
  type: TxType;
  amount: number | string;
  title: string;
  category_id: string | null;
  cadence: Cadence;
  day_of_period: number | null;
  next_run_at: string;
  is_active: boolean;
}

const RULE_COLUMNS = "id,type,amount,title,category_id,cadence,day_of_period,next_run_at,is_active";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

export async function listRules(db: SupabaseClient, userId: string): Promise<RuleRow[]> {
  const { data, error } = await db
    .from("recurring_rules")
    .select(RULE_COLUMNS)
    .eq("user_id", userId)
    .order("next_run_at", { ascending: true });
  if (error) fail("list rules", error);
  return (data ?? []) as RuleRow[];
}

export async function countRules(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("recurring_rules")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) fail("count rules", error);
  return count ?? 0;
}

export async function insertRule(
  db: SupabaseClient,
  input: {
    userId: string;
    type: TxType;
    amountSatang: number;
    title: string;
    categoryId: string | null;
    cadence: Cadence;
    dayOfPeriod: number | null;
    firstRunAt: Date;
  },
): Promise<string> {
  const { data, error } = await db
    .from("recurring_rules")
    .insert({
      user_id: input.userId,
      type: input.type,
      amount: satangToString(input.amountSatang),
      title: input.title,
      category_id: input.categoryId,
      cadence: input.cadence,
      day_of_period: input.dayOfPeriod,
      next_run_at: input.firstRunAt.toISOString(),
      is_active: true,
    })
    .select("id")
    .single();
  if (error) fail("insert rule", error);
  return (data as { id: string }).id;
}

export async function setRuleActive(
  db: SupabaseClient,
  userId: string,
  ruleId: string,
  active: boolean,
): Promise<boolean> {
  const { data, error } = await db
    .from("recurring_rules")
    .update({ is_active: active })
    .eq("id", ruleId)
    .eq("user_id", userId)
    .select("id");
  if (error) fail("update rule", error);
  return (data ?? []).length > 0;
}

export async function deleteRule(
  db: SupabaseClient,
  userId: string,
  ruleId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("recurring_rules")
    .delete()
    .eq("id", ruleId)
    .eq("user_id", userId)
    .select("id");
  if (error) fail("delete rule", error);
  return (data ?? []).length > 0;
}

export interface RecurringRunSummary {
  rulesChecked: number;
  rulesSkippedFree: number;
  entriesCreated: number;
  errors: number;
}

const BATCH = 500;

/**
 * Create the entries of every due rule (called by the daily cron).
 * Safe to run twice: a rule is claimed by moving next_run_at forward with a compare-and-swap
 * before its entries are inserted, so a concurrent run finds nothing left to do.
 * Rules of users whose Plus ended are left untouched (they resume if Plus returns).
 */
export async function runDueRules(db: SupabaseClient, now: Date): Promise<RecurringRunSummary> {
  const summary: RecurringRunSummary = {
    rulesChecked: 0,
    rulesSkippedFree: 0,
    entriesCreated: 0,
    errors: 0,
  };

  const due = await db
    .from("recurring_rules")
    .select(`${RULE_COLUMNS},user_id`)
    .eq("is_active", true)
    .lte("next_run_at", now.toISOString())
    .limit(BATCH);
  if (due.error) fail("load due rules", due.error);
  const rules = (due.data ?? []) as (RuleRow & { user_id: string })[];
  summary.rulesChecked = rules.length;
  if (rules.length === 0) return summary;

  const userIds = [...new Set(rules.map((r) => r.user_id))];
  const users = await db.from("users").select("id,plan,plan_expires_at,timezone").in("id", userIds);
  if (users.error) fail("load rule owners", users.error);
  const owners = (users.data ?? []) as {
    id: string;
    plan: Plan;
    plan_expires_at: string | null;
    timezone?: string | null;
  }[];
  const plusUsers = new Set(
    owners
      .filter((u) => can(effectivePlan(u.plan, u.plan_expires_at, now), "recurring"))
      .map((u) => u.id),
  );
  const zoneOf = new Map(owners.map((u) => [u.id, u.timezone ?? null]));

  for (const rule of rules) {
    if (!plusUsers.has(rule.user_id)) {
      summary.rulesSkippedFree += 1;
      continue;
    }
    // a rule's days and its next run are counted in its owner's zone
    await runInZone(zoneOf.get(rule.user_id), () => runRule(rule));
  }
  return summary;

  async function runRule(rule: (typeof rules)[number]): Promise<void> {
    try {
      const current = new Date(rule.next_run_at);
      const runs = dueRuns(current, now, rule.cadence, rule.day_of_period);
      if (runs.length === 0) return;
      const resume = resumeAfter(current, runs.length, rule.cadence, rule.day_of_period);

      // claim: only one concurrent run can move next_run_at away from the value we read
      const claim = await db
        .from("recurring_rules")
        .update({ next_run_at: resume.toISOString() })
        .eq("id", rule.id)
        .eq("next_run_at", rule.next_run_at)
        .select("id");
      if (claim.error) fail("claim rule", claim.error);
      if ((claim.data ?? []).length === 0) return; // someone else got it

      const insert = await db.from("transactions").insert(
        runs.map((run) => ({
          user_id: rule.user_id,
          type: rule.type,
          amount: satangToString(toSatang(rule.amount)),
          title: rule.title,
          category_id: rule.category_id,
          occurred_at: run.toISOString(),
          source: "recurring",
          status: "confirmed",
          raw_text: rule.title,
        })),
      );
      if (insert.error) {
        // give the occurrences back so the next run retries them
        await db
          .from("recurring_rules")
          .update({ next_run_at: rule.next_run_at })
          .eq("id", rule.id)
          .eq("next_run_at", resume.toISOString());
        fail("insert recurring entries", insert.error);
      }
      summary.entriesCreated += runs.length;
    } catch (error) {
      summary.errors += 1;
      log.error("recurring_rule_failed", error);
    }
  }
}
