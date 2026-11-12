import { SignJWT } from "jose";
import { verifyWithAny, type Secrets } from "./keys";

const ISSUER = "phook";
const AUDIENCE = "phook-calendar";

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * The credential of an "add to calendar" link on a group's reminder card. The phone's own browser opens
 * it with no session, so it names the one reminder and lets that be read as a calendar event, nothing
 * more. It does not expire: a repeating reminder can be added any time while it lasts.
 */
export async function signCalendarToken(
  reminderId: string,
  secret: string,
  /** A personal reminder's link runs out (it is private; a group's card is shared anyway). */
  ttlSeconds?: number,
): Promise<string> {
  const token = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(reminderId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE);
  if (ttlSeconds) {
    const iat = Math.floor(Date.now() / 1000);
    token.setIssuedAt(iat).setExpirationTime(iat + ttlSeconds);
  }
  return token.sign(keyOf(secret));
}

/** The reminder a calendar link names, or null when the link was not made by พี่ฮูก. */
export async function verifyCalendarToken(token: string, secret: Secrets): Promise<string | null> {
  try {
    const payload = await verifyWithAny(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
