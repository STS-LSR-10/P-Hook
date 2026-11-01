import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { cleanNoteBody, MAX_NOTE_LENGTH, noteCapacity } from "@/lib/note";
import { countNotes, createNote, listNotes } from "@/lib/note-repo";
import { getPlanInfo } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

/** GET /api/notes?q=&before= — the person's notes, newest first, 30 at a time. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
    });
    if (!parsed.success) return apiError("คำค้นหรือหน้าที่ขอไม่ถูกต้อง", 400);
    const links = url.searchParams.get("links") === "1";

    const db = getAdminClient();
    const [{ items, hasMore }, count, { plan }] = await Promise.all([
      listNotes(db, auth.userId, { ...parsed.data, links }),
      countNotes(db, auth.userId),
      getPlanInfo(db, auth.userId),
    ]);
    const limit = noteCapacity(plan);
    return json({ items, hasMore, count, limit, canAdd: count < limit });
  });
}

const bodySchema = z.object({ body: z.string().max(MAX_NOTE_LENGTH * 2) });

/** POST /api/notes { body } — a new note (up to the plan's number of notes). */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    const body = parsed.success ? cleanNoteBody(parsed.data.body) : "";
    if (!body || body.length > MAX_NOTE_LENGTH) {
      return apiError(`เขียนโน้ตให้ไม่ว่างและไม่เกิน ${MAX_NOTE_LENGTH} ตัวอักษรนะ`, 400);
    }

    const [{ plan }, count] = await Promise.all([
      getPlanInfo(db, auth.userId),
      countNotes(db, auth.userId),
    ]);
    const limit = noteCapacity(plan);
    if (count >= limit) {
      return json(
        {
          error: `โน้ตเต็ม ${limit} รายการแล้ว ลบอันเก่าหรืออัปเกรดแผนเพื่อเก็บเพิ่มนะ`,
          upgrade: plan !== "ultimate",
        },
        409,
      );
    }
    return json({ note: await createNote(db, auth.userId, body) }, 201);
  });
}
