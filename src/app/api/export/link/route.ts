import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { signExportToken } from "@/lib/auth/export-token";
import { requireUser } from "@/lib/auth/require-user";
import { EXPORT_LINK_TTL_SECONDS } from "@/lib/config";
import { getServerEnv } from "@/lib/env";
import { COLUMN_GROUPS } from "@/lib/export/columns";
import { requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { txFilterSchema } from "@/lib/tx-query";
import { currentZone } from "@/lib/thai-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = txFilterSchema.extend({
  format: z.enum(["csv", "xlsx", "pdf"]),
  /** Which columns to keep; at least one. */
  groups: z.array(z.enum(COLUMN_GROUPS)).min(1).max(COLUMN_GROUPS.length).optional(),
  /** Slip pictures and photos in a zip beside the file. */
  attachments: z.boolean().optional(),
});

/**
 * POST /api/export/link { format, ...filters } -> { url } valid for two minutes.
 * The LIFF page opens it in the external browser (in-app browsers cannot download files).
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    // Pro and above (the buttons are hidden for Free, this is the real check)
    const locked = await requireFeature(getAdminClient(), auth.userId, "export");
    if (locked) return locked;

    const limited = await limitOr429(
      getAdminClient(),
      "export_link",
      auth.userId,
      LIMITS.exportLink,
    );
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ตัวเลือกส่งออกไม่ถูกต้อง", 400);
    const { format, groups, attachments, ...filters } = parsed.data;

    const token = await signExportToken(
      // the file is made in the phone's browser, outside this request: it takes the zone along
      { userId: auth.userId, format, filters, groups, attachments, tz: currentZone() },
      getServerEnv().SESSION_JWT_SECRET,
    );
    const url = new URL("/api/export/download", request.url);
    url.searchParams.set("t", token);
    return json({ url: url.toString(), expiresIn: EXPORT_LINK_TTL_SECONDS });
  });
}
