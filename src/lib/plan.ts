/**
 * Single place for plan limits and feature flags (Free / Pro / Elite).
 * Payments are a stub for now; plan_expires_at is also how redeemed points grant Pro days.
 *
 * The stored id "plus" is the Pro tier (kept so no data has to be migrated); show
 * `PLAN_LABEL[plan]` to people, never the id.
 */
export type Plan = "free" | "plus" | "ultimate";

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  plus: "Pro",
  ultimate: "Elite",
};

/** How many wallets a person can have, by plan. Null means no plan limit (the guard below still applies). */
export const WALLET_LIMIT: Record<Plan, number | null> = {
  free: 1,
  plus: 5,
  ultimate: null,
};

/** A guard against runaway creation for plans without a limit. */
export const WALLET_HARD_CAP = 50;

/** Live savings goals ("piggy banks") a plan may have at once. */
const GOAL_LIMIT: Record<Plan, number> = { free: 0, plus: 5, ultimate: 20 };
export const goalCapacity = (plan: Plan): number => GOAL_LIMIT[plan];

/**
 * People on one shared wallet (the owner included), by the OWNER's plan: Pro two (a
 * couple), Elite up to ten. A free plan cannot start a shared wallet (but can be invited to one).
 */
const SHARED_MEMBER_LIMIT: Record<Plan, number> = { free: 0, plus: 2, ultimate: 10 };
export const sharedMemberLimit = (plan: Plan): number => SHARED_MEMBER_LIMIT[plan];
/** Shared wallets one person may own at the same time. */
const SHARED_WALLET_LIMIT: Record<Plan, number> = { free: 0, plus: 1, ultimate: 5 };
export const sharedWalletCapacity = (plan: Plan): number => SHARED_WALLET_LIMIT[plan];

/** The number of wallets allowed on `plan`. */
export function walletCapacity(plan: Plan): number {
  return WALLET_LIMIT[plan] ?? WALLET_HARD_CAP;
}

/** Photos a person can attach to entries per month (a cost guard; same for every paid plan). */
export const PHOTOS_PER_MONTH = 100;

/**
 * Slips a person can have read per month, by plan. Null means "unlimited" as far as the plan is
 * concerned; the fair-use ceiling below still applies.
 */
export const SLIP_LIMIT: Record<Plan, number | null> = {
  free: 0,
  plus: 30,
  ultimate: null,
};

/** Slip photos a Free account can have read per week (Bangkok Monday to Sunday). */
export const FREE_SLIPS_PER_WEEK = 3;

/**
 * "Unlimited" on Elite means normal use. Past these a month, the paid-per-use AI calls stop until
 * the 1st (typing still works). Shown on the upgrade page as a footnote, so nobody is surprised.
 */
export const FAIR_USE = { slips: 300, voice: 200, smartParse: 300 } as const;

/** Voice messages a person can have read per month, by plan (Free has one free taste for life). */
export const VOICE_LIMIT: Record<Plan, number> = { free: 0, plus: 20, ultimate: FAIR_USE.voice };

/** PDF files (statements, bills, lists) a person can have read per month. Free has none. */
export const PDF_LIMIT: Record<Plan, number> = { free: 0, plus: 10, ultimate: 30 };

/** Questions to พี่ฮูก (the AI assistant) per month, by plan. Each one is a paid AI call. */
export const OWL_LIMIT: Record<Plan, number> = { free: 5, plus: 50, ultimate: 300 };

/** Messages the AI may sort into money, reminder, note and so on, per day. Past it the rules read. */
export const ROUTER_DAILY_LIMIT: Record<Plan, number> = { free: 10, plus: 100, ultimate: 500 };

/** Recurring entries ("รายการประจำ") a plan may have set up at once. */
const RECURRING_LIMIT: Record<Plan, number> = { free: 0, plus: 20, ultimate: 100 };
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

/** The lowest tier that has each feature (Elite always includes everything Pro has). */
export const MIN_PLAN: Record<Feature, "plus" | "ultimate"> = {
  savingsChart: "plus",
  recurring: "plus",
  multiAccount: "plus",
  merchantMemory: "plus",
  dailyReminder: "plus",
  advancedExport: "plus",
  autoSummary: "plus",
  voiceLog: "plus",
  backdate: "plus",
  multiEntry: "plus",
  tags: "plus",
  entryPhoto: "plus",
  smartParse: "ultimate",
  customRange: "plus",
  searchTotals: "plus",
  yearSummary: "plus",
  categoryCompare: "plus",
  export: "plus",
  dashboard: "plus",
  forecast: "ultimate",
  insight: "ultimate",
  customCategory: "plus",
  transfer: "plus",
  creditCard: "plus",
  debts: "ultimate",
  foreignCurrency: "ultimate",
  categoryBudget: "plus",
  budgetAlert: "plus",
  dailyBudget: "plus",
  savingsGoal: "plus",
  billReminder: "ultimate",
  groupLedger: "ultimate",
  sharedWallet: "plus",
  personalize: "plus",
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
  return MIN_PLAN[feature] === "ultimate" ? plan === "ultimate" : isPaidPlan(plan);
}

/** Slips still allowed this month, or null when unlimited. */
export function slipsRemaining(plan: Plan, usedThisMonth: number): number | null {
  const limit = SLIP_LIMIT[plan];
  return limit === null ? null : Math.max(0, limit - usedThisMonth);
}
