import type { SupabaseClient } from "@supabase/supabase-js";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

export interface GoogleLink {
  email: string | null;
  /** Sealed (see token-crypto): never the token itself. */
  sealedToken: string;
}

export async function getGoogleLink(
  db: SupabaseClient,
  userId: string,
): Promise<GoogleLink | null> {
  const { data, error } = await db
    .from("google_calendar_links")
    .select("email,refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("get google link", error);
  if (!data) return null;
  const row = data as { email: string | null; refresh_token: string };
  return { email: row.email, sealedToken: row.refresh_token };
}

export async function saveGoogleLink(
  db: SupabaseClient,
  userId: string,
  link: GoogleLink,
): Promise<void> {
  const { error } = await db.from("google_calendar_links").upsert(
    {
      user_id: userId,
      email: link.email,
      refresh_token: link.sealedToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) fail("save google link", error);
}

/** The link gone, and no reminder points at an event of that account any more. */
export async function deleteGoogleLink(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.from("google_calendar_links").delete().eq("user_id", userId);
  if (error) fail("delete google link", error);
  const cleared = await db
    .from("user_reminders")
    .update({ google_event_id: null })
    .eq("user_id", userId)
    .not("google_event_id", "is", null);
  if (cleared.error) fail("clear google events", cleared.error);
}

export async function getGoogleEventId(
  db: SupabaseClient,
  userId: string,
  reminderId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("user_reminders")
    .select("google_event_id")
    .eq("id", reminderId)
    .eq("user_id", userId)
    .is("group_id", null)
    .maybeSingle();
  if (error) fail("get google event", error);
  return (data as { google_event_id: string | null } | null)?.google_event_id ?? null;
}

export async function setGoogleEventId(
  db: SupabaseClient,
  userId: string,
  reminderId: string,
  eventId: string | null,
): Promise<void> {
  const { error } = await db
    .from("user_reminders")
    .update({ google_event_id: eventId })
    .eq("id", reminderId)
    .eq("user_id", userId)
    .is("group_id", null);
  if (error) fail("set google event", error);
}

/** What the pages opened outside LINE need of the person: their name, zone, currency and language. */
export async function getUserBasics(
  db: SupabaseClient,
  userId: string,
): Promise<{
  displayName: string | null;
  timezone: string | null;
  currency: string | null;
  locale: string | null;
} | null> {
  const { data, error } = await db
    .from("users")
    .select("display_name,timezone,currency,locale")
    .eq("id", userId)
    .maybeSingle();
  if (error) fail("get user", error);
  if (!data) return null;
  const r = data as Record<string, string | null>;
  return {
    displayName: r.display_name ?? null,
    timezone: r.timezone ?? null,
    currency: r.currency ?? null,
    locale: r.locale ?? null,
  };
}
