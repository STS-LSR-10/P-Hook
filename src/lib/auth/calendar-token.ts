import { jwtVerify, SignJWT } from "jose";

const ISSUER = "phook";
const AUDIENCE = "phook-calendar";

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * The credential of an "add to calendar" link on a group's reminder card. The phone's own browser opens
 * it with no session, so it names the one reminder and lets that be read as a calendar event, nothing
 * more. It does not expire: a repeating reminder can be added any time while it lasts.
 */
export async function signCalendarToken(reminderId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(reminderId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(keyOf(secret));
}

/** The reminder a calendar link names, or null when the link was not made by พี่ฮูก. */
export async function verifyCalendarToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
