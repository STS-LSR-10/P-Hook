import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { verifyLineIdToken } from "@/lib/auth/liff-verify";
import { SESSION_TTL_SECONDS, signSession } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { ensureUser, touchProfile } from "@/lib/repo";
import { clientIp, LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ idToken: z.string().min(10).max(4096) });

/** Exchange a LIFF ID token for a short-lived session token. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const limited = await limitOr429(
      getAdminClient(),
      "auth_ip",
      clientIp(request),
      LIMITS.authPerIp,
    );
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const env = getServerEnv();
    const clientId = env.LINE_LOGIN_CHANNEL_ID ?? env.LINE_CHANNEL_ID;
    const claims = await verifyLineIdToken(parsed.data.idToken, clientId);
    if (!claims) return apiError("เข้าสู่ระบบไม่สำเร็จ กรุณาเปิดใหม่อีกครั้ง", 401);

    const db = getAdminClient();
    const profile = { displayName: claims.name, pictureUrl: claims.picture };
    const user = await ensureUser(db, claims.sub, async () => profile);
    await touchProfile(db, user.id, profile);

    const token = await signSession(
      { userId: user.id, lineUserId: claims.sub, tz: user.timezone },
      env.SESSION_JWT_SECRET,
    );
    return json({ token, expiresIn: SESSION_TTL_SECONDS });
  });
}
