import { money } from "@/lib/money";
import { categoryEmoji } from "@/lib/tx-icon";

/** What the summary page knows about one budget period (its /api/summary answer). */
export interface ShareSummary {
  range: { from: string; to: string };
  cycle: "monthly" | "weekly";
  incomeSatang: number;
  expenseSatang: number;
  balanceSatang: number;
  count: number;
  budgetSatang: number | null;
  /** Null when the plan has no category breakdown (Free). */
  categories:
    { name: string; color: string | null; icon?: string | null; totalSatang: number }[] | null;
}

export interface ShareOptions {
  /** Show percentages and ranks instead of amounts (the default: nobody has to share their money). */
  hideAmounts: boolean;
}

export interface ShareCardModel {
  title: string;
  subtitle: string;
  heroLabel: string;
  heroValue: string;
  /** Two figures under the hero: amounts when shown, else how this period compares. */
  stats: { label: string; value: string }[];
  /** The three biggest categories of spending (none when the plan has no breakdown). */
  top: {
    name: string;
    emoji: string | null;
    color: string | null;
    percent: number;
    amount?: string;
  }[];
  headline: string;
}

const MAX_TOP = 3;
const MIN_BASE_SATANG = 10_000;
const MAX_CHANGE = 999;

const bangkok = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", ...options }).format(new Date(iso));

/** How much `now` is above (+) or below (−) `before`, in whole percent; null when there is nothing to compare. */
export function changePercent(now: number, before: number | null | undefined): number | null {
  // a base under ฿100 says nothing: ฿1 to ฿500 is not "+49900%"
  if (before === null || before === undefined || before < MIN_BASE_SATANG) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return Math.max(-MAX_CHANGE, Math.min(MAX_CHANGE, pct));
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The words and figures of the shareable card; the drawing of it is share-card-draw.ts. */
export function buildShareCard(
  now: ShareSummary,
  before: ShareSummary | null,
  options: ShareOptions,
): ShareCardModel {
  const monthly = now.cycle === "monthly";
  // the month that holds most of the period (a cycle that starts on the 25th is mostly next month's)
  const middle = new Date(
    (new Date(now.range.from).getTime() + new Date(now.range.to).getTime()) / 2,
  );
  const title = monthly
    ? `${bangkok(middle.toISOString(), { month: "long" })}ของฉัน`
    : "สัปดาห์ของฉัน";
  const lastDay = new Date(new Date(now.range.to).getTime() - 1).toISOString();
  const subtitle = `${bangkok(now.range.from, { day: "numeric", month: "short", year: "numeric" })} – ${bangkok(lastDay, { day: "numeric", month: "short", year: "numeric" })}`;

  const change = changePercent(now.expenseSatang, before?.expenseSatang);
  const overBudget = now.budgetSatang !== null && now.expenseSatang > now.budgetSatang;
  const period = monthly ? "เดือนก่อน" : "สัปดาห์ก่อน";

  let headline: string;
  if (now.count === 0) headline = "ยังไม่มีรายการเลย เริ่มจดกันเถอะ";
  else if (overBudget) headline = "เกินงบไปแล้ว พักก่อนนะ 😮‍💨";
  else if (change !== null && change <= -5)
    headline = `ใช้น้อยกว่า${period} ${Math.abs(change)}% เก่งมาก 👏`;
  else if (change !== null && change >= 5)
    headline = `ใช้มากกว่า${period} ${change}% กระเป๋าไหวมั้ย 😅`;
  else if (change !== null && now.expenseSatang > 0)
    headline = `ใช้ใกล้เคียง${period} คุมได้ดีเลย ✌️`;
  else if (now.expenseSatang > 0) headline = `จดมาแล้ว ${now.count} รายการ วินัยดีเลย 💪`;
  else headline = "รอบนี้ยังไม่ได้ใช้จ่ายเลย เก่งมาก 🎉";

  // the big figure: the balance, or (hidden) how much of the budget / income went
  let heroLabel: string;
  let heroValue: string;
  if (options.hideAmounts) {
    if (now.budgetSatang !== null) {
      heroLabel = "ใช้ไปแล้ว";
      const used = pct(now.expenseSatang, now.budgetSatang);
      // over the budget never reads as exactly 100%
      heroValue = `${now.expenseSatang > now.budgetSatang ? Math.max(101, used) : used}% ของงบ`;
    } else if (now.incomeSatang > 0) {
      const keptRaw = ((now.incomeSatang - now.expenseSatang) / now.incomeSatang) * 100;
      heroLabel = keptRaw >= 0 ? "ออมได้" : "ใช้เกินรายรับ";
      // a little over the income is at least 1% over, never "0%"
      heroValue =
        keptRaw >= 0 ? `${Math.floor(keptRaw)}% ของรายรับ` : `${Math.max(1, Math.ceil(-keptRaw))}%`;
    } else {
      heroLabel = "จดไปแล้ว";
      heroValue = `${now.count} รายการ`;
    }
  } else {
    heroLabel = now.balanceSatang >= 0 ? "คงเหลือ" : "ติดลบ";
    heroValue = money(Math.abs(now.balanceSatang));
  }

  const stats = options.hideAmounts
    ? [
        { label: "จดแล้ว", value: `${now.count} รายการ` },
        {
          label: `เทียบ${period}`,
          value: change === null ? "–" : `${change > 0 ? "+" : ""}${change}%`,
        },
      ]
    : [
        { label: "รายรับ", value: money(now.incomeSatang) },
        { label: "รายจ่าย", value: money(now.expenseSatang) },
      ];

  const top = (now.categories ?? []).slice(0, MAX_TOP).map((c) => ({
    name: c.name,
    emoji: categoryEmoji(c.icon),
    color: c.color,
    percent: Math.max(1, pct(c.totalSatang, now.expenseSatang)),
    ...(options.hideAmounts ? {} : { amount: money(c.totalSatang) }),
  }));

  return {
    title,
    subtitle,
    heroLabel,
    heroValue,
    stats,
    top,
    headline,
  };
}
