import type { SupabaseClient } from "@supabase/supabase-js";
import { monthRange } from "@/lib/admin/dashboard-data";

/** Uses and people of one kind, or of a whole group when `kind` is null. */
export interface ActivityRow {
  grp: string;
  kind: string | null;
  uses: number;
  people: number;
}

/** What the tab shows: each group with its kinds, in this order. */
export const ACTIVITY_GROUPS: { grp: string; label: string; kinds: [string, string][] }[] = [
  {
    grp: "reminder",
    label: "ตั้งเตือน",
    kinds: [
      ["reminder_chat", "แชท"],
      ["reminder_page", "หน้าเว็บ"],
      ["reminder_group", "กลุ่ม"],
      ["reminder", "ก่อนเริ่มแยกช่องทาง"],
    ],
  },
  { grp: "note", label: "สร้างโน้ต", kinds: [] },
  { grp: "image", label: "เก็บรูป", kinds: [] },
  { grp: "file", label: "เก็บไฟล์", kinds: [] },
  {
    grp: "calendar",
    label: "เพิ่มลงปฏิทิน",
    kinds: [
      ["calendar_google", "Google Calendar"],
      ["calendar_device", "ปฏิทินในเครื่อง (.ics)"],
    ],
  },
  {
    grp: "entry",
    label: "จดรายการ",
    kinds: [
      ["entry_text", "ข้อความ"],
      ["entry_slip", "สลิป"],
      ["entry_voice", "เสียง"],
      ["entry_pdf", "PDF"],
      ["entry_manual", "หน้าเว็บ"],
      ["entry_recurring", "รายการประจำ (อัตโนมัติ)"],
    ],
  },
  { grp: "newuser", label: "ผู้ใช้ใหม่", kinds: [] },
];

/** "2026-11" and "2026", read from the address; the current Bangkok month and year when not valid. */
export function readPeriod(
  query: Record<string, string | string[] | undefined>,
  now: Date,
): { month: string; year: string } {
  const here = new Date(now.getTime() + 7 * 3_600_000).toISOString();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const month = one(query.month);
  const year = one(query.year);
  return {
    month: /^20\d\d-(0[1-9]|1[0-2])$/.test(month) ? month : here.slice(0, 7),
    year: /^20\d\d$/.test(year) ? year : here.slice(0, 4),
  };
}

export const yearRange = (year: string) => ({
  from: `${year}-01-01T00:00:00+07:00`,
  to: `${Number(year) + 1}-01-01T00:00:00+07:00`,
});

export async function loadActivity(
  db: SupabaseClient,
  range: { from: string; to: string },
): Promise<ActivityRow[]> {
  const { data, error } = await db.rpc("activity_summary", { p_from: range.from, p_to: range.to });
  if (error) throw new Error(`activity_summary: ${error.message}`);
  return ((data ?? []) as ActivityRow[]).map((r) => ({
    ...r,
    uses: Number(r.uses),
    people: Number(r.people),
  }));
}

/** The three columns of the tab: the month, the year and everything. */
export async function loadActivityColumns(
  db: SupabaseClient,
  period: { month: string; year: string },
): Promise<[ActivityRow[], ActivityRow[], ActivityRow[]]> {
  return Promise.all([
    loadActivity(db, monthRange(`${period.month}-01`)), // it takes the first day ("2026-11-01")
    loadActivity(db, yearRange(period.year)),
    loadActivity(db, { from: "2000-01-01T00:00:00+07:00", to: "2100-01-01T00:00:00+07:00" }),
  ]);
}

export const findActivity = (rows: ActivityRow[], grp: string, kind: string | null) =>
  rows.find((r) => r.grp === grp && r.kind === kind) ?? { grp, kind, uses: 0, people: 0 };
