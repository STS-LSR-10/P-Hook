import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntentDecision } from "@/lib/ai/intent-router";

const TTL_MS = 10 * 60_000;

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

export interface PendingIntent {
  id: string;
  input: string;
  decision: IntentDecision | null;
}

/** Keep a message until the person answers. Replaces what they had waiting; returns the new id. */
export async function putPendingIntent(
  db: SupabaseClient,
  userId: string,
  input: { text: string; decision: IntentDecision | null },
  now: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await db.from("pending_intents").upsert(
    {
      user_id: userId,
      id,
      input: input.text,
      decision: input.decision,
      expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) fail("put pending intent", error);
  return id;
}

/** Take it for use: deleting it here means a second tap on the button finds nothing. */
export async function takePendingIntent(
  db: SupabaseClient,
  userId: string,
  id: string,
  now: Date,
): Promise<PendingIntent | null> {
  const { data, error } = await db
    .from("pending_intents")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .gt("expires_at", now.toISOString())
    .select("id,input,decision")
    .maybeSingle();
  if (error) fail("take pending intent", error);
  return (data as PendingIntent | null) ?? null;
}

/** Messages nobody answered must not stay around: they may hold a secret. */
export async function purgeExpiredIntents(db: SupabaseClient, now: Date): Promise<void> {
  const { error } = await db.from("pending_intents").delete().lte("expires_at", now.toISOString());
  if (error) fail("purge pending intents", error);
}
