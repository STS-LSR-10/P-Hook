import { jwtVerify, type JWTPayload, type JWTVerifyOptions } from "jose";
import { getServerEnv } from "@/lib/env";

/** One secret, or the current one and the one before it while it is being changed. */
export type Secrets = string | readonly string[];

const keyOf = (secret: string) => new TextEncoder().encode(secret);

/**
 * Check a token against each secret in turn (the current one first). The token is only ever SIGNED
 * with the current secret; the previous one keeps links and sessions made before a change working
 * until they run out, so the secret can be replaced without signing everybody out.
 */
export async function verifyWithAny(
  token: string,
  secrets: Secrets,
  options: JWTVerifyOptions,
): Promise<JWTPayload> {
  const list = (typeof secrets === "string" ? [secrets] : secrets).filter((s) => s.length > 0);
  let last: unknown = new Error("no secret");
  for (const secret of list) {
    try {
      return (await jwtVerify(token, keyOf(secret), options)).payload;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** The secrets a token may be checked with: SESSION_JWT_SECRET, then SESSION_JWT_SECRET_PREVIOUS. */
export function tokenSecrets(): string[] {
  const env = getServerEnv();
  return [env.SESSION_JWT_SECRET, env.SESSION_JWT_SECRET_PREVIOUS].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}
