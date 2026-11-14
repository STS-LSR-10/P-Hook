import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";

/** Uses the app writes itself (notes and files are written by the database). */
export type ActivityKind =
  "reminder_chat" | "reminder_page" | "reminder_group" | "calendar_google" | "calendar_device";

/** Count one use for the admin's usage tab. Never fails the action it counts. */
export async function logActivity(
  db: SupabaseClient,
  userId: string | null,
  kind: ActivityKind,
): Promise<void> {
  try {
    const { error } = await db.from("activity_events").insert({ kind, user_id: userId });
    if (error) log.warn("activity_log_failed", { kind, reason: error.message });
  } catch (error) {
    log.warn("activity_log_failed", { kind, reason: String(error) });
  }
}
