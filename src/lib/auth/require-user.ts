import { getServerEnv } from "@/lib/env";
import { apiError } from "@/lib/api";
import { enterCurrency, enterZone } from "@/lib/zone-scope";
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

  let secret: string;
  try {
    secret = getServerEnv().SESSION_JWT_SECRET;
  } catch {
    return apiError("ระบบยังตั้งค่าไม่ครบ", 500);
  }
  const claims = await verifySession(token, secret);
  if (!claims) return apiError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  enterZone(claims.tz);
  enterCurrency(claims.cur);
  return claims;
}
