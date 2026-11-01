import { jwtVerify, SignJWT } from "jose";

const ISSUER = "phook";
const AUDIENCE = "phook-file";

export const FILE_LINK_TTL_SECONDS = 600;

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * The credential of a file link, for the same reason as an export link: the LINE in-app browser
 * cannot download, so the phone's own browser opens the link with no session.
 */
export async function signFileToken(
  claims: { userId: string; fileId: string },
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ fid: claims.fileId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + FILE_LINK_TTL_SECONDS)
    .sign(keyOf(secret));
}

export async function verifyFileToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<{ userId: string; fileId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    if (typeof payload.sub !== "string" || typeof payload.fid !== "string") return null;
    return { userId: payload.sub, fileId: payload.fid };
  } catch {
    return null;
  }
}
