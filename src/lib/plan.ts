/**
 * Single place for plan limits and feature flags (Free / Starter / Pro / Elite).
 * plan_expires_at is also how redeemed points grant Pro days.
 *
 * The stored ids "plus" (Pro) and "ultimate" (Elite) are kept so no data has to be migrated;
 * "starter" is the tier between Free and Pro. Show `PLAN_LABEL[plan]` to people, never the id.
 */
export type Plan = "free" | "starter" | "plus" | "ultimate";

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  starter: "Starter",
  plus: "Pro",
  ultimate: "Elite",
};

/** Lowest to highest. */
export const PLAN_ORDER: readonly Plan[] = ["free", "starter", "plus", "ultimate"];

/** The plan one step up, or null on the top one. */
export const nextPlanUp = (plan: Plan): Plan | null =>
  PLAN_ORDER[PLAN_ORDER.indexOf(plan) + 1] ?? null;

/** Is `plan` at least `min`? */
export const planAtLeast = (plan: Plan, min: Plan): boolean =>
  PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);

/** How many wallets a person can have, by plan. Null means no plan limit (the guard below still applies). */
export const WALLET_LIMIT: Record<Plan, number | null> = {
  free: 1,
  starter: 5,
  plus: 20,
  ultimate: null,
};

/** A guard against runaway creation for plans without a limit. */
export const WALLET_HARD_CAP = 50;

/** Live savings goals ("piggy banks") a plan may have at once. */
const GOAL_LIMIT: Record<Plan, number | null> = { free: 0, starter: 2, plus: 10, ultimate: null };
/** A guard against runaway creation for the plan without a limit. */
export const GOAL_HARD_CAP = 100;
export const goalCapacity = (plan: Plan): number => GOAL_LIMIT[plan] ?? GOAL_HARD_CAP;
/** The plan's own limit; null when it has none. */
export const goalLimit = (plan: Plan): number | null => GOAL_LIMIT[plan];

/**
 * People on one shared wallet (the owner included), by the OWNER's plan: Pro two (a
 * couple), Elite up to ten. A free plan cannot start a shared wallet (but can be invited to one).
 */
export const SHARED_MEMBER_LIMIT: Record<Plan, number> = {
  free: 0,
  starter: 2,
  plus: 5,
  ultimate: 10,
};
export const sharedMemberLimit = (plan: Plan): number => SHARED_MEMBER_LIMIT[plan];
/** Shared wallets one person may own at the same time. */
const SHARED_WALLET_LIMIT: Record<Plan, number> = { free: 0, starter: 1, plus: 2, ultimate: 5 };
export const sharedWalletCapacity = (plan: Plan): number => SHARED_WALLET_LIMIT[plan];

/** The number of wallets allowed on `plan`. */
export function walletCapacity(plan: Plan): number {
  return WALLET_LIMIT[plan] ?? WALLET_HARD_CAP;
}

/**
 * Slips a person can have read per month, by plan. Free has none a month: its first
 * FREE_SLIPS_TOTAL are a taste for life (see below).
 */
export const SLIP_LIMIT: Record<Plan, number> = { free: 0, starter: 45, plus: 180, ultimate: 400 };

/** Slip photos a Free account can have read, ever (a taste of the paid plans). */
export const FREE_SLIPS_TOTAL = 10;

/** Voice messages a person can have read per month, by plan (Free has ten for life). */
export const VOICE_LIMIT: Record<Plan, number> = { free: 0, starter: 30, plus: 150, ultimate: 250 };

/** Voice messages a Free account can have read, ever. */
export const FREE_VOICE_TOTAL = 10;

/**
 * Daily "who has not paid" reminders the bot posts in an owner's groups per month, by the owner's
 * plan. They ride on replies, so this is a guard on volume rather than on cost.
 */
export const GROUP_REMINDS_PER_MONTH: Record<Plan, number> = {
  free: 0,
  starter: 0,
  plus: 200,
  ultimate: 500,
};

/**
 * Messages an owner's group reminders may push to groups in a month, by the owner's plan. A push to a
 * group counts once per member against the LINE account's monthly messages (a group of 20 uses 20);
 * past it a reminder waits for the next message in the group, which costs nothing.
 */
export const GROUP_PUSH_PER_MONTH: Record<Plan, number> = {
  free: 0,
  starter: 0,
  plus: 100,
  ultimate: 250,
};

/**
 * Reminders pushed to a person's own LINE chat per month, by plan. Each push is a LINE message we
 * pay for; past it the reminder waits in the app and the person is told once.
 */
export const PRIVATE_PUSH_PER_MONTH: Record<Plan, number> = {
  free: 3,
  starter: 50,
  plus: 70,
  ultimate: 120,
};

/** LINE groups an owner may keep a ledger in, and how many people one ledger serves, by plan. */
export const GROUP_LEDGER_LIMIT: Record<Plan, { groups: number; members: number }> = {
  free: { groups: 0, members: 0 },
  starter: { groups: 0, members: 0 },
  plus: { groups: 5, members: 10 },
  ultimate: { groups: 10, members: 20 },
};

