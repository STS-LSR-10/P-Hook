import { fileCapacity, fileDayLimit } from "@/lib/file";
import { MAX_GROUPS_PER_OWNER } from "@/lib/group";
import { noteCapacity } from "@/lib/note";
import {
  can,
  FAIR_USE,
  FREE_SLIPS_PER_WEEK,
  goalCapacity,
  GROUP_REMINDS_PER_MONTH,
  OWL_LIMIT,
  PDF_LIMIT,
  PHOTOS_PER_MONTH,
  recurringLimit,
  ROUTER_DAILY_LIMIT,
  SLIP_LIMIT,
  VOICE_LIMIT,
  walletCapacity,
  type Plan,
} from "@/lib/plan";
import { reminderCapacity, repeatCapacity } from "@/lib/user-reminder";

/** How a quota counts: what you keep ("total"), per day / week / month, or once for life. */
export type QuotaPeriod = "total" | "day" | "week" | "month" | "once";

const PLANS: Plan[] = ["free", "plus", "ultimate"];

export interface QuotaItem {
  key: string;
  label: string;
  /** What it counts, in a line. */
  hint: string;
  /** The word after a number: "ครั้ง", "ไฟล์", "กลุ่ม" (empty for bytes). */
  word: string;
  /** The icon the page shows for it. */
  icon: QuotaIcon;
  used: number;
  /** Null: no plan limit. 0: not on this plan. */
  limit: number | null;
  unit: "count" | "bytes";
  period: QuotaPeriod;
  /** What each plan gets, to compare in the detail sheet. */
  plans: Record<Plan, { limit: number | null; period: QuotaPeriod }>;
}

export type QuotaIcon =
  | "receipt"
  | "pdf"
  | "group"
  | "bell"
  | "repeat"
  | "megaphone"
  | "storage"
  | "owl"
  | "voice"
  | "photo"
  | "ai"
  | "upload"
  | "note"
  | "recurring"
  | "wallet"
  | "goal";

/** What the person has used, each in the period its quota counts. */
export interface QuotaUsage {
  storageBytes: number;
  wallets: number;
  goals: number;
  notes: number;
  /** One-off reminders waiting. */
  reminders: number;
  /** Repeating reminders waiting (their own limit). */
  repeatReminders: number;
  recurring: number;
  /** Group ledgers the person owns. */
  groups: number;
  /** Unpaid-bill reminders posted in their groups this month. */
  groupReminders: number;
  /** This week on Free, this month on a paid plan. */
  slips: number;
  photos: number;
  /** The one free try for life on Free, this month on a paid plan. */
  voice: number;
  pdf: number;
  owl: number;
  router: number;
  fileSaves: number;
}

export interface Quota {
  /** The ones the quota page leads with. */
  main: QuotaItem[];
  /** Everything else, under "โควตาอื่น ๆ". */
  others: QuotaItem[];
}

interface Def {
  key: string;
  label: string;
  hint: string;
  word: string;
  icon: QuotaIcon;
  unit?: "bytes";
  used: number;
  /** The limit and how it counts on a plan. */
  on: (plan: Plan) => { limit: number | null; period: QuotaPeriod };
}

const each = (on: Def["on"]) =>
  Object.fromEntries(PLANS.map((p) => [p, on(p)])) as QuotaItem["plans"];

function item(plan: Plan, def: Def): QuotaItem {
  const { limit, period } = def.on(plan);
  return {
    key: def.key,
    label: def.label,
    hint: def.hint,
    word: def.word,
    icon: def.icon,
    used: def.used,
    limit,
    unit: def.unit ?? "count",
    period,
    plans: each(def.on),
  };
}

