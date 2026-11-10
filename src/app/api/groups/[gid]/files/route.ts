import { loadBonus } from "@/lib/addons-repo";
import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { signGroupViewToken } from "@/lib/auth/file-token";
import { getServerEnv } from "@/lib/env";
import { fileCapacity } from "@/lib/file";
import { fileUsage, groupFileUsage, listGroupFiles } from "@/lib/file-repo";
import { requireGroupViewer } from "@/lib/group-api";
import { getPlanInfo } from "@/lib/plan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ gid: string }> };

/** The share of the space used at which members are told it is running out. */
const SPACE_LOW = 0.9;

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  kind: z.enum(["image", "file"]).optional(),
});

/**
 * GET /api/groups/:gid/files?q=&before=&kind= — a group's files, newest first, for its owner and its
 * members (a closed ledger's too, so they can still be removed). The owner sees the space, which their
 * own files share; members see only `spaceLow`. `mine` marks the files this person may delete.
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
      listGroupFiles(db, viewer.group.id, parsed.data),
      fileUsage(db, owner),
      groupFileUsage(db, owner),
      getPlanInfo(db, owner),
    ]);
    const capacity = fileCapacity(plan, (await loadBonus(db, owner)).storageBytes);
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
      // the owner's own use is theirs: a member sees only whether the space is running out
      ...(viewer.isOwner
        ? { usedBytes, groupBytes, capacityBytes: capacity }
        : { usedBytes: null, groupBytes: null, capacityBytes: null }),
      spaceLow: usedBytes >= capacity * SPACE_LOW,
      isOwner: viewer.isOwner,
      viewToken,
    });
  });
}
