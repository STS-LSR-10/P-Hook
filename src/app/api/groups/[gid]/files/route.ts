import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { signGroupViewToken } from "@/lib/auth/file-token";
import { getServerEnv } from "@/lib/env";
import { fileCapacity } from "@/lib/file";
import { fileUsage, groupFileUsage, listFiles } from "@/lib/file-repo";
import { requireGroupViewer } from "@/lib/group-api";
import { getPlanInfo } from "@/lib/plan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  kind: z.enum(["image", "file"]).optional(),
});

/**
 * GET /api/groups/:gid/files?q=&before=&kind= — a group's files, newest first, for its owner and its
 * members. The space shown is the owner's (shared with the owner's own files); `mine` marks the files
 * this person may delete.
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
      kind: url.searchParams.get("kind") ?? undefined,
    });
    if (!parsed.success) return apiError("คำค้นหรือหน้าที่ขอไม่ถูกต้อง", 400);

    const owner = viewer.group.ownerUserId;
    const [{ items, hasMore }, usedBytes, groupBytes, { plan }] = await Promise.all([
      listFiles(db, owner, { ...parsed.data, groupId: viewer.group.id }),
      fileUsage(db, owner),
      groupFileUsage(db, owner),
      getPlanInfo(db, owner),
    ]);
    const viewToken = await signGroupViewToken(
      owner,
      viewer.group.id,
      getServerEnv().SESSION_JWT_SECRET,
    );
    return json({
      items: items.map(({ savedBy, ...f }) => ({
        ...f,
        mine: viewer.isOwner || savedBy === auth.lineUserId,
      })),
      hasMore,
      usedBytes,
      groupBytes,
      capacityBytes: fileCapacity(plan),
      isOwner: viewer.isOwner,
      viewToken,
    });
  });
}
