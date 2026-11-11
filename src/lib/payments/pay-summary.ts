import { PERIOD_MONTHS, type PlanPrice, type Period } from "@/lib/pricing";
import { bangkokParts, fromBangkok } from "@/lib/thai-date";

export type PayMethod = "card" | "promptpay";

/** One calendar month ahead; a day that does not exist there (31 Jan + 1 month) lands on its last day. */
function addMonths(date: Date, months: number): Date {
  const p = bangkokParts(date);
  const lastDay = new Date(Date.UTC(p.year, p.month - 1 + months + 1, 0)).getUTCDate();
  return fromBangkok(p.year, p.month + months, Math.min(p.day, lastDay), p.hour, p.minute);
}

/** An Early Bird seat helps a card subscription any period, and a PromptPay purchase only when yearly. */
export const earlyBirdFits = (method: PayMethod, period: Period): boolean =>
  method === "card" || period === "yearly";

export interface PaySummary {
  /** What is charged today, in baht. */
  payBaht: number;
  /** What each later charge is (card) or what the period costs normally (PromptPay). */
  regularBaht: number;
  /** An Early Bird price is part of today's charge. */
  early: boolean;
  /** PromptPay: when the paid time ends. Card: when the next charge falls (an estimate, Stripe sets it). */
  until: Date;
}

/**
 * What a payment will do, for the screen before the person is sent to pay. Display only: the
 * server and Stripe decide the real amounts and dates. PromptPay time is added after what is left
 * (as apply_prepaid_purchase does); a card subscription starts now.
 */
export function paySummary(input: {
  method: PayMethod;
  period: Period;
  price: PlanPrice;
  /** The Early Bird price offered for this plan and period, when a seat is left. */
  earlyBaht?: number | null;
  /** End of the plan running now. */
  expiresAt: Date | null;
  now: Date;
}): PaySummary {
  const { method, period, price, expiresAt, now } = input;
  const early = input.earlyBaht != null && earlyBirdFits(method, period);
  const months = PERIOD_MONTHS[period];
  const start = method === "promptpay" && expiresAt && expiresAt > now ? expiresAt : now;
  return {
    payBaht: early ? (input.earlyBaht as number) : price[period],
    regularBaht: price[period],
    early,
    until: addMonths(start, months),
  };
}
