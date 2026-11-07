import type { AiProviderName } from "@/lib/env";
import { later } from "@/lib/later";
import { log, safeMessage } from "@/lib/log";
import { getAdminClient } from "@/lib/supabase/admin";

/** What one AI call used. No user id and no text: only counts. */
export interface AiUsageEntry {
  provider: AiProviderName;
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
}

const HOSTS: Record<string, AiProviderName> = {
  "generativelanguage.googleapis.com": "gemini",
  "api.anthropic.com": "anthropic",
  "api.openai.com": "openai",
};

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** "gemini-owl" -> "owl"; the slip readers are labelled with the provider alone -> "slip". */
export function featureOf(label: string): string {
  return label.replace(/^(gemini|anthropic|openai)-?/, "") || "slip";
}

/** Read the model and token counts out of a provider's reply. Null for a host that is not an AI. */
export function parseAiUsage(
  label: string,
  url: string,
  body: unknown,
  data: unknown,
): AiUsageEntry | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const provider = HOSTS[parsed.hostname];
  if (!provider) return null;
  const reply = record(data);
  const sent = record(body);
  const feature = featureOf(label);

  if (provider === "gemini") {
    const match = /\/models\/([^/:]+):/.exec(parsed.pathname);
    const usage = record(reply.usageMetadata);
    return {
      provider,
      model: match?.[1] ? decodeURIComponent(match[1]) : "unknown",
      feature,
      inputTokens: count(usage.promptTokenCount),
      // thinking tokens are billed as output
      outputTokens: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
    };
  }

  const model = String(reply.model ?? sent.model ?? "unknown");
  const usage = record(reply.usage);
  if (provider === "anthropic") {
    return {
      provider,
      model,
      feature,
      inputTokens:
        count(usage.input_tokens) +
        count(usage.cache_creation_input_tokens) +
        count(usage.cache_read_input_tokens),
      outputTokens: count(usage.output_tokens),
    };
  }
  return {
    provider,
    model,
    feature,
    inputTokens: count(usage.prompt_tokens),
    outputTokens: count(usage.completion_tokens),
  };
}

type Recorder = (entry: AiUsageEntry) => Promise<void>;

async function saveToDatabase(entry: AiUsageEntry): Promise<void> {
  const { error } = await getAdminClient()
    .from("ai_usage_log")
    .insert({
      provider: entry.provider,
      model: entry.model.slice(0, 100),
      feature: entry.feature.slice(0, 40),
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
    });
  if (error) throw new Error(`ai usage log: ${error.message}`);
}

let recorder: Recorder | null = null;

/** Replace where usage goes (tests). Null goes back to the database. */
export function setAiUsageRecorder(next: Recorder | null): void {
  recorder = next;
}

/**
 * Keep what an AI call used. Never throws and never fails the call: in a LINE event it is written
 * after the reply (see `later`). Unit tests write nothing unless they set a recorder.
 */
export async function noteAiUsage(
  label: string,
  url: string,
  body: unknown,
  data: unknown,
): Promise<void> {
  try {
    const entry = parseAiUsage(label, url, body, data);
    const save = recorder ?? (process.env.VITEST ? null : saveToDatabase);
    if (!entry || !save) return;
    await later(() =>
      save(entry).catch((error: unknown) =>
        log.warn("ai_usage_log_failed", { reason: safeMessage(error) }),
      ),
    );
  } catch {
    // keeping the count must never break the answer
  }
}
