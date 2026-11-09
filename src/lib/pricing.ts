import { fileCapacity, formatBytes } from "@/lib/file";
import {
  AI_CHAT_LIMIT,
  FAIR_USE,
  FREE_SLIPS_TOTAL,
  FREE_VOICE_TOTAL,
  GROUP_LEDGER_LIMIT,
  GROUP_REMINDS_PER_MONTH,
  SHARED_MEMBER_LIMIT,
  SLIP_LIMIT,
  VOICE_LIMIT,
  WALLET_LIMIT,
  can,
  goalLimit,
  planAtLeast,
  recurringLimit,
  type Feature,
  type Plan,
} from "@/lib/plan";
import { reminderCapacity, repeatCapacity } from "@/lib/user-reminder";
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
  starter: { monthly: 49, yearly: 349 },
  plus: { monthly: 129, yearly: 699 },
  ultimate: { monthly: 299, yearly: 1990 },
};

/**
 * Launch prices. None are in force for now: the Early Bird offers (limited seats, counted as people
 * buy) replace the old launch period and are added on their own, so until then everyone pays the
 * normal prices.
 */
export const LAUNCH_PRICES: Record<PaidPlan, PlanPrice> = PRICES;

export const LAUNCH_ENDS_TEXT = "";

export const launchActive = (_now: Date): boolean => false;

/**
 * Early Bird (limited seats, one per account). Yearly: the first year at this price, then the normal
 * price. Monthly: the first month only. Seat counts live in the database (early_bird_seats).
 */
export const EARLY_BIRD: Record<PaidPlan, { yearly: number; monthly: number }> = {
  starter: { yearly: 199, monthly: 29 },
  plus: { yearly: 499, monthly: 89 },
  ultimate: { yearly: 1490, monthly: 199 },
};

/** What a plan costs right now. */
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

/** Under the comparison table: what "ไม่จำกัด*" means. Built from the real ceiling so it cannot drift. */
export const FAIR_USE_NOTE = t(
  "*ไม่จำกัดสำหรับการใช้งานตามปกติ: สูงสุดราว {0} ครั้ง/เดือน (AI อ่านประโยคยาว) ครบแล้วพิมพ์จดได้ตามปกติ และใช้ได้ใหม่ต้นเดือนหน้า",
  FAIR_USE.smartParse,
);

