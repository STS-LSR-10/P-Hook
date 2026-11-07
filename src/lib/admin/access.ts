import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Admin pages sit behind Cloudflare Access. Access signs every request it lets through with a JWT in
 * `Cf-Access-Jwt-Assertion`; this checks that signature, the audience and the person's email, so the
 * page is closed even if someone reaches the Worker by another address (e.g. *.workers.dev).
 * Closed by default: when the settings are missing, nobody gets in.
 */
export interface AccessConfig {
  /** e.g. "myteam.cloudflareaccess.com" */
  teamDomain: string;
  /** The Application Audience (AUD) tag of the Access application. */
  aud: string;
  adminEmail: string;
}

type EnvSource = Record<string, string | undefined>;

export function readAccessConfig(source: EnvSource = process.env): AccessConfig | null {
  const teamDomain = source.CF_ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const aud = source.CF_ACCESS_AUD?.trim();
  if (!teamDomain || !aud) return null;
  const adminEmail = (source.ADMIN_EMAIL?.trim() || "admin@p-hook.com").toLowerCase();
  return { teamDomain, aud, adminEmail };
}

const keySets = new Map<string, JWTVerifyGetKey>();

function accessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/** True only for a valid Access token that belongs to the admin email. */
export async function isAdminRequest(
  headers: Pick<Headers, "get">,
  config: AccessConfig | null = readAccessConfig(),
  getKey?: JWTVerifyGetKey,
): Promise<boolean> {
  if (!config) return false;
  const token = headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getKey ?? accessKeys(config.teamDomain), {
      issuer: `https://${config.teamDomain}`,
      audience: config.aud,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    return email === config.adminEmail;
  } catch {
    return false;
  }
}
