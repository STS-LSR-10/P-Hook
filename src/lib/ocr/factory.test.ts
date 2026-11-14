import { describe, expect, it } from "vitest";
import { buildSlipReader, readerOrder } from "./factory";

describe("readerOrder", () => {
  it("default: the chosen AI, then the other AIs (slips are read by AI only)", () => {
    expect(readerOrder({ AI_PROVIDER: "gemini" })).toEqual(["gemini", "anthropic", "openai"]);
    expect(readerOrder({ AI_PROVIDER: "anthropic" })).toEqual(["anthropic", "gemini", "openai"]);
  });

  it("SLIP_READERS overrides, ignoring unknown names and duplicates", () => {
    expect(
      readerOrder({
        AI_PROVIDER: "gemini",
        SLIP_READERS: " Gemini, nope, easyslip ,openai,gemini",
      }),
    ).toEqual(["gemini", "openai"]);
  });

  it("an empty/invalid override falls back to the default", () => {
    expect(readerOrder({ AI_PROVIDER: "openai", SLIP_READERS: "easyslip" })[0]).toBe("openai");
  });
});

describe("buildSlipReader", () => {
  it("includes only configured readers, in order", () => {
    const built = buildSlipReader({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "g",
      OPENAI_API_KEY: "o",
    });
    expect(built.active).toEqual(["gemini", "openai"]);
    expect(built.skipped).toEqual(["anthropic"]);
    expect(built.reader.name).toBe("gemini:gemini-3.5-flash-lite > openai:gpt-4o-mini");
  });

  it("works with just an AI key", () => {
    const built = buildSlipReader({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "g" });
    expect(built.active).toEqual(["gemini"]);
  });

  it("applies AI_MODEL to the chosen provider only", () => {
    const built = buildSlipReader({
      AI_PROVIDER: "anthropic",
      AI_MODEL: "my-model",
      ANTHROPIC_API_KEY: "a",
      OPENAI_API_KEY: "o",
    });
    expect(built.reader.name).toBe("anthropic:my-model > openai:gpt-4o-mini");
  });

  it("throws when nothing is configured", () => {
    expect(() => buildSlipReader({ AI_PROVIDER: "gemini" })).toThrow(/no slip reader/);
  });
});
