import { postJson, type AiProviderName } from "@/lib/ocr/provider";

export interface JsonCallConfig {
  provider: AiProviderName;
  apiKey: string;
  model: string;
}

/** Pull the first JSON object out of a model reply (tolerates ``` fences and chatter). */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Send one prompt to the chosen provider and get a JSON object back. The reply is untrusted: the
 * caller validates it. Errors carry the provider and status only, never the prompt or the reply.
 */
export async function callJson(
  cfg: JsonCallConfig,
  prompt: string,
  schema: Record<string, unknown>,
  toolName: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs?: number,
): Promise<unknown> {
  switch (cfg.provider) {
    case "gemini": {
      const data = (await postJson(
        "gemini-text",
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
        { "x-goog-api-key": cfg.apiKey },
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
        },
        fetchImpl,
        timeoutMs,
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return parseJsonObject(
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
      );
    }
    case "anthropic": {
      const data = (await postJson(
        "anthropic-text",
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        {
          model: cfg.model,
          max_tokens: 1024,
          temperature: 0.2,
          tools: [{ name: toolName, description: "Record the result", input_schema: schema }],
          tool_choice: { type: "tool", name: toolName },
          messages: [{ role: "user", content: prompt }],
        },
        fetchImpl,
        timeoutMs,
      )) as { content?: { type: string; input?: unknown; text?: string }[] };
      const tool = data.content?.find((b) => b.type === "tool_use");
      if (tool?.input) return tool.input;
      return parseJsonObject(data.content?.find((b) => b.type === "text")?.text ?? "");
    }
    case "openai": {
      const data = (await postJson(
        "openai-text",
        "https://api.openai.com/v1/chat/completions",
        { Authorization: `Bearer ${cfg.apiKey}` },
        {
          model: cfg.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        },
        fetchImpl,
        timeoutMs,
      )) as { choices?: { message?: { content?: string } }[] };
      return parseJsonObject(data.choices?.[0]?.message?.content ?? "");
    }
  }
}