export interface FeatureRow {
  /** Short, one line. */
  label: string;
  /** Key of the icon the upgrade page draws beside it. */
  icon: FeatureIcon;
  /** Free, Starter, Pro, Elite. false = not included (shown as a dash). */
  cells: [Cell, Cell, Cell, Cell];
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

/**
 * The cells of a row for a plan-gated feature, from the real gate: a tick where the plan has it, a
 * dash where it does not, and `text` (when given) in place of the tick for a plan. Built from
 * `can`, so the table cannot say something the code does not do.
 */
function gate(feature: Feature, text: Partial<Record<Plan, Cell>> = {}): [Cell, Cell, Cell, Cell] {
  const cell = (p: Plan): Cell => (can(p, feature) ? (text[p] ?? true) : false);
  return [cell("free"), cell("starter"), cell("plus"), cell("ultimate")];
}

/** A count that is a limit, or a dash for none and "ไม่จำกัด" for no limit. */
const count = (n: number | null, word: string): Cell =>
  n === null ? t("ไม่จำกัด") : n === 0 ? false : `${n.toLocaleString("en-US")} ${word}`;
const perPlan = (f: (p: Plan) => Cell): [Cell, Cell, Cell, Cell] => [
  f("free"),
  f("starter"),
  f("plus"),
  f("ultimate"),
];

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: t("จดรายการ"),
    rows: [
      { label: t("จดด้วยข้อความ"), icon: "text", cells: [true, true, true, true] },
      { label: t("บอทจัดหมวดให้อัตโนมัติ"), icon: "shapes", cells: [true, true, true, true] },
      { label: t("ลบ / แก้ล่าสุด"), icon: "undo", cells: [true, true, true, true] },
      {
        label: t("อ่านสลิปอัตโนมัติ"),
        icon: "slip",
        cells: perPlan((p) =>
          p === "free" ? t("ลองฟรี {0} ใบแรก", FREE_SLIPS_TOTAL) : t("{0} ใบ/เดือน", SLIP_LIMIT[p]),
        ),
      },
      { label: t("จดย้อนหลัง"), icon: "calendar", cells: gate("backdate"), feature: "backdate" },
      {
        label: t("จดหลายรายการในข้อความเดียว"),
        icon: "list",
        cells: gate("multiEntry"),
        feature: "multiEntry",
      },
      { label: t("ติดแท็ก #Tag"), icon: "tag", cells: gate("tags"), feature: "tags" },
      {
        label: t("แนบรูปประกอบรายการ"),
        icon: "image",
        cells: gate("entryPhoto"),
        feature: "entryPhoto",
      },
      { label: t("แยกรายการจากใบเสร็จ"), icon: "receipt", cells: [false, false, false, true] },
      {
        label: t("ถาม AI (AI อ่านทุกข้อความในแชท)"),
        icon: "sparkles",
        cells: perPlan((p) => t("{0} ครั้ง/เดือน", AI_CHAT_LIMIT[p].toLocaleString("en-US"))),
      },
      {
        label: t("ให้ AI อ่านประโยคยาวๆ"),
        icon: "sparkles",
        cells: gate("smartParse", { ultimate: t("ไม่จำกัด*") }),
        feature: "smartParse",
      },
      {
        label: t("จดด้วยเสียง"),
        icon: "mic",
        cells: perPlan((p) =>
          p === "free"
            ? t("ลองฟรี {0} ครั้งแรก", FREE_VOICE_TOTAL)
            : t("{0} ครั้ง/เดือน", VOICE_LIMIT[p]),
        ),
        feature: "voiceLog",
      },
      {
        label: t("นำเข้าไฟล์รายการ (PDF Statement)"),
        icon: "receipt",
        cells: [false, false, true, true],
      },
      {
        label: t("จดเงินต่างสกุล"),
        icon: "globe",
        cells: gate("foreignCurrency"),
        feature: "foreignCurrency",
      },
      {
        label: t("ตั้งรายการจดอัตโนมัติ"),
        icon: "repeat",
        cells: perPlan((p) => count(recurringLimit(p), t("รายการ"))),
        feature: "recurring",
      },
      {
        label: t("เตือนจดประจำวัน"),
        icon: "bell",
        cells: gate("dailyReminder"),
        feature: "dailyReminder",
      },
      {
        label: t("บอทจำร้านค้า → หมวด"),
        icon: "store",
        cells: gate("merchantMemory"),
        feature: "merchantMemory",
      },
      {
        label: t("สร้างหมวดของตัวเอง"),
        icon: "shapes",
        cells: gate("customCategory"),
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
        cells: perPlan((p) => count(WALLET_LIMIT[p], t("ใบ"))),
        feature: "multiAccount",
      },
      {
        label: t("โอนระหว่างกระเป๋า"),
        icon: "transfer",
        cells: gate("transfer"),
        feature: "transfer",
      },
      {
        label: t("บัตรเครดิต วงเงิน/ยอดตามรอบบิล"),
        icon: "card",
        cells: gate("creditCard"),
        feature: "creditCard",
      },
      {
        label: t("กระเป๋าร่วมแฟน/ครอบครัว"),
        icon: "users",
        cells: perPlan((p) =>
          can(p, "sharedWallet") ? t("{0} คน", SHARED_MEMBER_LIMIT[p]) : false,
        ),
        feature: "sharedWallet",
      },
      {
        label: t("จดหนี้ ให้ยืม/ยืม"),
        icon: "debt",
        cells: gate("debts"),
        feature: "debts",
      },
      {
        label: t("เตือนจ่ายบิล"),
        icon: "bellring",
        cells: gate("billReminder"),
        feature: "billReminder",
      },
    ],
  },
  {
    title: t("งบและเป้าหมาย"),
    rows: [
      { label: t("ตั้งงบรวม"), icon: "target", cells: [true, true, true, true] },
      {
        label: t("งบแยกตามหมวด"),
        icon: "target",
        cells: gate("categoryBudget"),
        feature: "categoryBudget",
      },
      {
        label: t("เตือนเมื่อใช้งบ 80% / 100%"),
        icon: "bellring",
        cells: gate("budgetAlert"),
        feature: "budgetAlert",
      },
      {
        label: t("งบรายวัน + เตือนทันที"),
        icon: "calendar",
        cells: gate("dailyBudget"),
        feature: "dailyBudget",
      },
      {
        label: t("เป้าหมายการออม"),
        icon: "piggy",
        cells: perPlan((p) => (can(p, "savingsGoal") ? count(goalLimit(p), t("ใบ")) : false)),
        feature: "savingsGoal",
      },
      {
        label: t("หารค่าใช้จ่ายทริป"),
        icon: "plane",
        cells: gate("groupLedger"),
        feature: "groupLedger",
      },
      {
        label: t("สมุดกลุ่ม LINE"),
        icon: "group",
        cells: perPlan((p) =>
          can(p, "groupLedger")
            ? t(
                "{0} กลุ่ม · {1} คน/กลุ่ม",
                GROUP_LEDGER_LIMIT[p].groups,
                GROUP_LEDGER_LIMIT[p].members,
              )
            : false,
        ),
        feature: "groupLedger",
      },
    ],
  },
  {
    title: t("รายงาน"),
    rows: [
      { label: t("สรุปวัน / เดือน / หมวด"), icon: "chart", cells: [true, true, true, true] },
      {
        label: t("สรุปช่วงวันเอง"),
        icon: "range",
        cells: gate("customRange"),
        feature: "customRange",
      },
      {
        label: t("ค้นหาพร้อมยอดรวม"),
        icon: "search",
        cells: gate("searchTotals"),
        feature: "searchTotals",
      },
      {
        label: t("สรุปรายปี"),
        icon: "calendar",
        cells: gate("yearSummary"),
        feature: "yearSummary",
      },
      {
        label: t("เทียบเดือนต่อเดือน"),
        icon: "compare",
        cells: gate("categoryCompare"),
        feature: "categoryCompare",
      },
      {
        label: t("หน้าวิเคราะห์ กราฟแท่ง/โดนัท"),
        icon: "dashboard",
        cells: gate("dashboard"),
        feature: "dashboard",
      },
      {
        label: t("กราฟเก็บออม"),
        icon: "trend",
        cells: gate("savingsChart"),
        feature: "savingsChart",
      },
      {
        label: t("สรุปส่งในแชทอัตโนมัติ"),
        icon: "mail",
        cells: gate("autoSummary"),
        feature: "autoSummary",
      },
      {
        label: t("ส่งออก CSV / Excel"),
        icon: "download",
        cells: gate("export"),
        feature: "export",
      },
      {
        label: t("ส่งออก Excel พร้อมชีตสรุป + ZIP แนบรูป"),
        icon: "sheet",
        cells: gate("advancedExport"),
        feature: "advancedExport",
      },
      {
        label: t("ส่งออก PDF"),
        icon: "sheet",
        cells: gate("pdfExport"),
        feature: "pdfExport",
      },
      {
        label: t("พยากรณ์เงินปลายเดือน"),
        icon: "trend",
        cells: gate("forecast"),
        feature: "forecast",
      },
      {
        label: t("AI Insight วิเคราะห์การใช้จ่าย"),
        icon: "sparkles",
        cells: gate("insight"),
        feature: "insight",
      },
    ],
  },
  {
    title: t("เตือนและคลังไฟล์"),
    rows: [
      {
        label: t("เตือนที่ตั้งไว้ได้"),
        icon: "bell",
        cells: perPlan((p) => t("{0} ครั้ง", reminderCapacity(p))),
      },
      {
        label: t("เตือนประจำ"),
        icon: "repeat",
        cells: perPlan((p) => t("{0} รายการ", repeatCapacity(p))),
      },
      {
        label: t("เตือนในกลุ่ม LINE"),
        icon: "group",
        cells: perPlan((p) =>
          GROUP_REMINDS_PER_MONTH[p] === 0
            ? false
            : t("{0} ครั้ง/เดือน", GROUP_REMINDS_PER_MONTH[p]),
        ),
      },
      {
        label: t("คลังเก็บไฟล์"),
        icon: "store",
        cells: perPlan((p) => formatBytes(fileCapacity(p))),
      },
    ],
  },
  {
    title: t("ส่วนตัวและรางวัล"),
    rows: [
      {
        label: t("ธีมการ์ดและนิสัยบอท"),
        icon: "palette",
        cells: gate("personalize"),
        feature: "personalize",
      },
      { label: t("ล้างข้อมูล / ลบบัญชี"), icon: "trash", cells: [true, true, true, true] },
      { label: t("เหรียญสะสมและชวนเพื่อน"), icon: "gift", cells: [true, true, true, true] },
    ],
  },
];

