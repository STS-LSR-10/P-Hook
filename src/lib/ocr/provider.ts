import { noteAiUsage } from "@/lib/ai/usage-log";
import { SLIP_JSON_SCHEMA } from "./slip-schema";

export interface SlipImage {
  bytes: Uint8Array;
  mimeType: string;
}

/** Reads a slip image and returns the (untrusted) structured fields. Swap providers freely. */
export interface SlipOcrProvider {
  readonly name: string;
  /** `items: true` also asks for the product lines of a receipt (costs more output, Elite only). */
  extract(image: SlipImage, options?: ExtractOptions): Promise<unknown>;
}

export interface ExtractOptions {
  items?: boolean;
}

export type AiProviderName = "gemini" | "anthropic" | "openai";

export interface AiConfig {
  provider: AiProviderName;
  model?: string;
  apiKey: string;
}

export const DEFAULT_MODELS: Record<AiProviderName, string> = {
  // gemini-2.5-flash is "legacy, limited access" for new accounts; 3.5 flash-lite is stable
  // and has a free tier. Override with AI_MODEL.
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4o-mini",
};

const TIMEOUT_MS = 30_000;

const BASE_RULES = [
  "- is_slip=false if the image is not a payment slip or receipt (then other fields may be null).",
  "- amount is the money actually paid, in THB, as a number (no currency symbol).",
  "- paid_at must be ISO 8601 with +07:00 and a Gregorian year. Thai slips often use the Buddhist",
  "  era (2569 = 2026) and Thai month names; convert them. Use null if the date is unreadable.",
  "- payee_* describe the RECIPIENT (the person or shop that received the money), not the sender.",
  "- Never invent values. Use null for anything you cannot read.",
];

const ITEMS_RULES = [
  "- For a shop receipt also fill items: one entry per product line in printed order, with name as",
  "  printed and amount = the price of that line in THB (quantity already multiplied, discounts on",
  "  the line applied). Skip subtotal, VAT, service charge, change and payment lines. Use null for",
  "  items on anything that is not a shop receipt.",
];

/** The JSON Schema without the product lines, for readers that were not asked for them. */
const { items: _items, ...PLAIN_PROPERTIES } = SLIP_JSON_SCHEMA.properties;
void _items;
export const PLAIN_SLIP_JSON_SCHEMA = { ...SLIP_JSON_SCHEMA, properties: PLAIN_PROPERTIES };

/**
 * The reading prompt. Product lines (and the schema field for them) are only included when
 * `withItems` is set, so readers that were not asked for them are not tempted to spend output on it.
 */
export function slipPrompt(withItems = false): string {
  return [
    "You read Thai bank transfer slips, PromptPay/e-wallet slips and shop receipts.",
    "Return ONLY a JSON object that matches this JSON Schema, with no extra text:",
    JSON.stringify(withItems ? SLIP_JSON_SCHEMA : PLAIN_SLIP_JSON_SCHEMA),
    "Rules:",
    ...BASE_RULES,
    ...(withItems ? ITEMS_RULES : []),
  ].join("\n");
}

export const SLIP_PROMPT = slipPrompt(false);

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Pull the first JSON object out of a model reply (tolerates ``` fences and chatter). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

/** POST JSON and return the parsed body. Errors carry the status only (never the payload). */
export async function postJson(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: typeof fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${label} request failed: ${res.status}`);
  const data: unknown = await res.json();
  await noteAiUsage(label, url, body, data);
  return data;
}

function geminiProvider(cfg: AiConfig, fetchImpl: typeof fetch): SlipOcrProvider {
  const model = cfg.model ?? DEFAULT_MODELS.gemini;
  return {
    name: `gemini:${model}`,
    async extract(image, options) {
      const data = (await postJson(
        "gemini",
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": cfg.apiKey },
        {
          contents: [
            {
              parts: [
                { text: slipPrompt(options?.items) },
                { inline_data: { mime_type: image.mimeType, data: toBase64(image.bytes) } },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        },
        fetchImpl,
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return extractJson(text);
    },
  };
}

function anthropicProvider(cfg: AiConfig, fetchImpl: typeof fetch): SlipOcrProvider {
  const model = cfg.model ?? DEFAULT_MODELS.anthropic;
  return {
    name: `anthropic:${model}`,
    async extract(image, options) {
      const data = (await postJson(
        "anthropic",
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: options?.items ? 2048 : 1024,
          temperature: 0,
          // Forcing a tool call gives schema-shaped structured output.
          tools: [
            {
              name: "record_slip",
              description: "Record the fields read from the payment slip",
              input_schema: options?.items ? SLIP_JSON_SCHEMA : PLAIN_SLIP_JSON_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: "record_slip" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: image.mimeType,
                    data: toBase64(image.bytes),
                  },
                },
                { type: "text", text: slipPrompt(options?.items) },
              ],
            },
          ],
        },
        fetchImpl,
      )) as { content?: { type: string; input?: unknown; text?: string }[] };
      const tool = data.content?.find((b) => b.type === "tool_use");
      if (tool?.input) return tool.input;
      const text = data.content?.find((b) => b.type === "text")?.text ?? "";
      return extractJson(text);
    },
  };
}

function openaiProvider(cfg: AiConfig, fetchImpl: typeof fetch): SlipOcrProvider {
  const model = cfg.model ?? DEFAULT_MODELS.openai;
  return {
    name: `openai:${model}`,
    async extract(image, options) {
      const data = (await postJson(
        "openai",
        "https://api.openai.com/v1/chat/completions",
        { Authorization: `Bearer ${cfg.apiKey}` },
        {
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: slipPrompt(options?.items) },
                {
                  type: "image_url",
                  image_url: { url: `data:${image.mimeType};base64,${toBase64(image.bytes)}` },
                },
              ],
            },
          ],
        },
        fetchImpl,
      )) as { choices?: { message?: { content?: string } }[] };
      return extractJson(data.choices?.[0]?.message?.content ?? "");
    },
  };
}

export function createSlipOcrProvider(
  cfg: AiConfig,
  fetchImpl: typeof fetch = fetch,
): SlipOcrProvider {
  switch (cfg.provider) {
    case "gemini":
      return geminiProvider(cfg, fetchImpl);
    case "anthropic":
      return anthropicProvider(cfg, fetchImpl);
    case "openai":
      return openaiProvider(cfg, fetchImpl);
  }
}
