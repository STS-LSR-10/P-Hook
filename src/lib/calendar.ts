import type { Repeat } from "@/lib/user-reminder";

/** How long the calendar event lasts: the reminder is a moment, the phone needs a span. */
const EVENT_MS = 15 * 60_000;

const RRULE: Record<Repeat, string> = {
  daily: "RRULE:FREQ=DAILY",
  weekly: "RRULE:FREQ=WEEKLY",
  monthly: "RRULE:FREQ=MONTHLY",
};

/** 2026-11-03T03:00:00Z as 20261103T030000Z. */
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Text in an iCalendar value: backslash, comma, semicolon and line breaks escaped. */
const icsText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");

/** A reminder as an .ics file the phone's calendar adds, alerting at its time. */
export function buildIcs(input: {
  id: string;
  body: string;
  at: Date;
  repeat: Repeat | null;
  now: Date;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//phook//reminder//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.id}@phook`,
    `DTSTAMP:${stamp(input.now)}`,
    `DTSTART:${stamp(input.at)}`,
    `DTEND:${stamp(new Date(input.at.getTime() + EVENT_MS))}`,
    `SUMMARY:${icsText(input.body)}`,
    ...(input.repeat ? [RRULE[input.repeat]] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(input.body)}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map((l) => `${l}\r\n`).join("");
}

/** Google Calendar's "add event" page with the reminder filled in. */
export function googleCalendarUrl(input: {
  body: string;
  at: Date;
  repeat: Repeat | null;
}): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", input.body);
  url.searchParams.set(
    "dates",
    `${stamp(input.at)}/${stamp(new Date(input.at.getTime() + EVENT_MS))}`,
  );
  if (input.repeat) url.searchParams.set("recur", RRULE[input.repeat]);
  return url.toString();
}
