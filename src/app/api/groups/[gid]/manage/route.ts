import { guard, json } from "@/lib/api";
import { calendarMonthRange } from "@/lib/budget-cycle";
import { requireGroupOwner } from "@/lib/group-api";
import { openDebts } from "@/lib/group-manage";
import { summarizePayers } from "@/lib/group";
import { getChaseSchedule, memberNames, payerTotals, recentEntries } from "@/lib/group-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

const ENTRIES_SHOWN = 50;

/**
 * GET /api/groups/:gid/manage — everything the owner's "จัดการกลุ่ม" settings card shows: this month's
 * totals per person, the latest entries, the bills with people who owe, and the chase schedule.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupOwner(request, gid);
    if (found instanceof Response) return found;
    const { db, viewer } = found;
    const range = calendarMonthRange(new Date());
    const members = await memberNames(db, viewer.group.id);
    const names = new Map([...members].map(([id, v]) => [id, v.name]));
    const [rows, entries, debts, schedule] = await Promise.all([
      payerTotals(db, viewer.group.id, range.from, range.to),
      recentEntries(db, viewer.group.id, ENTRIES_SHOWN),
      openDebts(db, viewer.group.id, names),
      getChaseSchedule(db, viewer.group.id),
    ]);
    return json({
      isActive: viewer.group.isActive,
      summary: summarizePayers(rows, names),
      entries: entries.map((e) => ({
        id: e.id,
        title: e.title,
        amountSatang: e.amountSatang,
        occurredAt: e.occurredAt,
        payerName: names.get(e.payerLineUserId) ?? "สมาชิกกลุ่ม",
      })),
      debts,
      schedule,
    });
  });
}
