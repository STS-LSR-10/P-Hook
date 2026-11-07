/** How often and when the bot chases unpaid bills in a group (rides on chat, so it costs no quota). */
export type ChaseWindow = "any" | "morning" | "noon" | "evening";

export interface ChaseSchedule {
  /** 0 = off, otherwise a bill is chased again after this many days. */
  everyDays: 0 | 1 | 2 | 3 | 7;
  window: ChaseWindow;
}

/** What every group did before it was a setting: every day, from 10:00. */
export const DEFAULT_CHASE: ChaseSchedule = { everyDays: 1, window: "any" };

export const CHASE_EVERY: ChaseSchedule["everyDays"][] = [0, 1, 2, 3, 7];
export const CHASE_WINDOWS: ChaseWindow[] = ["any", "morning", "noon", "evening"];

/** Bangkok hours [from, to) each window covers; nobody is poked before 10:00 or after 22:00 except "any". */
const HOURS: Record<ChaseWindow, [number, number]> = {
  any: [10, 24],
  morning: [10, 12],
  noon: [12, 16],
  evening: [16, 22],
};

export const inChaseWindow = (hour: number, window: ChaseWindow): boolean =>
  hour >= HOURS[window][0] && hour < HOURS[window][1];

/** A schedule from untrusted input, or null when it is not one. */
export function parseChase(input: unknown): ChaseSchedule | null {
  if (typeof input !== "object" || input === null) return null;
  const { everyDays, window } = input as Record<string, unknown>;
  const days = CHASE_EVERY.find((d) => d === everyDays);
  const when = CHASE_WINDOWS.find((w) => w === window);
  return days === undefined || when === undefined ? null : { everyDays: days, window: when };
}
