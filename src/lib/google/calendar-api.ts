import { RRULE } from "@/lib/calendar";
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

/** The event is gone on Google's side (deleted there): add it again rather than change it. */
export class GoogleEventGoneError extends Error {
  constructor() {
    super("google event gone");
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
    description: "จาก พี่ฮูก",
    start: { dateTime: input.at.toISOString(), timeZone: input.zone },
    end: { dateTime: new Date(input.at.getTime() + EVENT_MS).toISOString(), timeZone: input.zone },
    ...(input.repeat ? { recurrence: [RRULE[input.repeat]] } : {}),
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  };
}

async function call(
  method: string,
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  body?: GoogleEvent,
): Promise<Response> {
  return fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function insertEvent(
  accessToken: string,
  event: GoogleEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await call("POST", EVENTS, accessToken, fetchImpl, event);
  const data = (await res.json().catch(() => ({}))) as { id?: unknown };
  if (!res.ok || typeof data.id !== "string") throw new Error(`google insert ${res.status}`);
  return data.id;
}

export async function patchEvent(
  accessToken: string,
  eventId: string,
  event: GoogleEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await call(
    "PATCH",
    `${EVENTS}/${encodeURIComponent(eventId)}`,
    accessToken,
    fetchImpl,
    // a one-off that was a repeat stops repeating
    { ...event, recurrence: event.recurrence ?? [] },
  );
  if (res.status === 404 || res.status === 410) throw new GoogleEventGoneError();
  if (!res.ok) throw new Error(`google patch ${res.status}`);
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
