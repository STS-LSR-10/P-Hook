import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { fileCapacity } from "@/lib/file";
import { fileUsage, listFiles } from "@/lib/file-repo";
import { getPlanInfo } from "@/lib/plan-server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  before: z.string().datetime().optional(),
});

/** GET /api/files?q=&before= — the person's files, newest first, and the space used. */
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

    const db = getAdminClient();
    const [{ items, hasMore }, usedBytes, { plan }] = await Promise.all([
      listFiles(db, auth.userId, parsed.data),
      fileUsage(db, auth.userId),
      getPlanInfo(db, auth.userId),
    ]);
    return json({ items, hasMore, usedBytes, capacityBytes: fileCapacity(plan) });
  });
}
