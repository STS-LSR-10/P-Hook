import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";
import { currentZone } from "@/lib/thai-date";
import type { Repeat } from "@/lib/user-reminder";
import {
  deleteEvent,
  GoogleEventGoneError,
  insertEvent,
  patchEvent,
  toGoogleEvent,
} from "./calendar-api";
import { googleConfig, type GoogleConfig } from "./config";
import {
  deleteGoogleLink,
  getGoogleEventId,
  getGoogleLink,
  saveGoogleLink,
  setGoogleEventId,
} from "./link-repo";
import { exchangeCode, GoogleRevokedError, refreshAccessToken, revokeToken } from "./oauth";
import { decryptToken, encryptToken } from "./token-crypto";

export interface ReminderEvent {
  id: string;
  body: string;
  remindAt: string;
  repeat: Repeat | null;
}

export interface GoogleDeps {
  cfg: GoogleConfig | null;
  fetch: typeof fetch;
  /** The zone the event is in (the person's own). */
  zone: string;
}

const defaults = (): GoogleDeps => ({ cfg: googleConfig(), fetch, zone: currentZone() });

const eventOf = (r: ReminderEvent, zone: string) =>
  toGoogleEvent({ body: r.body, at: new Date(r.remindAt), repeat: r.repeat, zone });

/** An access token for the person's Google account; null when there is no (working) link. */
async function accessFor(
  db: SupabaseClient,
  userId: string,
  cfg: GoogleConfig,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const link = await getGoogleLink(db, userId);
  if (!link) return null;
  try {
    return await refreshAccessToken(
      cfg,
      await decryptToken(link.sealedToken, cfg.tokenKey),
      fetchImpl,
    );
  } catch (error) {
    if (!(error instanceof GoogleRevokedError)) throw error;
    // they took the access back on Google's side: forget the link, so the page asks again
    await deleteGoogleLink(db, userId);
    return null;
  }
}

/** Keep the account they signed in with. A refresh token of an earlier sign-in is kept if none came. */
export async function linkGoogle(
  db: SupabaseClient,
  userId: string,
  code: string,
  deps: Pick<GoogleDeps, "cfg" | "fetch"> & { cfg: GoogleConfig },
): Promise<{ email: string | null }> {
  const tokens = await exchangeCode(deps.cfg, code, deps.fetch);
  let sealedToken: string;
  if (tokens.refreshToken) {
    sealedToken = await encryptToken(tokens.refreshToken, deps.cfg.tokenKey);
  } else {
    const earlier = await getGoogleLink(db, userId);
    if (!earlier) throw new Error("google gave no refresh token");
    sealedToken = earlier.sealedToken;
  }
  await saveGoogleLink(db, userId, { email: tokens.email, sealedToken });
  return { email: tokens.email };
}

export type AddResult =
  { kind: "added"; email: string | null } | { kind: "not_linked" } | { kind: "failed" };

/** Add the reminder to their Google Calendar (or bring its event up to date when it is there). */
export async function addReminderToGoogle(
  db: SupabaseClient,
  userId: string,
  reminder: ReminderEvent,
  deps: GoogleDeps = defaults(),
): Promise<AddResult> {
  const { cfg } = deps;
  if (!cfg) return { kind: "not_linked" };
  try {
    const access = await accessFor(db, userId, cfg, deps.fetch);
    if (!access) return { kind: "not_linked" };
    const event = eventOf(reminder, deps.zone);
    const existing = await getGoogleEventId(db, userId, reminder.id);
    let added = false;
    if (existing) {
      try {
        await patchEvent(access, existing, event, deps.fetch);
        added = true;
      } catch (error) {
        if (!(error instanceof GoogleEventGoneError)) throw error;
      }
    }
    if (!added) {
      const id = await insertEvent(access, event, deps.fetch);
      await setGoogleEventId(db, userId, reminder.id, id);
    }
    const link = await getGoogleLink(db, userId);
    return { kind: "added", email: link?.email ?? null };
  } catch (error) {
    log.warn("google_add_failed", { reason: safeMessage(error) });
    return { kind: "failed" };
  }
}

/** A reminder was changed: its Google event (if it has one) follows. Never throws. */
export async function syncReminderToGoogle(
  db: SupabaseClient,
  userId: string,
  reminder: ReminderEvent,
  deps: GoogleDeps = defaults(),
): Promise<void> {
  const { cfg } = deps;
  if (!cfg) return;
  try {
    const eventId = await getGoogleEventId(db, userId, reminder.id);
    if (!eventId) return;
    const access = await accessFor(db, userId, cfg, deps.fetch);
    if (!access) return;
    try {
      await patchEvent(access, eventId, eventOf(reminder, deps.zone), deps.fetch);
    } catch (error) {
      // deleted on Google's side: they did not want it there, so it is not added back
      if (!(error instanceof GoogleEventGoneError)) throw error;
      await setGoogleEventId(db, userId, reminder.id, null);
    }
  } catch (error) {
    log.warn("google_sync_failed", { reason: safeMessage(error) });
  }
}

/**
 * The Google event of a reminder, read before it is cancelled (the row goes with it). Null when there
 * is none, Google is not set up, or it cannot be read (before the migration). Never throws.
 */
export async function googleEventOf(
  db: SupabaseClient,
  userId: string,
  reminderId: string,
  cfg: GoogleConfig | null = googleConfig(),
): Promise<string | null> {
  if (!cfg) return null;
  return getGoogleEventId(db, userId, reminderId).catch(() => null);
}

/** A reminder was cancelled: its Google event goes too. Never throws. */
export async function removeGoogleEvent(
  db: SupabaseClient,
  userId: string,
  eventId: string | null,
  deps: GoogleDeps = defaults(),
): Promise<void> {
  const { cfg } = deps;
  if (!cfg || !eventId) return;
  try {
    const access = await accessFor(db, userId, cfg, deps.fetch);
    if (access) await deleteEvent(access, eventId, deps.fetch);
  } catch (error) {
    log.warn("google_remove_failed", { reason: safeMessage(error) });
  }
}

/** Sign out of Google here: the access is given back and the link forgotten (events stay). */
export async function unlinkGoogle(
  db: SupabaseClient,
  userId: string,
  deps: GoogleDeps = defaults(),
): Promise<void> {
  const link = await getGoogleLink(db, userId);
  if (!link) return;
  if (deps.cfg) {
    const token = await decryptToken(link.sealedToken, deps.cfg.tokenKey).catch(() => null);
    if (token) await revokeToken(token, deps.fetch);
  }
  await deleteGoogleLink(db, userId);
}
