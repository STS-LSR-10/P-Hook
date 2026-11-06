/** One payment in the history (integer satang). */
export interface PaymentItem {
  id: string;
  amountSatang: number;
  status: "pending" | "paid" | "failed" | "refunded";
  createdAt: string;
  paidAt: string | null;
}

/** Shape of GET /api/me as the settings sections use it. */
export interface Me {
  displayName: string | null;
  pictureUrl: string | null;
  /** The plan in force now (an expired paid plan reads as "free"). */
  plan: "free" | "plus" | "ultimate";
  planExpiresAt: string | null;
  features: Record<string, boolean>;
  slips: { used: number; limit: number | null; remaining: number | null };
  points: number;
  streak: number;
  redeem: { pointsPerDay: number; days: number; cost: number };
  referralCode: string;
  referred: boolean;
  /** Friends invited who recorded a first entry. */
  referrals: number;
  limits: { recurringRules: number; wallets: number };
  payments: { available: boolean; history: PaymentItem[] };
}

export interface Settings {
  /** The person's time zone (an IANA name such as "Asia/Bangkok"). */
  timezone?: string;
  /** The currency the books are kept in ("THB", "USD", …). */
  currency?: string;
  /** The app's language: "th" or "en". */
  locale?: string;
  confirm_style: "full" | "short" | "off";
  budget_cycle: "monthly" | "weekly";
  cycle_start_day: number;
  daily_reminder_enabled: boolean;
  daily_reminder_time: string | null;
  weekly_summary_enabled: boolean;
  monthly_summary_enabled: boolean;
  card_theme?: string;
  bot_persona?: string;
  call_name?: string | null;
  photo_prompt?: boolean;
}

export const cardClass = "space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card";
export const fieldClass =
  "h-12 w-full rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary";
