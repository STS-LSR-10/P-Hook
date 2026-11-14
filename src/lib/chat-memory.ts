import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { looksSecret } from "@/lib/secret-text";
import type { LineMessage } from "@/lib/types";

/** One message of the chat: what the person typed, or what the bot answered. */
export interface ChatTurn {
  role: "user" | "bot";
  body: string;
}

/** How many messages are remembered, and for how long after the last one. */
export const MEMORY_TURNS = 6;
export const MEMORY_MS = 10 * 60_000;
const MAX_BODY = 300;

const cut = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_BODY);

/** What the bot said in a reply, short: each text, or a card's alt text. */
export function replyText(messages: LineMessage[]): string {
  return cut(
    messages
      .map((m) =>
        typeof m.text === "string" ? m.text : typeof m.altText === "string" ? m.altText : "",
      )
      .filter(Boolean)
      .join(" / "),
  );
}

/**
 * What of a message and its answer may be kept, and later sent to the AI with the next message:
 * nothing when the message looks secret (a password, an ID number); otherwise any long number, such
 * as a bank account, is hidden.
 */
export function memorable(turns: ChatTurn[]): ChatTurn[] {
  if (turns.some((t) => t.role === "user" && looksSecret(t.body))) return [];
  return turns
    .filter((t) => !looksSecret(t.body))
    .map((t) => ({
      ...t,
      body: cut(normalizeThaiDigits(t.body).replace(/\d[\d\s-]{7,}\d/g, "•••")),
    }))
    .filter((t) => t.body);
}

/** The turns as the AI reads them, oldest first (a secret kept before is never shown). */
export function historyText(turns: ChatTurn[]): string {
  return turns
    .filter((t) => !looksSecret(t.body))
    .map((t) => `${t.role === "user" ? "ผู้ใช้" : "พี่ฮูก"}: ${t.body}`)
    .join("\n");
}

/** The chat of the last few minutes, oldest first; none when it has gone quiet. Never throws. */
export async function recentTurns(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<ChatTurn[]> {
  try {
    const { data, error } = await db
      .from("chat_turns")
      .select("role,body")
      .eq("user_id", userId)
      .gt("created_at", new Date(now.getTime() - MEMORY_MS).toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MEMORY_TURNS);
    if (error) throw new Error(error.message);
    return ((data ?? []) as ChatTurn[]).reverse();
  } catch (error) {
    log.warn("chat_memory_read_failed", { reason: String(error) });
    return [];
  }
}

/** Keep a message and its answer, and forget what is older than the memory. Never throws. */
export async function rememberTurns(
  db: SupabaseClient,
  userId: string,
  turns: ChatTurn[],
  now: Date,
): Promise<void> {
  const rows = memorable(turns).map((t) => ({ user_id: userId, role: t.role, body: t.body }));
  if (rows.length === 0) return;
  try {
    const { error } = await db.from("chat_turns").insert(rows);
    if (error) throw new Error(error.message);
    await db
      .from("chat_turns")
      .delete()
      .eq("user_id", userId)
      .lt("created_at", new Date(now.getTime() - MEMORY_MS).toISOString());
    const { data } = await db
      .from("chat_turns")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(MEMORY_TURNS, MEMORY_TURNS + 50);
    const old = ((data ?? []) as { id: number }[]).map((r) => r.id);
    if (old.length) await db.from("chat_turns").delete().in("id", old);
  } catch (error) {
    log.warn("chat_memory_write_failed", { reason: String(error) });
  }
}

/** Every chat gone quiet for longer than the memory (the 5-minute cron). */
export async function forgetQuietChats(db: SupabaseClient, now: Date): Promise<void> {
  const { error } = await db
    .from("chat_turns")
    .delete()
    .lt("created_at", new Date(now.getTime() - MEMORY_MS).toISOString());
  if (error) log.warn("chat_memory_sweep_failed", { reason: error.message });
}
