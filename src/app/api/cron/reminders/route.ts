import { buildInsightWriter } from "@/lib/ai/insight-writer";
import { json } from "@/lib/api";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getServerEnv } from "@/lib/env";
import { createLineClient } from "@/lib/line/client";
import { runBillReminders } from "@/lib/bill-run";
import { purgeExpiredIntents } from "@/lib/pending-intent-repo";
import { runReminders } from "@/lib/reminder-run";
import { runSummaries } from "@/lib/summary-run";
import { getAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hourly: push the daily "you have not recorded today" nudge and the weekly / monthly summaries
 * (Pro and above).
 * Triggered hourly by GitHub Actions;
 * GET + Authorization: Bearer CRON_SECRET.
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
    const db = getAdminClient();
    const now = new Date();
    const summary = await runReminders(db, line.push, now);
    // A failing summary run must not hide the reminder result (and vice versa).
    const summaries = await runSummaries(db, line.push, now, process.env.APP_BASE_URL, {
      insightWriter: buildInsightWriter(env),
    }).catch((error: unknown) => {
      log.error("cron_summaries_failed", error);
      return null;
    });
    // bill reminders (Elite) also run hourly; a failure must not hide the other results
    const bills = await runBillReminders(db, line.push, now).catch((error: unknown) => {
      log.error("cron_bills_failed", error);
      return null;
    });
    await purgeExpiredIntents(db, now).catch((error: unknown) => {
      log.error("cron_pending_intents_failed", error);
    });
    return json({ ok: true, ...summary, summaries, bills });
  } catch (error) {
    log.error("cron_reminders_failed", error);
    return json({ ok: false }, 500);
  }
}