/** Every quota of `plan` with what was used, in the order the quota page shows them. */
export function buildQuota(plan: Plan, used: QuotaUsage): Quota {
  const main: Def[] = [
    {
      key: "slips",
      label: "จดด้วยสลิป/ใบเสร็จ",
      // Elite has no plan limit, only normal use
      hint:
        plan === "ultimate"
          ? `รูปสลิปหรือใบเสร็จที่ให้บอทอ่าน · ใช้ได้ตามปกติ ไม่เกิน ${FAIR_USE.slips} ใบต่อเดือน`
          : "รูปสลิปหรือใบเสร็จที่ให้บอทอ่านเป็นรายการ",
      word: "ครั้ง",
      icon: "receipt",
      used: used.slips,
      on: (p) =>
        p === "free"
          ? { limit: FREE_SLIPS_PER_WEEK, period: "week" }
          : { limit: SLIP_LIMIT[p], period: "month" },
    },
    {
      key: "pdf",
      label: "จดด้วย PDF",
      hint: "ไฟล์ PDF (statement บิล รายการ) ที่ให้บอทอ่าน",
      word: "ไฟล์",
      icon: "pdf",
      used: used.pdf,
      on: (p) => ({ limit: PDF_LIMIT[p], period: "month" }),
    },
    {
      key: "groups",
      label: "กลุ่ม",
      hint: "กลุ่ม LINE ที่เปิดบัญชีกลุ่มไว้ (คุณเป็นเจ้าของ)",
      word: "กลุ่ม",
      icon: "group",
      used: used.groups,
      on: (p) => ({ limit: can(p, "groupLedger") ? MAX_GROUPS_PER_OWNER : 0, period: "total" }),
    },
    {
      key: "reminders",
      label: "เตือนครั้งเดียว",
      hint: "เตือนที่ตั้งไว้และยังไม่ถึงเวลา",
      word: "รายการ",
      icon: "bell",
      used: used.reminders,
      on: (p) => ({ limit: reminderCapacity(p), period: "total" }),
    },
    {
      key: "repeatReminders",
      label: "เตือนประจำ",
      hint: "เตือนที่ซ้ำทุกวัน ทุกสัปดาห์ หรือทุกเดือน",
      word: "รายการ",
      icon: "repeat",
      used: used.repeatReminders,
      on: (p) => ({ limit: repeatCapacity(p), period: "total" }),
    },
    {
      key: "groupReminders",
      label: "เตือนกลุ่ม",
      hint: "เตือนคนที่ยังไม่จ่ายบิลในกลุ่ม (วันละครั้งต่อกลุ่ม)",
      word: "ครั้ง",
      icon: "megaphone",
      used: used.groupReminders,
      on: (p) => ({ limit: can(p, "groupLedger") ? GROUP_REMINDS_PER_MONTH : 0, period: "month" }),
    },
    {
      key: "storage",
      label: "พื้นที่จัดเก็บ",
      hint: "ไฟล์และรูปที่ฝากไว้ในคลัง",
      word: "",
      icon: "storage",
      unit: "bytes",
      used: used.storageBytes,
      on: (p) => ({ limit: fileCapacity(p), period: "total" }),
    },
  ];

  const others: Def[] = [
    {
      key: "owl",
      label: "ถามพี่ฮูก",
      hint: "คำถามที่ให้พี่ฮูกตอบ",
      word: "ครั้ง",
      icon: "owl",
      used: used.owl,
      on: (p) => ({ limit: OWL_LIMIT[p], period: "month" }),
    },
    {
      key: "voice",
      label: "จดด้วยเสียง",
      hint: "ข้อความเสียงที่ให้บอทฟังแล้วจด",
      word: "ครั้ง",
      icon: "voice",
      used: used.voice,
      on: (p) =>
        p === "free" ? { limit: 1, period: "once" } : { limit: VOICE_LIMIT[p], period: "month" },
    },
    {
      key: "photos",
      label: "แนบรูปกับรายการ",
      hint: "รูปที่แนบกับรายการที่จดแล้ว",
      word: "รูป",
      icon: "photo",
      used: used.photos,
      on: (p) => ({ limit: can(p, "entryPhoto") ? PHOTOS_PER_MONTH : 0, period: "month" }),
    },
    {
      key: "router",
      label: "ข้อความที่ AI ช่วยแยก",
      hint: "เตือน จดโน้ต หรือค้นหาจากประโยคธรรมดา",
      word: "ข้อความ",
      icon: "ai",
      used: used.router,
      on: (p) => ({ limit: ROUTER_DAILY_LIMIT[p], period: "day" }),
    },
    {
      key: "fileSaves",
      label: "ฝากไฟล์ในแชท",
      hint: "ไฟล์และรูปที่ส่งให้บอทเก็บ",
      word: "ไฟล์",
      icon: "upload",
      used: used.fileSaves,
      on: (p) => ({ limit: fileDayLimit(p), period: "day" }),
    },
    {
      key: "notes",
      label: "โน้ต",
      hint: "โน้ตที่จดไว้",
      word: "รายการ",
      icon: "note",
      used: used.notes,
      on: (p) => ({ limit: noteCapacity(p), period: "total" }),
    },
    {
      key: "recurring",
      label: "รายการประจำ",
      hint: "จดให้อัตโนมัติ เช่น ค่าเช่า เงินเดือน",
      word: "รายการ",
      icon: "recurring",
      used: used.recurring,
      on: (p) => ({ limit: recurringLimit(p), period: "total" }),
    },
    {
      key: "wallets",
      label: "กระเป๋าเงิน",
      hint: "กระเป๋าเงินและบัตรของคุณเอง",
      word: "ใบ",
      icon: "wallet",
      used: used.wallets,
      on: (p) => ({ limit: walletCapacity(p), period: "total" }),
    },
    {
      key: "goals",
      label: "เป้าหมายการออม",
      hint: "เป้าหมายที่ยังเปิดอยู่",
      word: "เป้า",
      icon: "goal",
      used: used.goals,
      on: (p) => ({ limit: goalCapacity(p), period: "total" }),
    },
  ];

  return { main: main.map((d) => item(plan, d)), others: others.map((d) => item(plan, d)) };
}
