import { describe, expect, it } from "vitest";
import { MAX_FEEDBACK_LENGTH, cleanFeedback } from "./feedback";

describe("cleanFeedback", () => {
  it("trims, drops control characters and squeezes long runs of blank lines", () => {
    expect(cleanFeedback("  อยากให้มีโหมดมืด \u0000\u0007 ")).toBe("อยากให้มีโหมดมืด");
    expect(cleanFeedback("ก\n\n\n\n\nข")).toBe("ก\n\nข");
  });
  it("is empty for nothing but spaces", () => {
    expect(cleanFeedback("  \n ")).toBe("");
  });
  it("the limit is a thousand characters", () => {
    expect(MAX_FEEDBACK_LENGTH).toBe(1000);
  });
});
