import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { FILE_LINK_TTL_SECONDS, signFileToken } from "@/lib/auth/file-token";
import { getServerEnv } from "@/lib/env";
import { getGroupFile } from "@/lib/file-repo";
import { requireGroupViewer } from "@/lib/group-api";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string; id: string }> };

/** POST /api/groups/:gid/files/:id/link -> { url } valid for ten minutes, for any member. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const { gid, id } = await params;
    const found = await requireGroupViewer(request, gid);
    if (found instanceof Response) return found;
    const { auth, db, viewer } = found;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบไฟล์นี้", 404);

    const limited = await limitOr429(db, "file_link", auth.userId, LIMITS.fileLink);
    if (limited) return limited;

    const file = await getGroupFile(db, viewer.group.id, id);
    if (!file) return apiError("ไม่พบไฟล์นี้", 404);
    // the link names whose space the file takes, and only this one file
    const token = await signFileToken(
      { userId: file.userId, fileId: id },
      getServerEnv().SESSION_JWT_SECRET,
    );
    const url = new URL(`/api/files/${id}/download`, request.url);
    url.searchParams.set("t", token);
    return json({ url: url.toString(), expiresIn: FILE_LINK_TTL_SECONDS });
  });
}
