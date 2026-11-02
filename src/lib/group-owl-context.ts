import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarMonthRange } from "@/lib/budget-cycle";
import type { GroupEntryRow, TripRow } from "@/lib/group";
import { memberNames, openTrip, payerTotals, recentEntries, tripEntries } from "@/lib/group-repo";
import { formatBaht } from "@/lib/money";
import { looksSecret } from "@/lib/secret-text";
import type { BillRow } from "@/lib/split-bill";
import { listBills } from "@/lib/split-bill-repo";
import { formatThaiDate } from "@/lib/thai-date";

const RECENT = 10;
const FALLBACK = "สมาชิกกลุ่ม";

/** What พี่ฮูก may know in a group: only the group's own ledger, never a member's own records. */
export interface GroupOwlFacts {
  today: Date;
  month: { lineUserId: string; totalSatang: number; entries: number }[];
  recent: GroupEntryRow[];
  trip: { name: string; totalSatang: number; entries: number } | null;
  bills: BillRow[];
  names: Map<string, string>;
}

const baht = (satang: number) => `${formatBaht(satang)} บาท`;

export function renderGroupOwlContext(f: GroupOwlFacts): string {
  const name = (id: string) => f.names.get(id) ?? FALLBACK;
  const total = f.month.reduce((sum, p) => sum + p.totalSatang, 0);
  const lines = [`วันนี้: ${formatThaiDate(f.today)}`];
  lines.push(
    f.month.length === 0
      ? "เดือนนี้: ยังไม่มีรายการในสมุดกลุ่ม"
      : `เดือนนี้ทั้งกลุ่ม: ${baht(total)} (${f.month.reduce((n, p) => n + p.entries, 0)} รายการ)`,
  );
  for (const p of f.month)
    lines.push(`• ${name(p.lineUserId)} จ่าย ${baht(p.totalSatang)} (${p.entries} รายการ)`);
  if (f.recent.length > 0) {
    lines.push("รายการล่าสุด:");
    for (const e of f.recent)
      lines.push(
        `• ${e.title} ${baht(e.amountSatang)} · ${name(e.payerLineUserId)} · ${formatThaiDate(new Date(e.occurredAt))}`,
      );
  }
  if (f.trip)
    lines.push(
      `ทริปที่เปิดอยู่: ${f.trip.name} รวม ${baht(f.trip.totalSatang)} (${f.trip.entries} รายการ)`,
    );
  if (f.bills.length > 0) {
    lines.push("บิลหารที่ยังไม่จบ:");
    for (const b of f.bills)
      lines.push(`• ${b.title} ${baht(b.amountSatang)} · ${name(b.payerLineUserId)} จ่ายก่อน`);
  }
  return lines.join("\n");
}

/** The group's ledger for one question. A part that cannot be read is left out, not guessed. */
export async function loadGroupOwlFacts(
  db: SupabaseClient,
  groupId: string,
  now: Date,
): Promise<GroupOwlFacts> {
  const range = calendarMonthRange(now);
  const part = <T>(load: () => Promise<T>, empty: T) => load().catch(() => empty);
  const [month, recent, trip, bills, names] = await Promise.all([
    part(() => payerTotals(db, groupId, range.from, range.to), []),
    part(() => recentEntries(db, groupId, RECENT), [] as GroupEntryRow[]),
    part(() => openTrip(db, groupId), null as TripRow | null),
    part(() => listBills(db, groupId, ["joining", "collecting"], 5), [] as BillRow[]),
    part(() => memberNames(db, groupId), new Map<string, { name: string; updatedAt: string }>()),
  ]);
  let tripTotals: GroupOwlFacts["trip"] = null;
  if (trip) {
    const entries = await part(() => tripEntries(db, trip.id), [] as GroupEntryRow[]);
    tripTotals = {
      name: trip.name,
      totalSatang: entries.reduce((sum, e) => sum + e.amountSatang, 0),
      entries: entries.length,
    };
  }
  // members write these names: one that looks like a password or card number never goes to the AI
  return {
    today: now,
    month,
    recent: recent.filter((e) => !looksSecret(e.title)),
    trip: tripTotals,
    bills: bills.filter((b) => !looksSecret(b.title)),
    names: new Map([...names].map(([id, v]) => [id, v.name])),
  };
}
