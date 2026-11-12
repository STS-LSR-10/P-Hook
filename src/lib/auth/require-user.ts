import { getAdminClient } from "@/lib/supabase/admin";
import { tokenSecrets } from "./keys";
import { apiError } from "@/lib/api";
import { enterCurrency, enterLocale, enterZone } from "@/lib/zone-scope";
import { verifySession, type SessionClaims } from "./session";

/**
 * Authenticate an API request from its `Authorization: Bearer <session>` header.
 * The user id ALWAYS comes from the verified session — never from the request body or query.
 *
 *   const auth = await requireUser(request);
 *   if (auth instanceof Response) return auth;
 */
export async function requireUser(request: Request): Promise<SessionClaims | Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer (.+)$/.exec(header)?.[1];
  if (!token) return apiError("กรุณาเข้าสู่ระบบอีกครั้ง", 401);

  let secrets: string[];
  try {
    secrets = tokenSecrets();
  } catch {
    return apiError("ระบบยังตั้งค่าไม่ครบ", 500);
  }
  const claims = await verifySession(token, secrets);
  if (!claims) return apiError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  // a session outlives a deleted account by up to an hour: it is refused as soon as the person is gone
  if (!(await userStillThere(claims.userId))) {
    return apiError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  }
  enterZone(claims.tz);
  enterCurrency(claims.cur);
  enterLocale(claims.loc);
  return claims;
}

/** People seen to exist lately, so most requests skip the lookup (per Worker, a minute at most). */
const seen = new Map<string, number>();
const SEEN_MS = 60_000;

/** Forget a person (their account was just deleted), so this Worker refuses their session at once. */
export function forgetUser(userId: string): void {
  seen.delete(userId);
}

async function userStillThere(userId: string): Promise<boolean> {
  const at = seen.get(userId);
  if (at !== undefined && Date.now() - at < SEEN_MS) return true;
  try {
    const { data, error } = await getAdminClient()
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    // a database hiccup must not sign everybody out: only a clear "no such person" refuses
    if (error) return true;
    if (!data) {
      seen.delete(userId);
      return false;
    }
  } catch {
    return true;
  }
  if (seen.size > 5_000) seen.clear();
  seen.set(userId, Date.now());
  return true;
}
