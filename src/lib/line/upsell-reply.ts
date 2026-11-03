import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { loadBillingState } from "@/lib/payments/billing-state";
import { trialBlock } from "@/lib/payments/policy";
import { TRIAL_DAYS } from "@/lib/pricing";
import { claimUpsellCard, type UpsellFeature } from "@/lib/upsell";
import type { LineMessage } from "@/lib/types";
import { text } from "./messages";
import { buildUpsellCard } from "./upsell-flex";
import { t } from "@/lib/i18n";

export const TRIAL_STARTED_TEXT = (expires: string) =>
  t("เริ่มทดลองใช้ Pro ฟรี {0} วันแล้ว (ถึง {1}) ลองจดย้อนหลัง อ่านสลิป หรือใช้ฟีเจอร์อื่นได้เลย", TRIAL_DAYS, expires);
export const TRIAL_UNAVAILABLE_TEXT =
  t("เริ่มทดลองใช้ไม่ได้ในตอนนี้ (เคยทดลองแล้ว หรือมีแผนที่ใช้งานอยู่) ดูแผนอัปเกรดได้ที่เมนู “อัปเกรด” นะ");

/**
 * The upgrade pitch for a Free person who reached for a paid feature: the full card the first time
 * today, the plain short text after that (so it never nags). Best effort: any failure falls back to
 * the short text.
 */
export async function upsellReply(
  db: SupabaseClient,
  userId: string,
  now: Date,
  feature: UpsellFeature,
  shortText: string,
  retryText?: string,
): Promise<LineMessage[]> {
  try {
    if (!(await claimUpsellCard(db, userId, feature, now))) return [text(shortText)];
    let trialAvailable = false;
    try {
      trialAvailable = trialBlock(await loadBillingState(db, userId, now), "plus") === null;
    } catch (error) {
      log.error("upsell_trial_state_failed", error);
    }
    const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
    return [
      buildUpsellCard({
        feature,
        trialAvailable,
        upgradeUrl: base ? `${base}/upgrade` : undefined,
        retryText,
        now,
      }),
    ];
  } catch (error) {
    log.error("upsell_card_failed", error);
    return [text(shortText)];
  }
}

/** The "ทดลองใช้ฟรี" button: same rules as the web (`trialBlock`, once per tier), started right in the chat. */
export async function startTrialFromChat(
  db: SupabaseClient,
  userId: string,
  now: Date,
  formatDate: (d: Date) => string,
): Promise<LineMessage[]> {
  const state = await loadBillingState(db, userId, now);
  if (trialBlock(state, "plus")) return [text(TRIAL_UNAVAILABLE_TEXT)];
  const { data, error } = await db.rpc("start_plan_trial", {
    p_user: userId,
    p_plan: "plus",
    p_days: TRIAL_DAYS,
  });
  if (error) throw new Error(`start trial: ${error.message}`);
  if (!data) return [text(TRIAL_UNAVAILABLE_TEXT)];
  return [text(TRIAL_STARTED_TEXT(formatDate(new Date(data as string))))];
}
