import type { GoogleConfig } from "./config";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** Only the events of their calendars, and which account it is. Nothing else of theirs. */
const SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
const TIMEOUT_MS = 8_000;

/** The person took the access back (or it ran out): sign in again. */
export class GoogleRevokedError extends Error {
  constructor() {
    super("google access revoked");
  }
}

/** Google's sign-in and consent page. `state` comes back to the callback as it went. */
export function googleAuthUrl(cfg: GoogleConfig, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  // a refresh token, so the bot can keep the event in step later; consent so it is always given
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenCall(
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (data.error === "invalid_grant") throw new GoogleRevokedError();
  if (!res.ok) throw new Error(`google token ${res.status}: ${String(data.error ?? "")}`);
  return data;
}

/** The email in Google's ID token (it came straight from Google over TLS, so it is not re-checked). */
function emailOf(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const part = idToken.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as {
      email?: unknown;
    };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string | null; email: string | null }> {
  const data = await tokenCall(
    {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
  if (typeof data.access_token !== "string") throw new Error("google token: no access token");
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    email: emailOf(data.id_token),
  };
}

export async function refreshAccessToken(
  cfg: GoogleConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const data = await tokenCall(
    {
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  if (typeof data.access_token !== "string") throw new Error("google token: no access token");
  return data.access_token;
}

/** Give the access back to Google (best effort: the link is removed here either way). */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
}
