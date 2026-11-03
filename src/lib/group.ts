import { parseBillCommand, type BillCommand } from "@/lib/split-bill";
import { parseTripCommand, type TripCommand } from "@/lib/trip";

export const MAX_GROUPS_PER_OWNER = 5;
export const MAX_GROUP_ENTRIES_PER_DAY = 300;
export const MAX_RECORDS_PER_MESSAGE = 5;
export const RECENT_COUNT = 5;

/** A group ledger as the bot sees it. */
export interface GroupRow {
  id: string;
  lineGroupId: string;
  ownerUserId: string;
  isActive: boolean;
}

export interface GroupEntryRow {
  id: string;
  payerLineUserId: string;
  title: string;
  amountSatang: number;
  occurredAt: string;
  /** The trip it belongs to (entries written while a trip was open). */
  tripId?: string | null;
  /** The people the entry was shared between (empty outside a trip). */
  splitUsers?: string[];
  /** Entered in a foreign currency: the code, the original amount (×100) and the rate. */
  origCurrency?: string | null;
  origMinor?: number | null;
  fxRate?: number | null;
}

export interface TripRow {
  id: string;
  groupId: string;
  name: string;
  startedBy: string;
  status: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
}

export type GroupCommand =
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "record"; body: string }
  | { kind: "summary"; scope: "today" | "month" }
  | { kind: "recent" }
  | { kind: "delete-last" }
  | { kind: "help" }
  | { kind: "file-keep"; name: string | null }
  | { kind: "file-list"; term: string | null }
  | { kind: "remind-add"; text: string }
  | { kind: "remind-list" }
  | { kind: "remind-cancel"; index: number }
  | { kind: "owl"; question: string }
  | { kind: "note-add"; body: string }
  | { kind: "note-list"; term: string | null }
  | TripCommand
  | BillCommand;

/**
 * What a message in a group means. Only explicit commands count: an entry needs the word "จด" in
 * front, so ordinary chat ("กินข้าว 100 ไหม") is never recorded. Anything else is null and the bot
 * stays quiet.
 */
export function parseGroupCommand(input: string): GroupCommand | null {
  const text = input.trim();
  const one = text.replace(/\s+/g, " ").toLowerCase();

  if (["เปิดสมุดกลุ่ม", "เปิดสมุด"].includes(one)) return { kind: "open" };
  if (["ปิดสมุดกลุ่ม", "ปิดสมุด"].includes(one)) return { kind: "close" };
  if (["สรุป", "สรุปกลุ่ม", "สรุปเดือนนี้"].includes(one))
    return { kind: "summary", scope: "month" };
  if (one === "สรุปวันนี้") return { kind: "summary", scope: "today" };
  if (["ล่าสุด", "รายการล่าสุด"].includes(one)) return { kind: "recent" };
  if (one === "ลบล่าสุด") return { kind: "delete-last" };
  if (["ช่วยเหลือ", "วิธีใช้", "วิธีใช้งาน", "เมนู", "help"].includes(one)) return { kind: "help" };

  const extra = parseGroupExtra(text, one);
  if (extra) return extra;

  const trip = parseTripCommand(text);
  if (trip) return trip;
  const bill = parseBillCommand(text);
  if (bill) return bill;

  const body = recordBody(text);
  if (body) return { kind: "record", body };
  return null;
}

/**
 * Files, reminders, notes and พี่ฮูก in a group. Each needs its own words in front ("เก็บไฟล์", "เตือน "
 * or "โน้ต " with a space, "ฮูก " ...), so a chat that merely starts the same way ("เตือนแล้วนะ", "ฮูกกี้") is not one.
 */
