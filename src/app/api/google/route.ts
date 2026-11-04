import { guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { googleConfig } from "@/lib/google/config";
import { getGoogleLink, maskEmail } from "@/lib/google/link-repo";
import { unlinkGoogle } from "@/lib/google/sync";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/google — is Google Calendar set up here, and which account is linked. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    if (!googleConfig()) return json({ available: false, linked: false, email: null });
    const link = await getGoogleLink(getAdminClient(), auth.userId);
    return json({ available: true, linked: link !== null, email: maskEmail(link?.email ?? null) });
  });
}

/** DELETE /api/google — sign out of Google here: access given back, events already added stay. */
export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    await unlinkGoogle(db, auth.userId);
    return json({ ok: true });
  });
}
