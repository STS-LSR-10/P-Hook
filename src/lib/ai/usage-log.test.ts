import { afterEach, describe, expect, it } from "vitest";
import { withLater } from "@/lib/later";
import { postJson } from "@/lib/ocr/provider";
import {
  featureOf,
  noteAiUsage,
  parseAiUsage,
  setAiUsageRecorder,
  type AiUsageEntry,
} from "./usage-log";

afterEach(() => setAiUsageRecorder(null));

const GEMINI =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";

describe("featureOf", () => {
  it("drops the provider from the label", () => {
    expect(featureOf("gemini-owl")).toBe("owl");
    expect(featureOf("anthropic-text")).toBe("text");
    expect(featureOf("openai")).toBe("slip");
  });
});

describe("parseAiUsage", () => {
  it("reads Gemini usage, counting thinking tokens as output", () => {
    expect(
      parseAiUsage(
        "gemini-owl",
        GEMINI,
        {},
        {
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 30,
            thoughtsTokenCount: 10,
          },
        },
      ),
    ).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      feature: "owl",
      inputTokens: 120,
      outputTokens: 40,
    });
  });

  it("reads Anthropic usage including cached input", () => {
    expect(
      parseAiUsage(
        "anthropic-text",
        "https://api.anthropic.com/v1/messages",
        { model: "claude-haiku-5-5" },
        { usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 } },
      ),
    ).toMatchObject({ model: "claude-haiku-5-5", inputTokens: 15, outputTokens: 7 });
  });

  it("reads OpenAI usage and prefers the model the reply names", () => {
    expect(
      parseAiUsage(
        "openai-pdf",
        "https://api.openai.com/v1/chat/completions",
        { model: "gpt-4o-mini" },
        { model: "gpt-4o-mini-2024-07-18", usage: { prompt_tokens: 3, completion_tokens: 4 } },
      ),
    ).toMatchObject({
      model: "gpt-4o-mini-2024-07-18",
      feature: "pdf",
      inputTokens: 3,
      outputTokens: 4,
    });
  });

  it("counts a call with no usage as zero tokens, and ignores hosts that are not AI", () => {
    expect(parseAiUsage("gemini", GEMINI, {}, {})).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(parseAiUsage("x", "https://example.com/a", {}, {})).toBeNull();
    expect(parseAiUsage("x", "not a url", {}, {})).toBeNull();
  });
});

describe("noteAiUsage", () => {
  it("writes nothing in tests unless a recorder is set", async () => {
    await expect(noteAiUsage("gemini", GEMINI, {}, {})).resolves.toBeUndefined();
  });

  it("never throws when the recorder fails", async () => {
    setAiUsageRecorder(async () => {
      throw new Error("db down");
    });
    await expect(noteAiUsage("gemini", GEMINI, {}, {})).resolves.toBeUndefined();
  });

  it("waits until after the event inside withLater", async () => {
    const order: string[] = [];
    setAiUsageRecorder(async () => {
      order.push("saved");
    });
    await withLater(async () => {
      await noteAiUsage("gemini", GEMINI, {}, {});
      order.push("replied");
    });
    expect(order).toEqual(["replied", "saved"]);
  });
});

describe("postJson keeps the usage of every AI call", () => {
  it("records the call and still returns the reply", async () => {
    const saved: AiUsageEntry[] = [];
    setAiUsageRecorder(async (entry) => {
      saved.push(entry);
    });
    const body = {
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 },
      candidates: [],
    };
    const fetchImpl = (async () =>
      ({ ok: true, status: 200, json: async () => body }) as Response) as unknown as typeof fetch;
    expect(await postJson("gemini-owl", GEMINI, {}, {}, fetchImpl)).toEqual(body);
    expect(saved).toEqual([
      {
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        feature: "owl",
        inputTokens: 5,
        outputTokens: 6,
      },
    ]);
  });
});