/** Short selling points shown on each plan card. */
export const PLAN_HIGHLIGHTS: Record<Plan, string[]> = {
  free: [
    t("จดด้วยข้อความ"),
    t("ตั้งหมวดและงบรวม"),
    t("ลองอ่านสลิป {0} ใบ + จดด้วยเสียง {1} ครั้ง", FREE_SLIPS_TOTAL, FREE_VOICE_TOTAL),
  ],
  starter: [
    t("อ่านสลิป {0} ใบ/เดือน + จดด้วยเสียง {1} ครั้ง", SLIP_LIMIT.starter, VOICE_LIMIT.starter),
    t("งบรายวัน/สัปดาห์ + เตือนเมื่อใกล้เกินงบ"),
    t("กระเป๋า 5 ใบ · เป้าหมายออม 2 ใบ · 1 กลุ่ม LINE"),
    t("ส่งออก CSV/Excel · หลายสกุลเงิน"),
  ],
  plus: [
    t("ทุกอย่างใน Starter"),
    t("อ่านสลิป {0} ใบ/เดือน + นำเข้า PDF Statement", SLIP_LIMIT.plus),
    t("AI Insight + พยากรณ์เงินปลายเดือน"),
    t("เตือนจ่ายบิล · 5 กลุ่ม LINE · ส่งออก ZIP"),
  ],
  ultimate: [
    t("ทุกอย่างใน Pro"),
    t("อ่านสลิป {0} ใบ/เดือน + แยกรายการจากใบเสร็จ", SLIP_LIMIT.ultimate),
    t("พิมพ์ประโยคยาวๆ ให้ AI ช่วยอ่าน"),
    t("10 กลุ่ม LINE (20 คน/กลุ่ม) · กระเป๋าไม่จำกัด · ส่งออก PDF"),
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
  if (input.to === input.from || !planAtLeast(input.to, input.from)) return null;
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
