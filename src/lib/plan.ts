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

/** Photos a person can attach to entries per month (a cost guard; same for every paid plan). */
export const PHOTOS_PER_MONTH = 100;

/**
 * Slips a person can have read per month, by plan. Free has none a month: its first
 * FREE_SLIPS_TOTAL are a taste for life (see below).
 */
export const SLIP_LIMIT: Record<Plan, number> = { free: 0, starter: 60, plus: 250, ultimate: 600 };

/** Slip photos a Free account can have read, ever (a taste of the paid plans). */
export const FREE_SLIPS_TOTAL = 10;

/**
 * Past these a month, the paid-per-use AI calls stop until the 1st (typing still works). smartParse
 * (the AI reading long sentences) has no figure in the plan table, so it keeps a ceiling here.
 */
export const FAIR_USE = { smartParse: 300 } as const;

/** Voice messages a person can have read per month, by plan (Free has ten for life). */
export const VOICE_LIMIT: Record<Plan, number> = { free: 0, starter: 30, plus: 200, ultimate: 400 };

/** Voice messages a Free account can have read, ever. */
export const FREE_VOICE_TOTAL = 10;

/**
 * Daily "who has not paid" reminders the bot posts in an owner's groups per month, by the owner's
 * plan. They ride on replies, so this is a guard on volume rather than on cost.
 */
export const GROUP_REMINDS_PER_MONTH: Record<Plan, number> = {
  free: 0,
  starter: 50,
  plus: 200,
  ultimate: 500,
};

/** LINE groups an owner may keep a ledger in, and how many people one ledger serves, by plan. */
export const GROUP_LEDGER_LIMIT: Record<Plan, { groups: number; members: number }> = {
  free: { groups: 0, members: 0 },
  starter: { groups: 1, members: 5 },
  plus: { groups: 5, members: 10 },
  ultimate: { groups: 10, members: 20 },
};

/** PDF files (statements, bills, lists) a person can have read per month. Free has none. */
export const PDF_LIMIT: Record<Plan, number> = { free: 0, starter: 0, plus: 10, ultimate: 30 };

/** Questions to พี่ฮูก (the AI assistant) per month, by plan. Each one is a paid AI call. */
export const OWL_LIMIT: Record<Plan, number> = { free: 5, starter: 20, plus: 50, ultimate: 300 };

/**
 * "ถาม AI" per month: every chat message the AI reads (money, reminder, note, file, search) and every
 * question to พี่ฮูก, one use for each 20 words. Past it the ordinary rules read the chat instead.
 */
export const AI_CHAT_LIMIT: Record<Plan, number> = {
  free: 200,
  starter: 600,
  plus: 1500,
  ultimate: 5000,
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
  groupLedger: "starter",
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

/** Slips still allowed this month. */
export function slipsRemaining(plan: Plan, usedThisMonth: number): number {
  return Math.max(0, SLIP_LIMIT[plan] - usedThisMonth);
}
