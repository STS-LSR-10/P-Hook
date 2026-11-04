/** What signing in with Google needs. Null while the secrets are not all set (then the page offers
 * Google Calendar's own add-event page instead, which needs no sign-in). */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** base64 of 32 random bytes: the key the refresh tokens are encrypted with. */
  tokenKey: string;
  redirectUri: string;
}

type Source = Record<string, string | undefined>;

export function googleConfig(source: Source = process.env): GoogleConfig | null {
  const clientId = source.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim();
  const tokenKey = source.GOOGLE_TOKEN_KEY?.trim();
  const base = source.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (!clientId || !clientSecret || !tokenKey || !base) return null;
  let bytes = 0;
  try {
    bytes = atob(tokenKey).length;
  } catch {
    return null;
  }
  if (bytes !== 32) return null;
  return { clientId, clientSecret, tokenKey, redirectUri: `${base}/api/google/callback` };
}
