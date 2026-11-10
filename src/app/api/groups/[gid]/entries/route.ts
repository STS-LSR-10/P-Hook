import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { entryDto } from "@/lib/group-entry-dto";
import { requireGroupOwner } from "@/lib/group-api";
import { isEntryCursor, memberNames, pageEntries } from "@/lib/group-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

const PAGE = 20;
const Query = z.object({ cursor: z.string().max(80).refine(isEntryCursor).optional() });

/** GET /api/groups/:gid/entries?cursor= — the next page of the ledger's entries, for the owner's card. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupOwner(request, gid);
    if (found instanceof Response) return found;
    const { db, viewer } = found;
    const query = Query.safeParse({
      cursor: new URL(request.url).searchParams.get("cursor") ?? undefined,
    });
    if (!query.success) return apiError("ขอหน้ารายการไม่ถูกต้อง", 400);
    const members = await memberNames(db, viewer.group.id);
    const names = new Map([...members].map(([id, v]) => [id, v.name]));
    const page = await pageEntries(db, viewer.group.id, PAGE, query.data.cursor);
    return json({ entries: page.items.map((e) => entryDto(e, names)), nextCursor: page.next });
  });
}
