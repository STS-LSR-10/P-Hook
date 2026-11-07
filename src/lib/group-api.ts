import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import type { SessionClaims } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { groupForViewer, type GroupViewer } from "@/lib/group-access";
import { createLineClient } from "@/lib/line/client";
import { can } from "@/lib/plan";
import { getPlanInfo } from "@/lib/plan-server";
import { getAdminClient } from "@/lib/supabase/admin";

export const GROUP_NOT_FOUND = "ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่มนี้";

/**
 * The signed-in person and the group a page asks about, when they may see it (its owner, or a member
 * of the LINE group). A Response to send back otherwise.
 */
export async function requireGroupViewer(
  request: Request,
  groupId: string,
): Promise<
  { auth: SessionClaims; db: ReturnType<typeof getAdminClient>; viewer: GroupViewer } | Response
> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!z.string().uuid().safeParse(groupId).success) return apiError(GROUP_NOT_FOUND, 404);
  const db = getAdminClient();
  const line = createLineClient(getServerEnv().LINE_CHANNEL_ACCESS_TOKEN);
  const viewer = await groupForViewer(db, groupId, auth, (g, u) =>
    line.getGroupMemberProfile(g, u),
  );
  if (!viewer) return apiError(GROUP_NOT_FOUND, 404);
  return { auth, db, viewer };
}

/**
 * The owner of a ledger, for what only they may do (clearing debts, editing entries, the chase
 * schedule). `writable`: also refuses a closed ledger.
 */
export async function requireGroupOwner(
  request: Request,
  groupId: string,
  options: { writable?: boolean } = {},
): Promise<Awaited<ReturnType<typeof requireGroupViewer>>> {
  const found = await requireGroupViewer(request, groupId);
  if (found instanceof Response) return found;
  if (!found.viewer.isOwner) return apiError("เฉพาะเจ้าของสมุดกลุ่มเท่านั้นนะ", 403);
  if (options.writable && !found.viewer.group.isActive) {
    return apiError("สมุดกลุ่มนี้ปิดอยู่ เปิดสมุดในกลุ่มก่อนนะ", 409);
  }
  // the ledger is read-only once its owner is off Elite, here as in the chat
  if (options.writable) {
    const { plan } = await getPlanInfo(found.db, found.viewer.group.ownerUserId);
    if (!can(plan, "groupLedger")) {
      return apiError("เจ้าของสมุดไม่ได้ใช้แผน Elite แล้ว แก้ไขไม่ได้ ดูได้อย่างเดียวนะ", 403);
    }
  }
  return found;
}
