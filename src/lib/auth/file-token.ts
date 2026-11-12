import { SignJWT } from "jose";
import { verifyWithAny, type Secrets } from "./keys";

const ISSUER = "phook";
const AUDIENCE = "phook-file";

export const FILE_LINK_TTL_SECONDS = 600;

const VIEW_AUDIENCE = "phook-view";
const VIEW_TTL_SECONDS = 3600;

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
  secret: Secrets,
  now: Date = new Date(),
): Promise<{ userId: string; fileId: string } | null> {
  try {
    const payload = await verifyWithAny(token, secret, {
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

/** Lets one person's page show their own pictures. Good for reading, and for nothing else. */
export function signViewToken(userId: string, secret: string, now: Date = new Date()) {
  return signView({}, userId, secret, now);
}

/**
 * Lets a group's page show that group's pictures. The subject is the owner (the files are theirs),
 * and `gid` holds it to the one group, so it never shows the owner's own files.
 */
export function signGroupViewToken(
  ownerId: string,
  groupId: string,
  secret: string,
  now: Date = new Date(),
) {
  return signView({ gid: groupId }, ownerId, secret, now);
}

async function signView(
  claims: { gid?: string },
  userId: string,
  secret: string,
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(VIEW_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + VIEW_TTL_SECONDS)
    .sign(keyOf(secret));
}

/** Whose pictures a view token shows: a person's own (`groupId` null), or one group's. */
export async function readViewToken(
  token: string,
  secret: Secrets,
  now: Date = new Date(),
): Promise<{ userId: string; groupId: string | null } | null> {
  try {
    const payload = await verifyWithAny(token, secret, {
      issuer: ISSUER,
      audience: VIEW_AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, groupId: typeof payload.gid === "string" ? payload.gid : null };
  } catch {
    return null;
  }
}

/** The person of a token for their own pictures (null for a group's token). */
export async function verifyViewToken(
  token: string,
  secret: Secrets,
  now: Date = new Date(),
): Promise<string | null> {
  const claims = await readViewToken(token, secret, now);
  return claims && claims.groupId === null ? claims.userId : null;
}
