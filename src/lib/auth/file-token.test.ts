import { describe, expect, it } from "vitest";
import { signExportToken } from "./export-token";
import { FILE_LINK_TTL_SECONDS, signFileToken, verifyFileToken } from "./file-token";

const SECRET = "a".repeat(32);
const NOW = new Date("2026-11-01T05:00:00Z");
const claims = { userId: "u1", fileId: "f1" };

describe("file token", () => {
  it("round trips", async () => {
    const t = await signFileToken(claims, SECRET, NOW);
    await expect(verifyFileToken(t, SECRET, NOW)).resolves.toEqual(claims);
  });

  it("lasts 10 minutes", () => expect(FILE_LINK_TTL_SECONDS).toBe(600));

  it("expires after 10 minutes", async () => {
    const t = await signFileToken(claims, SECRET, NOW);
    const later = new Date(NOW.getTime() + 601_000);
    await expect(verifyFileToken(t, SECRET, later)).resolves.toBeNull();
  });

  it("refuses an export token", async () => {
    const t = await signExportToken({ userId: "u1", format: "csv", filters: {} }, SECRET, NOW);
    await expect(verifyFileToken(t, SECRET, NOW)).resolves.toBeNull();
  });

  it("refuses another secret", async () => {
    const t = await signFileToken(claims, SECRET, NOW);
    await expect(verifyFileToken(t, "b".repeat(32), NOW)).resolves.toBeNull();
  });

  it("refuses junk", async () => {
    await expect(verifyFileToken("nope", SECRET, NOW)).resolves.toBeNull();
  });
});
