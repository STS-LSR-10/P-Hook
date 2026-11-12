import { readJson } from "@/lib/api";
import { log } from "@/lib/log";
import { clientIp, LIMITS, rateLimit } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only where it came from: a full URL can carry a token in its query. */
function hostOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "none";
  try {
    return new URL(value).host || value.slice(0, 20);
  } catch {
    return value.slice(0, 20); // "inline", "eval", "data"
  }
}

/**
 * POST /api/csp-report — where browsers send what the Content-Security-Policy (report-only for now)
 * would have blocked. No sign-in (the browser sends it by itself); it only writes one short log line:
 * the directive and the host that was blocked, never a full address or any page content.
 */
export async function POST(request: Request): Promise<Response> {
  // only what a browser sends for a report: anything else is dropped before it costs a database call
  const type = request.headers.get("content-type") ?? "";
  if (!/csp-report|reports\+json|application\/json/i.test(type)) {
    return new Response(null, { status: 204 });
  }
  try {
    const limit = await rateLimit(
      getAdminClient(),
      "csp_report",
      clientIp(request),
      LIMITS.cspReport,
    );
    if (limit.allowed) {
      const body = (await readJson(request, 10_000)) as unknown;
      // report-uri sends {"csp-report": {...}}; the Reporting API sends [{type, body: {...}}]
      const first = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : null;
      const report = (
        first ? first.body : ((body as Record<string, unknown> | null)?.["csp-report"] ?? body)
      ) as Record<string, unknown> | null;
      if (report && typeof report === "object") {
        log.warn("csp_violation", {
          directive: String(
            report["effective-directive"] ??
              report["effectiveDirective"] ??
              report["violated-directive"] ??
              "",
          ).slice(0, 40),
          blocked: hostOf(report["blocked-uri"] ?? report["blockedURL"]),
        });
      }
    }
  } catch {
    /* a report that cannot be read is dropped */
  }
  return new Response(null, { status: 204 });
}