function parseGroupExtra(text: string, one: string): GroupCommand | null {
  if (["เก็บไฟล์", "เก็บรูป"].includes(one)) return { kind: "file-keep", name: null };
  const keep = /^เก็บ(?:ไฟล์|รูป)\s+([\s\S]+)$/.exec(text);
  if (keep?.[1]?.trim()) return { kind: "file-keep", name: keep[1].trim() };
  if (["ไฟล์กลุ่ม", "ไฟล์ทั้งหมด", "คลังไฟล์"].includes(one))
    return { kind: "file-list", term: null };
  const find = /^หาไฟล์\s+([\s\S]+)$/.exec(text);
  if (find?.[1]?.trim()) return { kind: "file-list", term: find[1].trim() };

  if (["เตือนกลุ่ม", "รายการเตือน", "เตือนทั้งหมด"].includes(one)) return { kind: "remind-list" };
  const cancel = /^ยกเลิกเตือน\s*([0-9๐-๙]+)$/.exec(one);
  if (cancel?.[1]) {
    const digits = cancel[1].replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
    return { kind: "remind-cancel", index: Number(digits) };
  }
  const remind = /^เตือน\s+([\s\S]+)$/.exec(text);
  if (remind?.[1]?.trim()) return { kind: "remind-add", text: remind[1].trim() };

  if (["โน้ตกลุ่ม", "โน๊ตกลุ่ม", "โน้ต", "โน๊ต", "โน้ตทั้งหมด"].includes(one))
    return { kind: "note-list", term: null };
  const noteFind = /^(?:ค้นหา\s*โน[้๊็]ต|หาโน[้๊็]ต|โน[้๊็]ต\s+ค้นหา)\s+([\s\S]+)$/.exec(text);
  if (noteFind?.[1]?.trim()) return { kind: "note-list", term: noteFind[1].trim() };
  const note = /^โน[้๊็]ต\s+([\s\S]+)$/.exec(text);
  if (note?.[1]?.trim()) return { kind: "note-add", body: note[1].trim() };

  if (["ถามพี่ฮูก", "ถามฮูก", "พี่ฮูก", "ฮูก"].includes(one)) return { kind: "owl", question: "" };
  const ask = /^(?:ถาม)?(?:พี่)?ฮูก\s+([\s\S]+)$/.exec(text);
  if (ask?.[1]?.trim()) return { kind: "owl", question: ask[1].trim() };
  return null;
}

const HAS_DIGIT = /[0-9๐-๙]/;

/**
 * The entry in a message that says "จด" somewhere: "จด ข้าว 300", "จดค่าน้ำ 200", "เครื่องเล่น 500 จด"
 * and "ข้าว จด 300" all mean the same. "จด " in front is an explicit command and always counts (with no
 * amount the bot explains how). Every other place needs an amount in the message, so ordinary chat that
 * happens to contain the word ("จดทะเบียนเสร็จแล้ว") stays unanswered. The bot's old name ("จดตังค์") is not the word. Null when this is not an entry.
 */
export function recordBody(text: string): string | null {
  const t = text.trim();
  if (!t || t.startsWith("จดตังค์")) return null;

  // "จด ข้าว 300" (the original form): always a command
  const spaced = /^จด\s+([\s\S]+)$/.exec(t);
  if (spaced?.[1]?.trim()) return spaced[1].trim();

  const withAmount = (body: string) => {
    const b = body.trim();
    return b && HAS_DIGIT.test(b) ? b : null;
  };
  // "จดค่าน้ำ 200": the word stuck to the entry
  if (t.startsWith("จด")) return withAmount(t.slice(2));
  // "เครื่องเล่น 500 จด" (also "500 จด" and ", จด")
  const trailing = /^([\s\S]*?)[\s,]*จด$/.exec(t);
  if (trailing) return withAmount(trailing[1] ?? "");
  // "ข้าว จด 300": the word on its own in the middle
  const middle = /^([\s\S]*?\S)\s+จด\s+(\S[\s\S]*)$/.exec(t);
  if (middle) return withAmount(`${middle[1]} ${middle[2]}`);
  return null;
}

export interface PayerShare {
  lineUserId: string;
  name: string;
  totalSatang: number;
  entries: number;
  /** Whole percent of the group's total. */
  percent: number;
}

export interface GroupSummary {
  totalSatang: number;
  count: number;
  payers: PayerShare[];
}

/** Totals per payer (as the database returns them, biggest first) with names and shares. */
export function summarizePayers(
  rows: { lineUserId: string; totalSatang: number; entries: number }[],
  names: ReadonlyMap<string, string>,
): GroupSummary {
  const totalSatang = rows.reduce((s, r) => s + r.totalSatang, 0);
  return {
    totalSatang,
    count: rows.reduce((s, r) => s + r.entries, 0),
    payers: rows.map((r) => ({
      lineUserId: r.lineUserId,
      name: names.get(r.lineUserId) ?? "สมาชิกกลุ่ม",
      totalSatang: r.totalSatang,
      entries: r.entries,
      percent: totalSatang > 0 ? Math.round((r.totalSatang * 100) / totalSatang) : 0,
    })),
  };
}

/** May this person delete this entry? The one who wrote it, or the owner of the ledger. */
export function canDeleteEntry(input: {
  entryPayer: string;
  requester: string;
  requesterIsOwner: boolean;
}): boolean {
  return input.requesterIsOwner || input.entryPayer === input.requester;
}
