import type { ReminderDto } from "@/lib/user-reminder";

const squeeze = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** The reminders `query` could mean: either text contains the other, spacing and case aside. */
export function matchReminders(reminders: ReminderDto[], query: string): ReminderDto[] {
  const q = squeeze(query);
  if (!q) return [];
  return reminders.filter((r) => {
    const body = squeeze(r.body);
    return body.includes(q) || q.includes(body);
  });
}
