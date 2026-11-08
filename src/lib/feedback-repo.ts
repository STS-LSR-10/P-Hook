import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedbackSource } from "@/lib/feedback";

export interface NewFeedback {
  userId: string;
  plan: "free" | "plus" | "ultimate";
  body: string;
  source: FeedbackSource;
}

export async function addFeedback(db: SupabaseClient, input: NewFeedback): Promise<void> {
  const { error } = await db.from("feedback").insert({
    user_id: input.userId,
    plan: input.plan,
    body: input.body,
    source: input.source,
  });
  if (error) throw new Error(`add feedback: ${error.message}`);
}

/** Remove one suggestion for good; false when it was already gone. */
export async function deleteFeedback(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db.from("feedback").delete().eq("id", id).select("id");
  if (error) throw new Error(`delete feedback: ${error.message}`);
  return (data ?? []).length > 0;
}
