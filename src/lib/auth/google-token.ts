import { jwtVerify, SignJWT } from "jose";

const ISSUER = "phook";
const AUDIENCE = "phook-google";
/** Long enough to sign in with Google, short enough that a link someone else sends is soon useless. */
export const GOOGLE_LINK_TTL_SECONDS = 10 * 60;

const keyOf = (secret: string) => new TextEncoder().encode(secret);

export interface GoogleLinkClaims {
  userId: string;
  /** This link's own id: it is used up when Google sends the person back (one sign-in per link). */
  jti?: string;
  /** The reminder to add once signed in (null: only sign in, from the settings). */
  reminderId: string | null;
}

/**
 * The credential of the hop to the phone's own browser (Google refuses to sign in inside LINE), and
 * then the `state` Google hands back to the callback. It names the person and the one reminder.
 */
export async function signGoogleLinkToken(
  claims: GoogleLinkClaims,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ rid: claims.reminderId })
    .setJti(claims.jti ?? crypto.randomUUID())
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + GOOGLE_LINK_TTL_SECONDS)
    .sign(keyOf(secret));
}

export async function verifyGoogleLinkToken(
  token: string,
  secret: string,
): Promise<GoogleLinkClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") return null;
    const rid = payload.rid;
    return {
      userId: payload.sub,
      reminderId: typeof rid === "string" ? rid : null,
      jti: typeof payload.jti === "string" ? payload.jti : undefined,
    };
  } catch {
    return null;
  }
}
