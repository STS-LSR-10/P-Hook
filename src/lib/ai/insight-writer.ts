import { currentCurrency, formatBaht } from "@/lib/money";
import type { Insight, InsightFacts } from "@/lib/insight";
import { chooseInsight } from "@/lib/insight";
import { log, safeMessage } from "@/lib/log";
import type { AiProviderName } from "@/lib/ocr/provider";
import { callJson } from "./json-call";
import { STRUCTURER_DEFAULT_MODELS, type StructurerEnv } from "./text-structurer";
import { currentLocale } from "@/lib/i18n";

/** Turns the facts of a period into a few readable observations. Swap providers freely. */
export interface InsightWriter {
  readonly name: string;
  write(facts: InsightFacts): Promise<unknown>;
}

const JSON_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: { type: "string" },
      description: "2 to 4 short Thai observations, each at most 120 characters",
    },
    tip: { type: "string", description: "One practical, neutral Thai tip, at most 120 characters" },
  },
  required: ["insights"],
} as const;

const money = (satang: number) => Number(formatBaht(satang).replace(/,/g, ""));

/**
 * What the model sees: the numbers of the facts and the names of categories and entries, nothing
 * else (no dates of single entries, no user id, no profile).
 */
export function factsForPrompt(f: InsightFacts) {
  return {
    period: f.periodLabel,
    comparedWith: f.previousLabel,
    expenseBaht: money(f.expenseSatang),
    previousExpenseBaht: money(f.previousExpenseSatang),
    incomeBaht: money(f.incomeSatang),
    expenseChangePercent: f.expenseChangePercent,
    categories: f.categories.map((c) => ({
      name: c.name,
      baht: money(c.currentSatang),
      previousBaht: money(c.previousSatang),
      changePercent: c.changePercent,
    })),
    items: f.titles.map((t) => ({
      name: t.name,
      baht: money(t.currentSatang),
      times: t.currentCount,
      previousBaht: money(t.previousSatang),
      previousTimes: t.previousCount,
      changePercent: t.changePercent,
    })),
  };
}

export function insightPrompt(f: InsightFacts): string {
  const language = currentLocale() === "en" ? "English" : "Thai";
  return [
    `You write a short spending review in ${language} for one person, from the facts below.`,
    "Return ONLY a JSON object matching this JSON Schema, with no extra text:",
    JSON.stringify(JSON_SCHEMA),
    "Rules:",
    `- 2 to 4 observations, each at most 120 characters, plain friendly ${language}, no emoji.`,
    `- Use ONLY numbers that appear in the facts (amounts in ${currentCurrency()}, percents, counts, or a difference`,
    "  between two of them). Never invent, round or estimate a number.",
    "- Only mention categories and items that appear in the facts.",
    "- Neutral tone: no blame, no shaming. Notice rises, falls and habits worth knowing about.",
    "- tip: one practical budgeting or habit suggestion. Do NOT give investment, saving-product,",
    "  debt or tax advice.",
    "",
    `Facts: ${JSON.stringify(factsForPrompt(f))}`,
  ].join("\n");
}

export function createInsightWriter(
  cfg: { provider: AiProviderName; apiKey: string; model?: string },
  fetchImpl: typeof fetch = fetch,
): InsightWriter {
  const model = cfg.model ?? STRUCTURER_DEFAULT_MODELS[cfg.provider];
  return {
    name: `${cfg.provider}:${model}`,
    write: (facts) =>
      callJson({ ...cfg, model }, insightPrompt(facts), JSON_SCHEMA, "record_insight", fetchImpl),
  };
}

/** The chosen AI provider, else the first one with a key. Null when none is configured. */
export function buildInsightWriter(
  env: StructurerEnv,
  fetchImpl: typeof fetch = fetch,
): InsightWriter | null {
  const keys: Record<AiProviderName, string | undefined> = {
    gemini: env.GEMINI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
  };
  const order: AiProviderName[] = [
    env.AI_PROVIDER,
    ...(["gemini", "anthropic", "openai"] as const).filter((p) => p !== env.AI_PROVIDER),
  ];
  for (const provider of order) {
    const apiKey = keys[provider];
    if (!apiKey) continue;
    return createInsightWriter(
      { provider, apiKey, model: provider === env.AI_PROVIDER ? env.AI_MODEL : undefined },
      fetchImpl,
    );
  }
  return null;
}

/**
 * The words for a review: the AI's when it is configured and passes the checks, otherwise the
 * plain-code observations. Never throws.
 */
export async function generateInsight(
  writer: InsightWriter | null | undefined,
  facts: InsightFacts,
): Promise<Insight> {
  if (!writer) return chooseInsight(facts, null);
  try {
    return chooseInsight(facts, await writer.write(facts));
  } catch (error) {
    log.warn("insight_failed", { provider: writer.name, reason: safeMessage(error) });
    return chooseInsight(facts, null);
  }
}
