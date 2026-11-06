import type { SupabaseClient } from "@supabase/supabase-js";
import { log, safeMessage } from "@/lib/log";
import { looksSecret } from "@/lib/secret-text";
import {
  cleanHabits,
  emptyHabits,
  habitKeys,
  observeHabits,
  styleHints,
  type HabitKey,
  type StyleHabits,
} from "@/lib/ai/style-profile";

export interface StyleState {
  enabled: boolean;
  habits: StyleHabits;
}

export async function loadStyle(db: SupabaseClient, userId: string): Promise<StyleState> {
  const { data, error } = await db
    .from("user_style")
    .select("habits,enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`load style: ${error.message}`);
  const row = data as { habits?: unknown; enabled?: boolean } | null;
  return { enabled: row?.enabled !== false, habits: cleanHabits(row?.habits) };
}

/** What the person is shown: whether it is on, how many messages it has seen, and what it found. */
export async function styleSummary(
  db: SupabaseClient,
  userId: string,
): Promise<{ enabled: boolean; seen: number; habits: HabitKey[] }> {
  const s = await loadStyle(db, userId);
  return { enabled: s.enabled, seen: s.habits.n, habits: habitKeys(s.habits) };
}

/** Short hints for the AI. Empty when it is off, there is nothing yet, or the read fails. */
export async function loadStyleHints(db: SupabaseClient, userId: string): Promise<string[]> {
  try {
    const s = await loadStyle(db, userId);
    return s.enabled ? styleHints(s.habits) : [];
  } catch {
    return [];
  }
}

/**
 * Learn from one message the rules read as a single entry. Never throws: it is not worth a failed
 * reply. It writes the counts only, and only while the person has it on: the on/off is theirs, so a
 * learn that was already running when they switched it off or cleared it cannot turn it back on.
 */
export async function learnStyle(db: SupabaseClient, userId: string, text: string): Promise<void> {
  try {
    if (looksSecret(text)) return;
    const { data, error } = await db
      .from("user_style")
      .select("habits,enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { habits?: unknown; enabled?: boolean } | null;
    if (row?.enabled === false) return;
    const habits = cleanHabits(row?.habits);
    const next = observeHabits(habits, text);
    if (next === habits) return;
    const stamp = new Date().toISOString();
    if (row) {
      const res = await db
        .from("user_style")
        .update({ habits: next, updated_at: stamp })
        .eq("user_id", userId)
        .eq("enabled", true);
      if (res.error) throw new Error(res.error.message);
      return;
    }
    // the first message: if another one made the row in the meantime, this one is simply skipped
    const res = await db.from("user_style").insert({ user_id: userId, habits: next });
    if (res.error && res.error.code !== "23505") throw new Error(res.error.message);
  } catch (error) {
    log.warn("style_learn_failed", { reason: safeMessage(error) });
  }
}

/** Switch learning on or off. Switching off also forgets what was learned. */
export async function setStyleEnabled(
  db: SupabaseClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await db.from("user_style").upsert({
    user_id: userId,
    habits: enabled ? (await loadStyle(db, userId)).habits : emptyHabits(),
    enabled,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`save style: ${error.message}`);
}

/** Forget everything learned, keeping the on/off choice. */
export async function clearStyle(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db
    .from("user_style")
    .update({ habits: emptyHabits(), updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`clear style: ${error.message}`);
}
