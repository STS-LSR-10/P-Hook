import { AI_CHAT_LIMIT, FAIR_USE, type Feature, type Plan } from "@/lib/plan";
import { t } from "@/lib/i18n";

export type Period = "monthly" | "yearly";
export type PaidPlan = Exclude<Plan, "free">;

export interface PlanPrice {
  /** Whole baht. */
  monthly: number;
  yearly: number;
}

/** The normal prices. */
export const PRICES: Record<PaidPlan, PlanPrice> = {
  plus: { monthly: 59, yearly: 339 },
  ultimate: { monthly: 139, yearly: 799 },
};

/** Launch prices, for everything bought before LAUNCH_ENDS_AT. */
export const LAUNCH_PRICES: Record<PaidPlan, PlanPrice> = {
  plus: { monthly: 39, yearly: 299 },
  ultimate: { monthly: 119, yearly: 699 },
};

/** The launch prices end at the end of 31 Dec 2026 (B.E. 2569), Bangkok time. */
export const LAUNCH_ENDS_AT = new Date("2027-01-01T00:00:00+07:00");
export const LAUNCH_ENDS_TEXT = "31 ธ.ค. 2569";

export const launchActive = (now: Date): boolean => now.getTime() < LAUNCH_ENDS_AT.getTime();

/** What a plan costs right now: the launch price until it ends, the normal price after. */
export function priceFor(plan: PaidPlan, now: Date): PlanPrice {
  return (launchActive(now) ? LAUNCH_PRICES : PRICES)[plan];
}

export interface PricingNow {
  /** True while the launch prices apply. */
  launch: boolean;
  endsText: string;
  /** What is charged now. */
  prices: Record<PaidPlan, PlanPrice>;
  /** The normal prices (shown struck through during the launch). */
  list: Record<PaidPlan, PlanPrice>;
}

export function pricingAt(now: Date): PricingNow {
  const launch = launchActive(now);
  return {
    launch,
    endsText: LAUNCH_ENDS_TEXT,
    prices: launch ? LAUNCH_PRICES : PRICES,
    list: PRICES,
  };
}

export const PERIOD_MONTHS: Record<Period, number> = { monthly: 1, yearly: 12 };

/** Baht per day of the yearly plan, one decimal: 299 -> "0.8". */
export function yearlyPerDay(price: PlanPrice): string {
  return (price.yearly / 365).toFixed(1);
}

/** Whole-number percent saved by paying yearly instead of 12 monthly payments. */
export function yearlySavingPercent(price: PlanPrice): number {
  return Math.round((1 - price.yearly / (price.monthly * 12)) * 100);
}

/** A cell of the comparison table: included, not included, or a short text. */
export type Cell = boolean | string;

/** Under the comparison table: what "ไม่จำกัด*" means. Built from the real ceilings so it cannot drift. */
export const FAIR_USE_NOTE = t(
  "*ไม่จำกัดสำหรับการใช้งานตามปกติ: สูงสุดราว {0} ใบ/เดือน (อ่านสลิป), {1} ครั้ง/เดือน (จดด้วยเสียง), {2} ครั้ง/เดือน (AI อ่านประโยคยาว) ครบแล้วพิมพ์จดได้ตามปกติ และใช้ได้ใหม่ต้นเดือนหน้า",
  FAIR_USE.slips,
  FAIR_USE.voice,
  FAIR_USE.smartParse,
);

export interface FeatureRow {
  /** Short, one line. */
  label: string;
  /** Key of the icon the upgrade page draws beside it. */
  icon: FeatureIcon;
  /** Free, Pro, Elite. false = not included (shown as a dash). */
  cells: [Cell, Cell, Cell];
  /** The plan.ts feature this row describes; a test keeps the rows and the real gates in step. */
  feature?: Feature;
}

export type FeatureIcon =
  | "text"
  | "shapes"
  | "undo"
  | "slip"
  | "calendar"
  | "list"
  | "tag"
  | "image"
  | "receipt"
  | "sparkles"
  | "mic"
  | "globe"
  | "repeat"
  | "bell"
  | "bellring"
  | "store"
  | "wallet"
  | "transfer"
  | "card"
  | "users"
  | "debt"
  | "target"
  | "piggy"
  | "plane"
  | "group"
  | "chart"
  | "range"
  | "search"
  | "compare"
  | "dashboard"
  | "trend"
  | "mail"
  | "download"
  | "sheet"
  | "lock"
  | "palette"
  | "trash"
  | "gift";

