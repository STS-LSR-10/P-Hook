import "./cf-polyfill.mjs";
import worker from "./.open-next/worker.js";

// Cron Triggers (see wrangler.jsonc) call the same /api/cron/* routes the GitHub workflows used to,
// with the same bearer secret, straight into this Worker (no network hop).
const JOBS = {
  "* * * * *": ["/api/cron/user-reminders"],
  "7 * * * *": ["/api/cron/recurring", "/api/cron/reminders"],
};

const handler = {
  fetch: worker.fetch,
  async scheduled(controller, env, ctx) {
    const paths = JOBS[controller.cron] ?? [];
    const base = (env.APP_BASE_URL ?? "").replace(/\/$/, "");
    if (!base || !env.CRON_SECRET) {
      console.error(JSON.stringify({ level: "error", event: "cf_cron_not_configured" }));
      return;
    }
    // each job on its own, so one broken job never silences the other
    for (const path of paths) {
      try {
        const res = await worker.fetch(
          new Request(base + path, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }),
          env,
          ctx,
        );
        console.log(JSON.stringify({ level: "info", event: "cf_cron", path, status: res.status }));
      } catch (e) {
        console.error(
          JSON.stringify({ level: "error", event: "cf_cron_failed", path, message: String(e) }),
        );
      }
    }
  },
};

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default handler;
