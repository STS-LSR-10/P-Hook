import { DEFAULT_ZONE, zoneOffsetMs } from "@/lib/thai-date";

export { DEFAULT_ZONE };

/** The time zones a person can pick, west to east, by the city people know them by. */
export const ZONES: { id: string; city: string }[] = [
  { id: "Pacific/Honolulu", city: "Honolulu" },
  { id: "America/Anchorage", city: "Anchorage" },
  { id: "America/Los_Angeles", city: "Los Angeles" },
  { id: "America/Vancouver", city: "Vancouver" },
  { id: "America/Denver", city: "Denver" },
  { id: "America/Phoenix", city: "Phoenix" },
  { id: "America/Chicago", city: "Chicago" },
  { id: "America/Mexico_City", city: "Mexico City" },
  { id: "America/New_York", city: "New York" },
  { id: "America/Toronto", city: "Toronto" },
  { id: "America/Bogota", city: "Bogotá" },
  { id: "America/Lima", city: "Lima" },
  { id: "America/Santiago", city: "Santiago" },
  { id: "America/Sao_Paulo", city: "São Paulo" },
  { id: "America/Argentina/Buenos_Aires", city: "Buenos Aires" },
  { id: "UTC", city: "UTC" },
  { id: "Europe/London", city: "London" },
  { id: "Europe/Lisbon", city: "Lisbon" },
  { id: "Europe/Paris", city: "Paris" },
  { id: "Europe/Berlin", city: "Berlin" },
  { id: "Europe/Amsterdam", city: "Amsterdam" },
  { id: "Europe/Madrid", city: "Madrid" },
  { id: "Europe/Rome", city: "Rome" },
  { id: "Europe/Zurich", city: "Zurich" },
  { id: "Europe/Stockholm", city: "Stockholm" },
  { id: "Europe/Athens", city: "Athens" },
  { id: "Europe/Helsinki", city: "Helsinki" },
  { id: "Africa/Cairo", city: "Cairo" },
  { id: "Africa/Johannesburg", city: "Johannesburg" },
  { id: "Europe/Istanbul", city: "Istanbul" },
  { id: "Europe/Moscow", city: "Moscow" },
  { id: "Asia/Riyadh", city: "Riyadh" },
  { id: "Asia/Dubai", city: "Dubai" },
  { id: "Asia/Karachi", city: "Karachi" },
  { id: "Asia/Kolkata", city: "Kolkata" },
  { id: "Asia/Colombo", city: "Colombo" },
  { id: "Asia/Kathmandu", city: "Kathmandu" },
  { id: "Asia/Dhaka", city: "Dhaka" },
  { id: "Asia/Yangon", city: "Yangon" },
  { id: "Asia/Bangkok", city: "Bangkok" },
  { id: "Asia/Ho_Chi_Minh", city: "Ho Chi Minh" },
  { id: "Asia/Jakarta", city: "Jakarta" },
  { id: "Asia/Phnom_Penh", city: "Phnom Penh" },
  { id: "Asia/Vientiane", city: "Vientiane" },
  { id: "Asia/Kuala_Lumpur", city: "Kuala Lumpur" },
  { id: "Asia/Singapore", city: "Singapore" },
  { id: "Asia/Manila", city: "Manila" },
  { id: "Asia/Hong_Kong", city: "Hong Kong" },
  { id: "Asia/Shanghai", city: "Shanghai" },
  { id: "Asia/Taipei", city: "Taipei" },
  { id: "Australia/Perth", city: "Perth" },
  { id: "Asia/Seoul", city: "Seoul" },
  { id: "Asia/Tokyo", city: "Tokyo" },
  { id: "Australia/Adelaide", city: "Adelaide" },
  { id: "Australia/Brisbane", city: "Brisbane" },
  { id: "Australia/Sydney", city: "Sydney" },
  { id: "Australia/Melbourne", city: "Melbourne" },
  { id: "Pacific/Auckland", city: "Auckland" },
];

const IDS = new Set(ZONES.map((z) => z.id));

/** One of the zones above (anything else is refused, so a stored zone is always one we list). */
export const isZone = (id: unknown): id is string => typeof id === "string" && IDS.has(id);

/** "UTC+07:00" / "UTC-05:00" / "UTC+05:30" at that moment (daylight saving moves it). */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string {
  const minutes = Math.round(zoneOffsetMs(at, zone) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const two = (n: number) => String(n).padStart(2, "0");
  return `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** "Bangkok (UTC+07:00)". */
export const zoneLabel = (zone: string, at?: Date): string =>
  `${ZONES.find((z) => z.id === zone)?.city ?? zone} (${utcOffsetLabel(zone, at)})`;
