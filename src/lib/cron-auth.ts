import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Cron endpoints accept `Authorization: Bearer <CRON_SECRET>` only (the Cloudflare Cron Triggers
 * handler in cf-worker.mjs sends it, and so does the manual GitHub workflow).
 * Comparing digests keeps the comparison constant-time regardless of length.
 */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1]), digest(secret));
}
