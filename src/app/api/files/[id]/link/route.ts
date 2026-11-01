import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { FILE_LINK_TTL_SECONDS, signFileToken } from "@/lib/auth/file-token";
import { requireUser } from "@/lib/auth/require-user";
import { getServerEnv } from "@/lib/env";
import { getReadyFile } from "@/lib/file-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/files/:id/link -> { url } valid for ten minutes, for the phone's own browser. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบไฟล์นี้", 404);
    const db = getAdminClient();

    const limited = await limitOr429(db, "file_link", auth.userId, LIMITS.fileLink);
    if (limited) return limited;

    if (!(await getReadyFile(db, auth.userId, id))) return apiError("ไม่พบไฟล์นี้", 404);
    const token = await signFileToken(
      { userId: auth.userId, fileId: id },
      getServerEnv().SESSION_JWT_SECRET,
    );
    const url = new URL(`/api/files/${id}/download`, request.url);
    url.searchParams.set("t", token);
    return json({ url: url.toString(), expiresIn: FILE_LINK_TTL_SECONDS });
  });
}
