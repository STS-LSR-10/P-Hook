import { guard, json } from "@/lib/api";
import { calendarMonthRange } from "@/lib/budget-cycle";
import { requireGroupOwner } from "@/lib/group-api";
import { entryDto } from "@/lib/group-entry-dto";
import { openDebts } from "@/lib/group-manage";
import { summarizePayers } from "@/lib/group";
import { GROUP_KEEP_DAYS } from "@/lib/group-lifecycle";
import {
  getChaseSchedule,
  getLeftAt,
  memberNames,
  pageEntries,
  payerTotals,
} from "@/lib/group-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

/** The first page; the card asks for more with GET /entries. */
const ENTRIES_SHOWN = 10;

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
    const [rows, entries, debts, schedule, leftAt] = await Promise.all([
      payerTotals(db, viewer.group.id, range.from, range.to),
      pageEntries(db, viewer.group.id, ENTRIES_SHOWN),
      openDebts(db, viewer.group.id, names),
      getChaseSchedule(db, viewer.group.id),
      viewer.group.isActive ? null : getLeftAt(db, viewer.group.id),
    ]);
    return json({
      isActive: viewer.group.isActive,
      // when the data of a group the bot was taken out of is deleted for good
      purgeAt: leftAt
        ? new Date(leftAt.getTime() + GROUP_KEEP_DAYS * 86_400_000).toISOString()
        : null,
      summary: summarizePayers(rows, names),
      entries: entries.items.map((e) => entryDto(e, names)),
      // for "ดูเพิ่ม": null when everything is already shown
      nextCursor: entries.next,
      debts,
      schedule,
    });
  });
}