export interface FeatureGroup {
  title: string;
  rows: FeatureRow[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: t("จดรายการ"),
    rows: [
      { label: t("จดด้วยข้อความ"), icon: "text", cells: [true, true, true] },
      { label: t("บอทจัดหมวดให้อัตโนมัติ"), icon: "shapes", cells: [true, true, true] },
      { label: t("ลบ / แก้ล่าสุด"), icon: "undo", cells: [true, true, true] },
      {
        label: t("อ่านสลิปอัตโนมัติ"),
        icon: "slip",
        cells: [t("ลองฟรี 1 ใบ"), t("30 ใบ/เดือน"), t("ไม่จำกัด*")],
      },
      { label: t("จดย้อนหลัง"), icon: "calendar", cells: [false, true, true], feature: "backdate" },
      {
        label: t("จดหลายรายการในข้อความเดียว"),
        icon: "list",
        cells: [false, true, true],
        feature: "multiEntry",
      },
      { label: t("ติดแท็ก #Tag"), icon: "tag", cells: [false, true, true], feature: "tags" },
      {
        label: t("แนบรูปประกอบรายการ"),
        icon: "image",
        cells: [false, true, true],
        feature: "entryPhoto",
      },
      { label: t("แยกรายการจากใบเสร็จ"), icon: "receipt", cells: [false, false, true] },
      {
        label: t("ถาม AI (AI อ่านทุกข้อความในแชท)"),
        icon: "sparkles",
        cells: [
          t("{0} ครั้ง/เดือน", AI_CHAT_LIMIT.free.toLocaleString("en-US")),
          t("{0} ครั้ง/เดือน", AI_CHAT_LIMIT.plus.toLocaleString("en-US")),
          t("{0} ครั้ง/เดือน", AI_CHAT_LIMIT.ultimate.toLocaleString("en-US")),
        ],
      },
      {
        label: t("ให้ AI อ่านประโยคยาวๆ"),
        icon: "sparkles",
        cells: [false, false, t("ไม่จำกัด*")],
        feature: "smartParse",
      },
      {
        label: t("จดด้วยเสียง"),
        icon: "mic",
        cells: [t("ลองฟรี 1 ครั้ง"), t("20 ครั้ง/เดือน"), t("ไม่จำกัด*")],
        feature: "voiceLog",
      },
      {
        label: t("จดเงินต่างสกุล"),
        icon: "globe",
        cells: [false, false, true],
        feature: "foreignCurrency",
      },
      {
        label: t("ตั้งรายการจดอัตโนมัติ"),
        icon: "repeat",
        cells: [false, t("20 รายการ"), t("100 รายการ")],
        feature: "recurring",
      },
      {
        label: t("เตือนจดประจำวัน"),
        icon: "bell",
        cells: [false, true, true],
        feature: "dailyReminder",
      },
      {
        label: t("บอทจำร้านค้า → หมวด"),
        icon: "store",
        cells: [false, true, true],
        feature: "merchantMemory",
      },
      {
        label: t("สร้างหมวดของตัวเอง"),
        icon: "shapes",
        cells: [false, true, true],
        feature: "customCategory",
      },
    ],
  },
  {
    title: t("กระเป๋าและหนี้"),
    rows: [
      {
        label: t("กระเป๋าเงินหลายใบ"),
        icon: "wallet",
        cells: [t("1 ใบ"), t("5 ใบ"), t("ไม่จำกัด")],
        feature: "multiAccount",
      },
      {
        label: t("โอนระหว่างกระเป๋า"),
        icon: "transfer",
        cells: [false, true, true],
        feature: "transfer",
      },
      {
        label: t("บัตรเครดิต วงเงิน/ยอดตามรอบบิล"),
        icon: "card",
        cells: [false, true, true],
        feature: "creditCard",
      },
      {
        label: t("กระเป๋าร่วมแฟน/ครอบครัว"),
        icon: "users",
        cells: [false, t("2 คน"), t("10 คน")],
        feature: "sharedWallet",
      },
      {
        label: t("จดหนี้ ให้ยืม/ยืม"),
        icon: "debt",
        cells: [false, false, true],
        feature: "debts",
      },
      {
        label: t("เตือนจ่ายบิล"),
        icon: "bellring",
        cells: [false, false, true],
        feature: "billReminder",
      },
    ],
  },
  {
    title: t("งบและเป้าหมาย"),
    rows: [
      { label: t("ตั้งงบรวม"), icon: "target", cells: [true, true, true] },
      {
        label: t("งบแยกตามหมวด"),
        icon: "target",
        cells: [false, true, true],
        feature: "categoryBudget",
      },
      {
        label: t("เตือนเมื่อใช้งบ 80% / 100%"),
        icon: "bellring",
        cells: [false, true, true],
        feature: "budgetAlert",
      },
      {
        label: t("งบรายวัน + เตือนทันที"),
        icon: "calendar",
        cells: [false, true, true],
        feature: "dailyBudget",
      },
      {
        label: t("เป้าหมายการออม"),
        icon: "piggy",
        cells: [false, t("5 ใบ"), t("20 ใบ")],
        feature: "savingsGoal",
      },
      { label: t("หารค่าใช้จ่ายทริป"), icon: "plane", cells: [false, false, true] },
      {
        label: t("สมุดกลุ่ม LINE"),
        icon: "group",
        cells: [false, false, true],
        feature: "groupLedger",
      },
    ],
  },
  {
    title: t("รายงาน"),
    rows: [
      { label: t("สรุปวัน / เดือน / หมวด"), icon: "chart", cells: [true, true, true] },
      {
        label: t("สรุปช่วงวันเอง"),
        icon: "range",
        cells: [false, true, true],
        feature: "customRange",
      },
      {
        label: t("ค้นหาพร้อมยอดรวม"),
        icon: "search",
        cells: [false, true, true],
        feature: "searchTotals",
      },
      {
        label: t("สรุปรายปี"),
        icon: "calendar",
        cells: [false, true, true],
        feature: "yearSummary",
      },
      {
        label: t("เทียบเดือนต่อเดือน"),
        icon: "compare",
        cells: [false, true, true],
        feature: "categoryCompare",
      },
      {
        label: t("หน้าวิเคราะห์ กราฟแท่ง/โดนัท"),
        icon: "dashboard",
        cells: [false, true, true],
        feature: "dashboard",
      },
      {
        label: t("กราฟเก็บออม"),
        icon: "trend",
        cells: [false, true, true],
        feature: "savingsChart",
      },
      {
        label: t("สรุปส่งในแชทอัตโนมัติ"),
        icon: "mail",
        cells: [false, true, true],
        feature: "autoSummary",
      },
      { label: t("ส่งออก CSV"), icon: "download", cells: [false, true, true], feature: "export" },
      {
        label: t("ส่งออก Excel พร้อมชีตสรุป"),
        icon: "sheet",
        cells: [false, true, true],
        feature: "advancedExport",
      },
      {
        label: t("พยากรณ์เงินปลายเดือน"),
        icon: "trend",
        cells: [false, false, true],
        feature: "forecast",
      },
      {
        label: t("AI Insight วิเคราะห์การใช้จ่าย"),
        icon: "sparkles",
        cells: [false, false, true],
        feature: "insight",
      },
    ],
  },
  {
    title: t("ส่วนตัวและรางวัล"),
    rows: [
      {
        label: t("ธีมการ์ดและนิสัยบอท"),
        icon: "palette",
        cells: [false, true, true],
        feature: "personalize",
      },
      { label: t("ล้างข้อมูล / ลบบัญชี"), icon: "trash", cells: [true, true, true] },
      { label: t("เหรียญสะสมและชวนเพื่อน"), icon: "gift", cells: [true, true, true] },
    ],
  },
];

