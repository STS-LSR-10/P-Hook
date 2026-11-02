import { fileCapacity, fileDayLimit } from "@/lib/file";
import { noteCapacity } from "@/lib/note";
import {
  can,
  FAIR_USE,
  FREE_SLIPS_PER_WEEK,
  goalCapacity,
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
import { reminderCapacity } from "@/lib/user-reminder";

/** How a quota counts: what you keep ("total"), per day / week / month, or once for life. */
export type QuotaPeriod = "total" | "day" | "week" | "month" | "once";

export interface QuotaItem {
  key: string;
  label: string;
  /** A short line under the label. */
  hint?: string;
  used: number;
  /** Null: no plan limit. 0: not on this plan. */
  limit: number | null;
  unit: "count" | "bytes";
  period: QuotaPeriod;
}

/** What the person has used, each in the period its quota counts. */
export interface QuotaUsage {
  storageBytes: number;
  wallets: number;
  goals: number;
  notes: number;
  reminders: number;
  recurring: number;
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
  /** What you keep: storage, reminders, notes and the like. */
  kept: QuotaItem[];
  /** What starts over each day / week / month. */
  counted: QuotaItem[];
}

/** Every quota of `plan` with what was used, in the order the quota page shows them. */
export function buildQuota(plan: Plan, used: QuotaUsage): Quota {
  const paid = plan !== "free";
  const kept: QuotaItem[] = [
    {
      key: "storage",
      label: "พื้นที่เก็บไฟล์",
      hint: "ไฟล์และรูปที่ฝากไว้ในคลัง",
      used: used.storageBytes,
      limit: fileCapacity(plan),
      unit: "bytes",
      period: "total",
    },
    {
      key: "reminders",
      label: "การเตือน",
      hint: "การเตือนที่ยังทำงานอยู่ รวมที่ตั้งให้เตือนซ้ำ",
      used: used.reminders,
      limit: reminderCapacity(plan),
      unit: "count",
      period: "total",
    },
    {
      key: "notes",
      label: "โน้ต",
      used: used.notes,
      limit: noteCapacity(plan),
      unit: "count",
      period: "total",
    },
    {
      key: "recurring",
      label: "รายการประจำ",
      hint: "จดให้อัตโนมัติ เช่น ค่าเช่า เงินเดือน",
      used: used.recurring,
      limit: recurringLimit(plan),
      unit: "count",
      period: "total",
    },
    {
      key: "wallets",
      label: "กระเป๋าเงิน",
      used: used.wallets,
      limit: walletCapacity(plan),
      unit: "count",
      period: "total",
    },
    {
      key: "goals",
      label: "เป้าหมายการออม",
      used: used.goals,
      limit: goalCapacity(plan),
      unit: "count",
      period: "total",
    },
  ];

  const slipLimit = paid ? SLIP_LIMIT[plan] : FREE_SLIPS_PER_WEEK;
  const counted: QuotaItem[] = [
    {
      key: "slips",
      label: "อ่านสลิป",
      ...(slipLimit === null ? { hint: `ใช้ได้ตามปกติ ไม่เกิน ${FAIR_USE.slips} ใบต่อเดือน` } : {}),
      used: used.slips,
      limit: slipLimit,
      unit: "count",
      period: paid ? "month" : "week",
    },
    {
      key: "photos",
      label: "แนบรูปกับรายการ",
      used: used.photos,
      limit: can(plan, "entryPhoto") ? PHOTOS_PER_MONTH : 0,
      unit: "count",
      period: "month",
    },
    {
      key: "voice",
      label: "จดด้วยเสียง",
      ...(paid ? {} : { hint: "ทดลองใช้ได้ 1 ครั้ง" }),
      used: used.voice,
      limit: paid ? VOICE_LIMIT[plan] : 1,
      unit: "count",
      period: paid ? "month" : "once",
    },
    {
      key: "pdf",
      label: "อ่านไฟล์ PDF",
      used: used.pdf,
      limit: PDF_LIMIT[plan],
      unit: "count",
      period: "month",
    },
    {
      key: "owl",
      label: "ถามพี่ฮูก",
      used: used.owl,
      limit: OWL_LIMIT[plan],
      unit: "count",
      period: "month",
    },
    {
      key: "router",
      label: "ข้อความที่ AI ช่วยแยก",
      hint: "เตือน จดโน้ต หรือค้นหาจากประโยคธรรมดา",
      used: used.router,
      limit: ROUTER_DAILY_LIMIT[plan],
      unit: "count",
      period: "day",
    },
    {
      key: "fileSaves",
      label: "ฝากไฟล์ในแชท",
      used: used.fileSaves,
      limit: fileDayLimit(plan),
      unit: "count",
      period: "day",
    },
  ];
  return { kept, counted };
}
