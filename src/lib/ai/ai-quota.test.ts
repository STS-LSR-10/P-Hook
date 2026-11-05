import { describe, expect, it } from "vitest";
import { aiUnits, countWords, AI_WORDS_PER_USE } from "./ai-quota";

describe("how many uses of the AI a message takes", () => {
  it("counts Thai words, which have no spaces between them", () => {
    expect(countWords("เดือนนี้ใช้เงินไปเท่าไหร่")).toBeGreaterThanOrEqual(5);
    expect(countWords("กาแฟ 50")).toBe(2);
    expect(countWords("   ")).toBe(0);
  });

  it("up to 20 words is one use; each 20 more is one more", () => {
    expect(AI_WORDS_PER_USE).toBe(20);
    const words = (n: number) => Array.from({ length: n }, () => "กาแฟ").join(" ");
    expect(aiUnits("กาแฟ 50")).toBe(1);
    expect(aiUnits(words(20))).toBe(1);
    expect(aiUnits(words(21))).toBe(2);
    expect(aiUnits(words(45))).toBe(3);
    expect(aiUnits("")).toBe(1);
  });
});