/** Short selling points shown on each plan card. */
export const PLAN_HIGHLIGHTS: Record<Plan, string[]> = {
  free: [t("จดด้วยข้อความ"), t("ตั้งหมวดและงบรวม")],
  plus: [
    t("อ่านสลิป 30 ใบ/เดือน + จดด้วยเสียง 20 ครั้ง + จดย้อนหลัง"),
    t("รายการจดอัตโนมัติ + เตือนประจำวัน"),
    t("ส่งออก CSV/Excel + กราฟวิเคราะห์"),
    t("กราฟเก็บออม + สรุปในแชท"),
  ],
  ultimate: [
    t("ทุกอย่างใน Pro"),
    t("อ่านสลิปไม่จำกัด + แยกรายการจากใบเสร็จ"),
    t("พิมพ์ประโยคยาวๆ ให้ AI ช่วยอ่าน + จดด้วยเสียง"),
    t("หลายกระเป๋าไม่จำกัด · สมุดกลุ่ม LINE แยกคนจ่าย"),
    t("พยากรณ์เงินปลายเดือน + AI Insight · กระเป๋าร่วมสูงสุด 10 คน"),
  ],
};

/** Free trial length (once per person and tier). */
export const TRIAL_DAYS = 7;

/** Stripe's smallest THB charge. */
export const MIN_CHARGE_BAHT = 10;

export interface UpgradeQuote {
  /** Whole baht to pay for the difference. */
  amountBaht: number;
  /** Days of prepaid time left that the upgrade covers. */
  days: number;
}

const TIER_RANK: Record<PaidPlan, number> = { plus: 1, ultimate: 2 };

/**
 * Price of moving prepaid (PromptPay) time to a higher tier, keeping the end date: the difference
 * in daily price between the two tiers (at the rate of the period that was bought) times the days
 * left. Rounded up to whole baht, at least Stripe's minimum and never above a full new period.
 * Null when `to` is not higher than `from`.
 */
export function prepaidUpgradeQuote(input: {
  from: PaidPlan;
  to: PaidPlan;
  /** Months of the prepaid purchase being upgraded (12 = yearly, otherwise monthly). */
  months: number;
  expiresAt: Date;
  now: Date;
}): UpgradeQuote | null {
  if (TIER_RANK[input.to] <= TIER_RANK[input.from]) return null;
  const period: Period = input.months >= 12 ? "yearly" : "monthly";
  const periodDays = period === "yearly" ? 365 : 30;
  const days = Math.max(
    1,
    Math.ceil((input.expiresAt.getTime() - input.now.getTime()) / 86_400_000),
  );
  // integer arithmetic first, so an exact result (e.g. 40) is not pushed up by float rounding
  const to = priceFor(input.to, input.now)[period];
  const from = priceFor(input.from, input.now)[period];
  const raw = Math.ceil(((to - from) * days) / periodDays);
  const amountBaht = Math.min(to, Math.max(MIN_CHARGE_BAHT, raw));
  return { amountBaht, days };
}
