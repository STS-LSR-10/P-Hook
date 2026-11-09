import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaidPlan, Period } from "@/lib/pricing";

/** How long an unpaid reservation holds a seat (the checkout page lasts 30 minutes). */
export const EARLY_BIRD_HOLD_MINUTES = 35;

export interface EarlyBirdOffer {
  plan: PaidPlan;
  period: Period;
  /** null = no limit on seats. */
  total: number | null;
  /** Reserved and paid seats. */
  taken: number;
  paid: number;
  /** Seats left, or null when there is no limit. */
  remaining: number | null;
}

/** Every Early Bird offer with its seats. Empty before migration 0065 is run, so nothing is offered. */
export async function earlyBirdOffers(db: SupabaseClient): Promise<EarlyBirdOffer[]> {
  const [seats, claims] = await Promise.all([
    db.from("early_bird_seats").select("plan,period,total"),
    db.from("early_bird_claims").select("plan,period,status,reserved_at"),
  ]);
  if (seats.error || claims.error) return [];
  // a reservation nobody paid for within the window no longer holds a seat (it is deleted on the next checkout)
  const stale = Date.now() - EARLY_BIRD_HOLD_MINUTES * 60_000;
  const rows = (
    (claims.data ?? []) as { plan: string; period: string; status: string; reserved_at: string }[]
  ).filter((c) => c.status === "paid" || Date.parse(c.reserved_at) >= stale);
  return ((seats.data ?? []) as { plan: PaidPlan; period: Period; total: number | null }[]).map(
    (s) => {
      const mine = rows.filter((c) => c.plan === s.plan && c.period === s.period);
      const taken = mine.length;
      return {
        plan: s.plan,
        period: s.period,
        total: s.total,
        taken,
        paid: mine.filter((c) => c.status === "paid").length,
        remaining: s.total === null ? null : Math.max(0, s.total - taken),
      };
    },
  );
}

/** Reserve a seat for this person (false: full, unknown, or they already hold a paid seat). */
export async function claimEarlyBird(
  db: SupabaseClient,
  userId: string,
  plan: PaidPlan,
  period: Period,
): Promise<boolean> {
  const { data, error } = await db.rpc("claim_early_bird", {
    p_user: userId,
    p_plan: plan,
    p_period: period,
  });
  if (error) return false; // before migration 0065: no offer, the normal price applies
  return data === true;
}

export async function confirmEarlyBird(
  db: SupabaseClient,
  userId: string,
  plan: PaidPlan,
  period: Period,
): Promise<void> {
  const { error } = await db.rpc("confirm_early_bird", {
    p_user: userId,
    p_plan: plan,
    p_period: period,
  });
  if (error) throw new Error(`confirm early bird: ${error.message}`);
}

/** Give back reservations nobody paid within `minutes`. Returns how many. */
export async function releaseEarlyBird(
  db: SupabaseClient,
  minutes = EARLY_BIRD_HOLD_MINUTES,
): Promise<number> {
  const { data, error } = await db.rpc("release_early_bird", { p_minutes: minutes });
  if (error) throw new Error(`release early bird: ${error.message}`);
  return Number(data ?? 0);
}

/** Has this person already used their one Early Bird seat (paid)? */
export async function hasPaidEarlyBird(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("early_bird_claims")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return (data as { status: string } | null)?.status === "paid";
}
