import { guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { getServerEnv } from "@/lib/env";
import { createLineClient } from "@/lib/line/client";
import { listOwnedGroups } from "@/lib/owned-groups";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/groups -> { items: [{ id, name, isActive }] }: the ledgers this person owns, for the switch
 * on the vault and reminders pages. Empty for someone who owns none (they see only their own).
 */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const line = createLineClient(getServerEnv().LINE_CHANNEL_ACCESS_TOKEN);
    const items = await listOwnedGroups(getAdminClient(), auth.userId, (id) =>
      line.getGroupName(id),
    );
    return json({ items });
  });
}
