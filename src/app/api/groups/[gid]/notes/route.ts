import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireGroupViewer } from "@/lib/group-api";
import { cleanNoteBody, MAX_NOTE_LENGTH, noteCapacity } from "@/lib/note";
import { countNotes, createNote, listGroupNotes } from "@/lib/note-repo";
import { can } from "@/lib/plan";
import { getPlanInfo } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

/**
 * GET /api/groups/:gid/notes?q=&before=&links=1 — a group's notes, newest first, for its owner and its
 * members (a closed ledger's too). `mine` marks the notes this person may change or remove; who wrote
 * each is not sent. `canAdd` says whether a new one may be written now.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupViewer(request, gid);
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
    });
    if (!parsed.success) return apiError("คำค้นหรือหน้าที่ขอไม่ถูกต้อง", 400);
    const links = url.searchParams.get("links") === "1";

    const owner = viewer.group.ownerUserId;
    const [{ items, hasMore }, count, { plan }] = await Promise.all([
      listGroupNotes(db, viewer.group.id, { ...parsed.data, links }),
      countNotes(db, owner),
      getPlanInfo(db, owner),
    ]);
    return json({
      items: items.map(({ createdBy, userId, ...n }) => ({
        ...n,
        mine: viewer.isOwner || createdBy === auth.lineUserId || userId === auth.userId,
      })),
      hasMore,
      canAdd: viewer.group.isActive && can(plan, "groupLedger") && count < noteCapacity(plan),
      isOwner: viewer.isOwner,
    });
  });
}

const bodySchema = z.object({ body: z.string().max(MAX_NOTE_LENGTH * 2) });

/** POST /api/groups/:gid/notes { body } — a note for the group by any member, on the owner's limit. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid } = await params;
    const found = await requireGroupViewer(request, gid);
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await readJson(request));
    const body = parsed.success ? cleanNoteBody(parsed.data.body) : "";
    if (!body || body.length > MAX_NOTE_LENGTH) {
      return apiError(t("เขียนโน้ตให้ไม่ว่างและไม่เกิน {0} ตัวอักษรนะ", MAX_NOTE_LENGTH), 400);
    }

    const owner = viewer.group.ownerUserId;
    const [{ plan }, count] = await Promise.all([getPlanInfo(db, owner), countNotes(db, owner)]);
    if (!viewer.group.isActive || !can(plan, "groupLedger")) {
      return apiError(
        "สมุดกลุ่มนี้ปิดอยู่ หรือเจ้าของสมุดไม่ได้ใช้แผนที่มีสมุดกลุ่มแล้ว จดเพิ่มไม่ได้",
        403,
      );
    }
    const limit = noteCapacity(plan);
    if (count >= limit) {
      return apiError(t("โน้ตของเจ้าของสมุดเต็ม {0} รายการแล้ว ลบอันเก่าก่อนนะ", limit), 409);
    }
    const note = await createNote(db, owner, body, {
      groupId: viewer.group.id,
      createdBy: auth.lineUserId,
    });
    return json({ note: { ...note, mine: true } }, 201);
  });
}