/** PDF files (statements, bills, lists) a person can have read per month. Free has none. */
export const PDF_LIMIT: Record<Plan, number> = { free: 0, starter: 0, plus: 5, ultimate: 15 };

/** Questions to พี่ฮูก (the AI assistant) per month, by plan. Each one is a paid AI call. */
export const OWL_LIMIT: Record<Plan, number> = { free: 3, starter: 15, plus: 40, ultimate: 100 };

/**
 * "ถาม AI" per month: every chat message the AI reads (money, reminder, note, file, search) and every
 * question to พี่ฮูก, one use for each 20 words. Past it the ordinary rules read the chat instead.
 */
export const AI_CHAT_LIMIT: Record<Plan, number> = {
  free: 50,
  starter: 500,
  plus: 1200,
  ultimate: 2300,
};

/** Recurring entries ("รายการประจำ") a plan may have set up at once. */
const RECURRING_LIMIT: Record<Plan, number> = { free: 0, starter: 20, plus: 100, ultimate: 300 };
export const recurringLimit = (plan: Plan): number => RECURRING_LIMIT[plan];

export type Feature =
  | "savingsChart"
  | "recurring"
  | "multiAccount"
  | "merchantMemory"
  | "dailyReminder"
  | "advancedExport"
  | "autoSummary"
  | "voiceLog"
  | "backdate"
  | "multiEntry"
  | "tags"
  | "entryPhoto"
  | "smartParse"
  | "customRange"
  | "searchTotals"
  | "yearSummary"
  | "categoryCompare"
  | "export"
  | "pdfExport"
  | "dashboard"
  | "forecast"
  | "insight"
  | "customCategory"
  | "transfer"
  | "creditCard"
  | "debts"
  | "foreignCurrency"
  | "categoryBudget"
  | "budgetAlert"
  | "dailyBudget"
  | "savingsGoal"
  | "billReminder"
  | "groupLedger"
  | "sharedWallet"
  | "personalize";

/**
 * The lowest tier that has each feature (a higher tier always has everything a lower one has). What
 * the plan table did not name sits where it did before, or on Starter when it was a Pro feature.
 */
export const MIN_PLAN: Record<Feature, Plan> = {
  savingsChart: "starter",
  recurring: "starter",
  multiAccount: "starter",
  merchantMemory: "starter",
  dailyReminder: "starter",
  advancedExport: "plus", // the ZIP
  autoSummary: "starter",
  voiceLog: "starter",
  backdate: "starter",
  multiEntry: "starter",
  tags: "starter",
  entryPhoto: "starter",
  smartParse: "ultimate",
  customRange: "starter",
  searchTotals: "starter",
  yearSummary: "starter",
  categoryCompare: "plus", // comparing one period with another
  export: "starter", // Excel / CSV
  pdfExport: "ultimate",
  dashboard: "starter",
  forecast: "plus",
  insight: "plus",
  customCategory: "starter",
  transfer: "starter",
  creditCard: "starter",
  debts: "starter",
  foreignCurrency: "starter",
  categoryBudget: "starter",
  budgetAlert: "starter",
  dailyBudget: "starter",
  savingsGoal: "starter",
  billReminder: "plus",
  groupLedger: "plus",
  sharedWallet: "starter",
  personalize: "starter",
};

export function isPaidPlan(plan: Plan): boolean {
  return plan !== "free";
}

/**
 * The plan in force right now. A future `plan_expires_at` means a paid plan (the stored tier, or
 * Pro for redeemed days on a free row); a past one means the period ended and the user is
 * back on Free.
 */
export function effectivePlan(
  plan: Plan,
  planExpiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): Plan {
  if (planExpiresAt) {
    if (new Date(planExpiresAt).getTime() <= now.getTime()) return "free";
    return plan === "free" ? "plus" : plan;
  }
  return plan;
}

export function can(plan: Plan, feature: Feature): boolean {
  return planAtLeast(plan, MIN_PLAN[feature]);
}

/** Free trial length (once per person). */
export const TRIAL_DAYS = 7;

/** A free trial gets 1 in this many of a plan's monthly limits that cost us money per use (SQL: 0081). */
export const TRIAL_QUOTA_DIVISOR = 5;
export const trialLimit = (limit: number): number =>
  limit <= 0 ? limit : Math.max(1, Math.ceil(limit / TRIAL_QUOTA_DIVISOR));

/**
 * Is the running plan a trial? It started as one and its end is still the trial's own: a plan
 * bought on top ends later, and then the full limits apply.
 */
export function onTrial(
  trialStartedAt: string | null | undefined,
  planExpiresAt: string | null | undefined,
  now: Date,
): boolean {
  if (!trialStartedAt || !planExpiresAt) return false;
  const end = new Date(planExpiresAt).getTime();
  const trialEnd = new Date(trialStartedAt).getTime() + (TRIAL_DAYS * 24 + 1) * 3_600_000;
  return end > now.getTime() && end <= trialEnd;
}

/** Slips still allowed this month. */
export function slipsRemaining(plan: Plan, usedThisMonth: number, trial = false): number {
  const limit = trial ? trialLimit(SLIP_LIMIT[plan]) : SLIP_LIMIT[plan];
  return Math.max(0, limit - usedThisMonth);
}
