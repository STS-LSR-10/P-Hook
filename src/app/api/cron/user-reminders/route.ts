import { json } from "@/lib/api";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getServerEnv } from "@/lib/env";
import { createLineClient } from "@/lib/line/client";
import { log } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";
import { runUserReminders } from "@/lib/user-reminder-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every minute: push the reminders people set with "เตือน …" that are due.
 * Triggered by the Cloudflare cron (cf-worker.mjs); GET + Authorization: Bearer CRON_SECRET.
 */
export async function GET(request: Request): Promise<Response> {
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    return new Response("server misconfigured", { status: 500 });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), env.CRON_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const line = createLineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    const summary = await runUserReminders(
      getAdminClient(),
      {
        push: line.push,
        // the profile of someone who has not added พี่ฮูก (or blocked it) is not given
        isFriend: async (id) => (await line.getProfile(id)) !== null,
        groupMemberCount: line.getGroupMemberCount,
        groupName: line.getGroupName,
      },
      new Date(),
      liffId ? `https://liff.line.me/${liffId}/reminders` : undefined,
    );
    return json({ ok: true, ...summary });
  } catch (error) {
    log.error("cron_user_reminders_failed", error);
    return json({ ok: false }, 500);
  }
}
