import { RRULE } from "@/lib/calendar";
import { t } from "@/lib/i18n";
import type { Repeat } from "@/lib/user-reminder";

const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const EVENT_MS = 15 * 60_000;
const TIMEOUT_MS = 8_000;

export interface GoogleEvent {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence?: string[];
  reminders: { useDefault: false; overrides: { method: "popup"; minutes: number }[] };
}

/** The event is gone on Google's side (deleted there). */
export class GoogleEventGoneError extends Error {
  constructor() {
    super("google event gone");
  }
}
/** An event with this id is already there (a second add at the same moment). */
export class GoogleEventExistsError extends Error {
  constructor() {
    super("google event exists");
  }
}
/** The account does not let พี่ฮูก write to its calendar (the box was not ticked, or it was taken back). */
export class GoogleForbiddenError extends Error {
  constructor() {
    super("google calendar forbidden");
  }
}

/** A reminder as an event: 15 minutes at its time, alerting then, repeating like it. */
export function toGoogleEvent(input: {
  body: string;
  at: Date;
  repeat: Repeat | null;
  zone: string;
}): GoogleEvent {
  return {
    summary: input.body,
    description: t("จาก พี่ฮูก"),
    start: { dateTime: input.at.toISOString(), timeZone: input.zone },
    end: { dateTime: new Date(input.at.getTime() + EVENT_MS).toISOString(), timeZone: input.zone },
    ...(input.repeat ? { recurrence: [RRULE[input.repeat]] } : {}),
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  };
}

/**
 * The event id a reminder's event gets: its own id without the dashes (Google takes 5-1024 of a-v
 * and 0-9, and hex is within that), so two adds at once make one event, not two.
 */
export const eventIdOf = (reminderId: string) => reminderId.toLowerCase().replace(/-/g, "");

async function call(
  method: string,
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<Response> {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403 || res.status === 401) throw new GoogleForbiddenError();
  return res;
}

export async function insertEvent(
  accessToken: string,
  event: GoogleEvent,
  fetchImpl: typeof fetch = fetch,
  eventId?: string,
): Promise<string> {
  const res = await call("POST", EVENTS, accessToken, fetchImpl, {
    ...event,
    ...(eventId ? { id: eventId } : {}),
  });
  if (res.status === 409) throw new GoogleEventExistsError();
  const data = (await res.json().catch(() => ({}))) as { id?: unknown };
  if (!res.ok || typeof data.id !== "string") throw new Error(`google insert ${res.status}`);
  return data.id;
}

/**
 * Change an event: the whole of it, or only some fields ({ summary }). `revive` brings back one
 * deleted on Google (the person asked to add it again); otherwise a deleted one is "gone".
 */
export async function patchEvent(
  accessToken: string,
  eventId: string,
  event: GoogleEvent | Partial<GoogleEvent>,
  fetchImpl: typeof fetch = fetch,
  options: { revive?: boolean } = {},
): Promise<void> {
  const whole = "start" in event;
  const body = {
    ...event,
    // a one-off that was a repeat stops repeating
    ...(whole ? { recurrence: event.recurrence ?? [] } : {}),
    ...(options.revive ? { status: "confirmed" } : {}),
  };
  const res = await call(
    "PATCH",
    `${EVENTS}/${encodeURIComponent(eventId)}`,
    accessToken,
    fetchImpl,
    body,
  );
  if (res.status === 404 || res.status === 410) throw new GoogleEventGoneError();
  if (!res.ok) throw new Error(`google patch ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { status?: unknown };
  if (data.status === "cancelled") throw new GoogleEventGoneError();
}

/** Already gone is fine. */
export async function deleteEvent(
  accessToken: string,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await call(
    "DELETE",
    `${EVENTS}/${encodeURIComponent(eventId)}`,
    accessToken,
    fetchImpl,
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`google delete ${res.status}`);
  }
}

/** Take one round of a repeating event off the calendar (the round that starts at `at`). */
export async function cancelRound(
  accessToken: string,
  eventId: string,
  at: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(`${EVENTS}/${encodeURIComponent(eventId)}/instances`);
  url.searchParams.set("timeMin", new Date(at.getTime() - 60_000).toISOString());
  url.searchParams.set("timeMax", new Date(at.getTime() + 60_000).toISOString());
  const res = await call("GET", url.toString(), accessToken, fetchImpl);
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) throw new Error(`google instances ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { items?: { id?: unknown }[] };
  const round = data.items?.find((i) => typeof i.id === "string")?.id;
  if (typeof round === "string") await deleteEvent(accessToken, round, fetchImpl);
}
