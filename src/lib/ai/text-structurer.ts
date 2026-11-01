import { z } from "zod";
import { toSatang } from "@/lib/money";
import { postJson, type AiProviderName } from "@/lib/ocr/provider";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { bangkokParts, fromBangkok, isValidYmd } from "@/lib/thai-date";
import type { TxType } from "@/lib/types";

/** What the model is shown about the person's categories (names only, nothing else). */
export interface CategoryHint {
  name: string;
  type: TxType;
}

export interface StructureRequest {
  text: string;
  /** Today in Bangkok as YYYY-MM-DD, so "เมื่อวาน" and "ศุกร์ที่แล้ว" can be resolved. */
  today: string;
  categories: CategoryHint[];
}

/** Turns a long spoken-style sentence into entries. Returns the (untrusted) structured reply. */
export interface TextStructurer {
  readonly name: string;
  structure(request: StructureRequest): Promise<unknown>;
}

export const MAX_SMART_ENTRIES = 3;
const MAX_TITLE = 60;
const MAX_AGE_DAYS = 366;

const rawSchema = z.object({
  entries: z
    .array(
      z.object({
        type: z.enum(["expense", "income"]),
        title: z.string().nullable().optional(),
        amount: z.union([z.number(), z.string()]).nullable().optional(),
        category: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

const JSON_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income"] },
          title: { type: "string", description: "Short Thai label of what it was, max 30 chars" },
          amount: { type: "number", description: "Amount in THB as a number" },
          category: { type: ["string", "null"], description: "One of the given names, or null" },
          date: { type: ["string", "null"], description: "YYYY-MM-DD if a past day is named" },
        },
        required: ["type", "title", "amount"],
      },
    },
  },
  required: ["entries"],
} as const;

export function structurePrompt(request: StructureRequest): string {
  const names = (type: TxType) =>
    request.categories
      .filter((c) => c.type === type)
      .map((c) => c.name)
      .join(", ");
  return [
    "You turn a Thai message about the user's OWN money into bookkeeping entries.",
    `Today (Asia/Bangkok) is ${request.today}.`,
    "Return ONLY a JSON object matching this JSON Schema, with no extra text:",
    JSON.stringify(JSON_SCHEMA),
    "Rules:",
    "- One entry per payment the user made or money the user received. Max 3.",
    "- Ignore other people's money, plans, wishes and anything not yet paid or received.",
    "- amount: the number actually stated in the message, in THB (digits). Never guess one.",
    "- title: a short clean Thai label (no filler words like นะ, ไป, มา). Not the whole sentence.",
    `- category: exactly one of these names or null. Expense: ${names("expense")}. Income: ${names("income")}.`,
    "- date: YYYY-MM-DD only when the message names a past day (เมื่อวาน, ศุกร์ที่แล้ว, 12/10...), else null.",
    "- Mentions of which wallet or account paid are not needed; ignore them.",
    '- If the message has no money amount, return {"entries": []}.',
    "",
    `Message: ${JSON.stringify(request.text)}`,
  ].join("\n");
}

export interface StructurerConfig {
  provider: AiProviderName;
  apiKey: string;
  model?: string;
}

/** Cheap, fast models: this runs only for Elite users on long sentences. */
export const STRUCTURER_DEFAULT_MODELS: Record<AiProviderName, string> = {
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-5-5",
  openai: "gpt-4o-mini",
};

