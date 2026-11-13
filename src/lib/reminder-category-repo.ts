import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomReminderCategory } from "@/lib/user-reminder";

function fail(context: string, error: { message: string; code?: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

/** The person's own reminder categories, oldest first. */
export async function listReminderCategories(
  db: SupabaseClient,
  userId: string,
): Promise<CustomReminderCategory[]> {
  const { data, error } = await db
    .from("reminder_categories")
    .select("id,name,emoji")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) fail("listReminderCategories", error);
  return (data ?? []) as CustomReminderCategory[];
}

const UNIQUE_VIOLATION = "23505";

/** Null when the person already has a category of that name. */
export async function createReminderCategory(
  db: SupabaseClient,
  userId: string,
  input: { name: string; emoji: string },
): Promise<CustomReminderCategory | null> {
  const { data, error } = await db
    .from("reminder_categories")
    .insert({ user_id: userId, name: input.name, emoji: input.emoji })
    .select("id,name,emoji")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return null; // the same name, made at the same moment
  if (error) fail("createReminderCategory", error);
  return data as CustomReminderCategory;
}

/** "missing" when it is not the person's, "taken" when another of theirs has the name. */
export async function updateReminderCategory(
  db: SupabaseClient,
  userId: string,
  id: string,
  input: { name: string; emoji: string },
): Promise<"ok" | "missing" | "taken"> {
  const { data, error } = await db
    .from("reminder_categories")
    .update({ name: input.name, emoji: input.emoji })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error?.code === UNIQUE_VIOLATION) return "taken";
  if (error) fail("updateReminderCategory", error);
  return (data ?? []).length > 0 ? "ok" : "missing";
}

/** Removes it, and its reminders go back to having no category. False when it is not the person's. */
export async function deleteReminderCategory(
  db: SupabaseClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("reminder_categories")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) fail("deleteReminderCategory", error);
  if ((data ?? []).length === 0) return false;
  const cleared = await db
    .from("user_reminders")
    .update({ category: null })
    .eq("user_id", userId)
    .eq("category", id);
  if (cleared.error) fail("deleteReminderCategory: clear reminders", cleared.error);
  return true;
}
