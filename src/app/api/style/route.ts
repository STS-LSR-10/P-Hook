import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { clearStyle, setStyleEnabled, styleSummary } from "@/lib/style-repo";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/style — is learning how they type on, how many messages it saw, what it found. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    return json(await styleSummary(getAdminClient(), auth.userId));
  });
}

const bodySchema = z.object({ enabled: z.boolean() });

/** PUT /api/style { enabled } — switch it on or off (off also forgets what was learned). */
export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ค่าที่ส่งมาไม่ถูกต้อง", 400);
    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    await setStyleEnabled(db, auth.userId, parsed.data.enabled);
    return json(await styleSummary(db, auth.userId));
  });
}

/** DELETE /api/style — forget everything learned, keeping the on/off choice. */
export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    await clearStyle(db, auth.userId);
    return json({ ok: true });
  });
}
