import { describe, expect, it } from "vitest";
import { signExportToken, verifyExportToken } from "./auth/export-token";
import { dailyStillOverLine } from "./personalize";
import { runInZone } from "./zone-scope";

describe("the person's currency reaches every message of their own", () => {
  it("a manner's over-budget line uses their sign", () => {
    expect(runInZone(null, () => dailyStillOverLine("bestie", "12"), "USD")).toBe(
      "ยังเกินงบวันนี้อยู่ $12 นะเพื่อน",
    );
  });

  it("an export link carries the currency, so the file is in it", async () => {
    const secret = "x".repeat(32);
    const token = await signExportToken(
      { userId: "u1", format: "csv", filters: {}, cur: "USD" },
      secret,
    );
    expect((await verifyExportToken(token, secret))?.cur).toBe("USD");
  });
});
