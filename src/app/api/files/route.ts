import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { signViewToken } from "@/lib/auth/file-token";
import { requireUser } from "@/lib/auth/require-user";
import { getServerEnv } from "@/lib/env";
import { fileCapacity } from "@/lib/file";
import { fileUsage, listFiles } from "@/lib/file-repo";
import { getPlanInfo } from "@/lib/plan-server";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  kind: z.enum(["image", "file"]).optional(),
});

/**
 * GET /api/files?q=&before=&kind= — the person's files, newest first, the space used, and a token
 * for the pictures of the page (an <img> sends no Authorization header).
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
    });
    if (!parsed.success) return apiError("คำค้นหรือหน้าที่ขอไม่ถูกต้อง", 400);

    const db = getAdminClient();
    const [{ items, hasMore }, usedBytes, { plan }] = await Promise.all([
      listFiles(db, auth.userId, parsed.data),
      fileUsage(db, auth.userId),
      getPlanInfo(db, auth.userId),
    ]);
    const viewToken = await signViewToken(auth.userId, getServerEnv().SESSION_JWT_SECRET);
    return json({ items, hasMore, usedBytes, capacityBytes: fileCapacity(plan), viewToken });
  });
}
