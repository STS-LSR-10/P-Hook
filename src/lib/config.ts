/**
 * Tunable product rules in one place (points, referral, limits). Change a number here to
 * change the rule everywhere; the SQL functions take these values as arguments.
 */

/** Points for each day on which the user records at least one entry (1 per day: no farming). */
export const DAILY_POINT = 1;

/** Pro Pass packs the coins buy (the price is decided here, never by the browser). */
export const PASS_PACKS = [
  { id: "pass3", days: 3, coins: 35 },
  { id: "pass7", days: 7, coins: 75 },
  { id: "pass15", days: 15, coins: 150 },
] as const;
/** The cheapest pack's price: below this the coins buy nothing yet. */
export const CHEAPEST_PACK = Math.min(...PASS_PACKS.map((p) => p.coins));
export type PassPackId = (typeof PASS_PACKS)[number]["id"];

/** Referral rewards, paid once when the referred user records their first entry. */
export const REFERRAL_BONUS_REFERRER = 5;
export const REFERRAL_BONUS_REFEREE = 5;
/** The referrer is paid for at most this many friends a month. */
export const REFERRAL_MONTHLY_CAP = 5;

/** Paid Referral: a referred friend's first real payment gives the referrer these coins and days, and the friend the days. */
export const PAID_REFERRAL_COINS = 30;
export const PAID_REFERRAL_DAYS = 30;
/** The referrer is rewarded for at most this many paying friends a month. */
export const PAID_REFERRAL_MONTHLY_CAP = 5;

/** Streaks: a bonus each time the run of recording days reaches a multiple of these. */
export const STREAK_WEEK_DAYS = 7;
export const STREAK_WEEK_BONUS = 3;
export const STREAK_MONTH_DAYS = 30;
export const STREAK_MONTH_BONUS = 15;

/** One-time quests (once per account) and the monthly share. */
export const FIRST_SLIP_BONUS = 3;
export const FIRST_BUDGET_BONUS = 2;
export const SHARE_BONUS = 3;

/** A referral code can only be applied by users who joined within this many days. */
export const REFERRAL_WINDOW_DAYS = 14;

/** Most rows in one export file. */
export const MAX_EXPORT_ROWS = 5000;

/** Export download links stop working after this many seconds. */
export const EXPORT_LINK_TTL_SECONDS = 120;

/** Reminder is skipped if the cron runs later than this many hours after the chosen time. */
export const REMINDER_GRACE_HOURS = 3;

/** The bot's LINE Official Account basic ID (not a secret); people who are not its friends are sent to add it. */
export const LINE_OA_BASIC_ID = process.env.NEXT_PUBLIC_LINE_OA_BASIC_ID ?? "@p-hook";

/** The "add friend" link of the bot. */
export const addFriendUrl = (basicId: string = LINE_OA_BASIC_ID): string =>
  `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
