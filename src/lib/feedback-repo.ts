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
