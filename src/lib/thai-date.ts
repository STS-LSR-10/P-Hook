// Wall-clock times are read and written in the person's time zone: Bangkok unless they chose another
// (see setZoneSource). Bangkok has a fixed UTC+7 offset (no DST), so it keeps a fast path; any other
// zone is looked up through Intl, daylight saving included. The "bangkok" names are older than zones.
export const DEFAULT_ZONE = "Asia/Bangkok";
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

let zoneSource: (() => string | null | undefined) | null = null;

/** Where the current zone comes from: the request on the server, the signed-in person in the page. */
export function setZoneSource(source: (() => string | null | undefined) | null): void {
  zoneSource = source;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatterOf(zone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(zone)) {
    try {
      formatters.set(
        zone,
        new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          hourCycle: "h23",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        }),
      );
    } catch {
      formatters.set(zone, null); // not a zone this runtime knows
    }
  }
  return formatters.get(zone) ?? null;
}

/** The zone times are shown and read in now. */
export function currentZone(): string {
  let zone: string | null | undefined;
  try {
    zone = zoneSource?.();
  } catch {
    zone = null;
  }
  return zone && (zone === DEFAULT_ZONE || formatterOf(zone)) ? zone : DEFAULT_ZONE;
}

/** How far the zone's clock is ahead of UTC at that moment. */
export function zoneOffsetMs(date: Date, zone: string = currentZone()): number {
  const f = zone === DEFAULT_ZONE ? null : formatterOf(zone);
  if (!f) return BANGKOK_OFFSET_MS;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(date)) p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

export interface BangkokParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

/** The wall-clock parts of a moment in the person's zone. */
export function bangkokParts(date: Date, zone: string = currentZone()): BangkokParts {
  const d = new Date(date.getTime() + zoneOffsetMs(date, zone));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Build a UTC Date from a wall-clock time in the person's zone. Day/month overflow is normalized. */
export function fromBangkok(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  zone: string = currentZone(),
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // the offset at the guess, then at the answer (they differ only across a daylight saving change)
  let at = wall - zoneOffsetMs(new Date(wall), zone);
  const again = wall - zoneOffsetMs(new Date(at), zone);
  if (again !== at) at = again;
  return new Date(at);
}

export function isValidYmd(year: number, month: number, day: number): boolean {
  const t = new Date(Date.UTC(year, month - 1, day));
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day;
}

const MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const two = (n: number) => String(n).padStart(2, "0");

/** Value for `<input type="datetime-local">`: "2026-10-15T14:30" in Bangkok time. */
export function toBangkokInputValue(date: Date): string {
  const p = bangkokParts(date);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** Inverse of `toBangkokInputValue`; null when malformed or not a real date/time. */
export function fromBangkokInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (!isValidYmd(year, month, day) || hour > 23 || minute > 59) return null;
  return fromBangkok(year, month, day, hour, minute);
}

/** "ต.ค. 2569" for a "YYYY-MM" month key (Buddhist year). */
export function thaiMonthYear(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  return `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[1]) + 543}`;
}

/** "ต.ค." */
export function formatThaiMonthShort(date: Date): string {
  return MONTHS[bangkokParts(date).month - 1] ?? "";
}

/** "15 ต.ค." */
export function formatThaiDayMonth(date: Date): string {
  const p = bangkokParts(date);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** "15 ต.ค. 2569" or "15 ต.ค. 2569 14:30" (Buddhist year, Bangkok time). */
export function formatThaiDate(date: Date, withTime = false): string {
  const p = bangkokParts(date);
  const base = `${p.day} ${MONTHS[p.month - 1]} ${p.year + 543}`;
  if (!withTime) return base;
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${base} ${hh}:${mm}`;
}
