import { describe, expect, it } from "vitest";
import { signExportToken } from "./export-token";
import {
  FILE_LINK_TTL_SECONDS,
  signFileToken,
  signViewToken,
  verifyFileToken,
  verifyViewToken,
} from "./file-token";

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

describe("view token", () => {
  it("round trips, for the person only", async () => {
    const t = await signViewToken("u1", SECRET, NOW);
    await expect(verifyViewToken(t, SECRET, NOW)).resolves.toBe("u1");
  });

  it("expires after an hour", async () => {
    const t = await signViewToken("u1", SECRET, NOW);
    await expect(
      verifyViewToken(t, SECRET, new Date(NOW.getTime() + 3_601_000)),
    ).resolves.toBeNull();
  });

  it("is not a download token, and the other way round", async () => {
    const view = await signViewToken("u1", SECRET, NOW);
    const file = await signFileToken(claims, SECRET, NOW);
    await expect(verifyFileToken(view, SECRET, NOW)).resolves.toBeNull();
    await expect(verifyViewToken(file, SECRET, NOW)).resolves.toBeNull();
  });
});