export function createTextStructurer(
  cfg: StructurerConfig,
  fetchImpl: typeof fetch = fetch,
): TextStructurer {
  const model = cfg.model ?? STRUCTURER_DEFAULT_MODELS[cfg.provider];
  switch (cfg.provider) {
    case "gemini":
      return {
        name: `gemini:${model}`,
        async structure(request) {
          const data = (await postJson(
            "gemini-text",
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            { "x-goog-api-key": cfg.apiKey },
            {
              contents: [{ parts: [{ text: structurePrompt(request) }] }],
              generationConfig: { temperature: 0, responseMimeType: "application/json" },
            },
            fetchImpl,
          )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          const text =
            data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          return parseJsonObject(text);
        },
      };
    case "anthropic":
      return {
        name: `anthropic:${model}`,
        async structure(request) {
          const data = (await postJson(
            "anthropic-text",
            "https://api.anthropic.com/v1/messages",
            { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
            {
              model,
              max_tokens: 1024,
              temperature: 0,
              tools: [
                {
                  name: "record_entries",
                  description: "Record the entries found in the message",
                  input_schema: JSON_SCHEMA,
                },
              ],
              tool_choice: { type: "tool", name: "record_entries" },
              messages: [{ role: "user", content: structurePrompt(request) }],
            },
            fetchImpl,
          )) as { content?: { type: string; input?: unknown; text?: string }[] };
          const tool = data.content?.find((b) => b.type === "tool_use");
          if (tool?.input) return tool.input;
          return parseJsonObject(data.content?.find((b) => b.type === "text")?.text ?? "");
        },
      };
    case "openai":
      return {
        name: `openai:${model}`,
        async structure(request) {
          const data = (await postJson(
            "openai-text",
            "https://api.openai.com/v1/chat/completions",
            { Authorization: `Bearer ${cfg.apiKey}` },
            {
              model,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: structurePrompt(request) }],
            },
            fetchImpl,
          )) as { choices?: { message?: { content?: string } }[] };
          return parseJsonObject(data.choices?.[0]?.message?.content ?? "");
        },
      };
  }
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

export interface StructurerEnv {
  AI_PROVIDER: AiProviderName;
  AI_MODEL?: string;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

/** The chosen AI provider, else the first one that has a key. Null when none is configured. */
/** The provider to use: the configured one when it has a key, else the first that does. */
export function chooseAiProvider(
  env: StructurerEnv,
): { provider: AiProviderName; apiKey: string; model?: string } | null {
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
    // AI_MODEL belongs to the provider it was set for
    const model = provider === env.AI_PROVIDER ? env.AI_MODEL : undefined;
    return { provider, apiKey, model };
  }
  return null;
}

export function buildTextStructurer(
  env: StructurerEnv,
  fetchImpl: typeof fetch = fetch,
): TextStructurer | null {
  const chosen = chooseAiProvider(env);
  return chosen ? createTextStructurer(chosen, fetchImpl) : null;
}

export interface SmartEntry {
  type: TxType;
  title: string;
  amountSatang: number;
  /** Name of one of the person's categories, or null (the rules then pick one). */
  categoryName: string | null;
  occurredAt: Date;
}

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
const UNIT_FACTORS = [1, 1_000, 10_000, 100_000, 1_000_000]; // พัน หมื่น แสน ล้าน, "2k"

/** The amount must really be in the message (digits, optionally with a unit like พัน or k). */
function amountIsInText(amountSatang: number, text: string): boolean {
  const tokens = normalizeThaiDigits(text).match(NUMBER_RE);
  if (!tokens) return true; // spelled out in words: the confirm card is the check
  return tokens.some((t) => {
    const base = toSatang(t.replace(/,/g, ""));
    return base > 0 && UNIT_FACTORS.some((f) => base * f === amountSatang);
  });
}

export function parseDate(
  value: string | null | undefined,
  now: Date,
  maxAgeDays = MAX_AGE_DAYS,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  let year = Number(m[1]);
  if (year >= 2400) year -= 543; // Buddhist era slipped through
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYmd(year, month, day)) return null;
  const today = bangkokParts(now);
  if (year === today.year && month === today.month && day === today.day) return now;
  const at = fromBangkok(year, month, day, 12);
  if (at.getTime() > now.getTime()) return null;
  if (now.getTime() - at.getTime() > maxAgeDays * 86_400_000) return null;
  return at;
}

/**
 * Validate and minimise a model reply. Nothing from it is trusted as-is: the amount must be in the
 * message, the date must be a plausible past day, and the category must be one of the person's own.
 * Entries that fail are dropped; an empty result means "use the ordinary rules".
 */
export function sanitizeStructured(
  raw: unknown,
  input: { text: string; now: Date; categories: CategoryHint[] },
): SmartEntry[] {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return [];
  const out: SmartEntry[] = [];
  for (const e of parsed.data.entries) {
    const amountText =
      typeof e.amount === "number"
        ? e.amount.toFixed(2)
        : String(e.amount ?? "").replace(/[,฿\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(amountText)) continue;
    const amountSatang = toSatang(amountText);
    if (amountSatang <= 0 || amountSatang >= 100_000_000_00) continue;
    if (!amountIsInText(amountSatang, input.text)) continue;

    const title = (e.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
    if (!title) continue;
    const category =
      input.categories.find((c) => c.type === e.type && c.name === (e.category ?? "")) ?? null;
    out.push({
      type: e.type,
      title,
      amountSatang,
      categoryName: category?.name ?? null,
      occurredAt: parseDate(e.date, input.now) ?? input.now,
    });
    if (out.length >= MAX_SMART_ENTRIES) break;
  }
  return out;
}
