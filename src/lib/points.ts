import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DAILY_POINT,
  PASS_PACKS,
  type PassPackId,
  REFERRAL_BONUS_REFEREE,
  REFERRAL_BONUS_REFERRER,
  REFERRAL_MONTHLY_CAP,
  REFERRAL_WINDOW_DAYS,
  SHARE_BONUS,
  STREAK_MONTH_BONUS,
  STREAK_MONTH_DAYS,
  STREAK_WEEK_BONUS,
  STREAK_WEEK_DAYS,
} from "@/lib/config";
import { bangkokParts, fromBangkok } from "@/lib/thai-date";
import { log } from "@/lib/log";

/** "2026-10-16" for the Bangkok calendar day containing `date`. */
export function bangkokDateKey(date: Date): string {
  const p = bangkokParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Current streak: consecutive days with a daily award, counted back from today.
 * A streak stays alive through "yesterday" (today may simply not be recorded yet).
 * `dailyKeys` are "YYYY-MM-DD" strings in any order, duplicates allowed.
 */
export function currentStreak(dailyKeys: string[], now: Date): number {
  const days = new Set(dailyKeys);
  const p = bangkokParts(now);
  const key = (offset: number) => bangkokDateKey(fromBangkok(p.year, p.month, p.day - offset, 12));

  let offset = days.has(key(0)) ? 0 : days.has(key(1)) ? 1 : -1;
  if (offset === -1) return 0;
  let streak = 0;
  while (days.has(key(offset))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}


export interface AwardResult {
  /** true when this call gave today's point (first activity of the day). */
  awarded: boolean;
  /** true when this call also paid the one-time referral bonus. */
  referralBonus: boolean;
  /** The streak bonus this call paid (a week or a month of recording days), if any. */
  streak: { days: number; bonus: number } | null;
}

/**
 * Call after an entry was confirmed. Gives the day's point once, and on that same first
 * activity pays the referral bonus (if the user was referred). Best effort: never throws.
 */
export async function awardActivity(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<AwardResult> {
  const none: AwardResult = { awarded: false, referralBonus: false, streak: null };
  try {
    const { data, error } = await db.rpc("award_points", {
      p_user: userId,
      p_delta: DAILY_POINT,
      p_reason: "daily",
      p_ref: bangkokDateKey(now),
    });
    if (error || data !== true) return none;

    const bonus = await db.rpc("grant_referral_bonus", {
      p_user: userId,
      p_referrer_bonus: REFERRAL_BONUS_REFERRER,
      p_referee_bonus: REFERRAL_BONUS_REFEREE,
      p_monthly_cap: REFERRAL_MONTHLY_CAP,
    });
    return {
      awarded: true,
      referralBonus: bonus.data === true,
      streak: await awardStreak(db, userId, now),
    };
  } catch (error) {
    log.error("award_failed", error);
    return none;
  }
}

/**
 * The day's point was just given: a streak that reaches 7 days (and every 7 after) pays a bonus, and
 * one that reaches 30 pays a bigger one. A missed day starts the count again, and the bonus is keyed
 * on the run's first day and its length, so one run never pays the same milestone twice.
 */
export async function awardStreak(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<{ days: number; bonus: number } | null> {
  const days = currentStreak(await recentDailyKeys(db, userId), now);
  if (days === 0) return null;
  const p = bangkokParts(now);
  const start = bangkokDateKey(fromBangkok(p.year, p.month, p.day - (days - 1), 12));
  let bonus = 0;
  const pay = async (every: number, amount: number, reason: string) => {
    if (days % every !== 0) return;
    const { data, error } = await db.rpc("award_points", {
      p_user: userId,
      p_delta: amount,
      p_reason: reason,
      p_ref: `${start}:${days}`,
    });
    if (!error && data === true) bonus += amount;
  };
  await pay(STREAK_WEEK_DAYS, STREAK_WEEK_BONUS, "streak_week");
  await pay(STREAK_MONTH_DAYS, STREAK_MONTH_BONUS, "streak_month");
  return bonus > 0 ? { days, bonus } : null;
}

/** A once-per-account reward (the first slip, the first budget). True when this call paid it. Never throws. */
export async function awardOnce(
  db: SupabaseClient,
  userId: string,
  reason: "first_slip" | "first_budget",
  amount: number,
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("award_points", {
      p_user: userId,
      p_delta: amount,
      p_reason: reason,
      p_ref: userId,
    });
    return !error && data === true;
  } catch (error) {
    log.error("award_once_failed", error);
    return false;
  }
}

/** The monthly share reward (once per Bangkok month). True when this call paid it. Never throws. */
export async function awardShare(db: SupabaseClient, userId: string, now: Date): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("award_points", {
      p_user: userId,
      p_delta: SHARE_BONUS,
      p_reason: "share",
      p_ref: bangkokDateKey(now).slice(0, 7),
    });
    return !error && data === true;
  } catch (error) {
    log.error("award_share_failed", error);
    return false;
  }
}

export type ReferralOutcome = "ok" | "invalid" | "self" | "already" | "expired";

export async function applyReferralCode(
  db: SupabaseClient,
  userId: string,
  code: string,
): Promise<ReferralOutcome> {
  const { data, error } = await db.rpc("apply_referral", {
    p_user: userId,
    p_code: code,
    p_window_days: REFERRAL_WINDOW_DAYS,
  });
  if (error) throw new Error(`apply referral: ${error.message}`);
  return data as ReferralOutcome;
}

/** Recent "daily" award dates, newest first (enough for a streak). */
export async function recentDailyKeys(db: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("point_ledger")
    .select("ref")
    .eq("user_id", userId)
    .eq("reason", "daily")
    .order("ref", { ascending: false })
    .limit(400);
  if (error) return [];
  return (data ?? []).map((r) => (r as { ref: string | null }).ref).filter((r): r is string => !!r);
}

export class NotEnoughPointsError extends Error {}

/** Spend coins on a Pro Pass pack. Returns the new Pro expiry. */
export async function redeemForPlus(
  db: SupabaseClient,
  userId: string,
  packId: PassPackId,
): Promise<string> {
  const pack = PASS_PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error(`redeem: unknown pack ${packId}`);
  const { data, error } = await db.rpc("redeem_points", {
    p_user: userId,
    p_points: pack.coins,
    p_days: pack.days,
  });
  if (error) {
    if (error.message.includes("not_enough_points")) throw new NotEnoughPointsError();
    throw new Error(`redeem: ${error.message}`);
  }
  return data as string;
}
