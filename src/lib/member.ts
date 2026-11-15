import { t } from "@/lib/i18n";
import type { Plan } from "@/lib/plan";
import { bangkokParts, formatThaiDate, fromBangkok } from "@/lib/thai-date";

/** Whole calendar days (Bangkok) from the day they joined to `now`: 0 on the first day. */
export function memberDays(joinedAt: Date, now: Date): number {
  const day = (d: Date) => {
    const p = bangkokParts(d);
    return fromBangkok(p.year, p.month, p.day).getTime();
  };
  return Math.max(0, Math.round((day(now) - day(joinedAt)) / 86_400_000));
}

/** "2 พ.ย. 2569 (12 วัน)", or "(วันนี้)" on the first day. */
export function joinedLabel(joinedAt: string, now: Date): string {
  const at = new Date(joinedAt);
  const days = memberDays(at, now);
  return `${formatThaiDate(at)} ${days === 0 ? t("(วันนี้)") : t("({0} วัน)", days)}`;
}

const PLAN_LETTER: Record<Plan, string> = { free: "F", starter: "S", plus: "P", ultimate: "E" };

/** "PH-P2600010": the plan letter, the year (26), then the number to join that year, 5 digits. */
export const memberCodeOf = (plan: Plan, stored: string): string =>
  `PH-${PLAN_LETTER[plan]}${stored.slice(0, 2)}${stored.slice(2).padStart(5, "0")}`;
