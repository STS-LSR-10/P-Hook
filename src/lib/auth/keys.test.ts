import { describe, expect, it } from "vitest";
import { signFileToken, verifyFileToken } from "./file-token";
import { signSession, verifySession } from "./session";

const OLD = "o".repeat(40);
const NEW = "n".repeat(40);
const claims = { userId: "u1", lineUserId: "U1" };

describe("changing the signing secret", () => {
  it("a session signed with the old secret still works while the old one is listed", async () => {
    const token = await signSession(claims, OLD);
    expect(await verifySession(token, [NEW, OLD])).toMatchObject({ userId: "u1" });
  });

  it("is refused once the old secret is removed", async () => {
    const token = await signSession(claims, OLD);
    expect(await verifySession(token, [NEW])).toBeNull();
    expect(await verifySession(token, NEW)).toBeNull();
  });

  it("a token signed with the new secret works with both lists", async () => {
    const token = await signSession(claims, NEW);
    expect(await verifySession(token, NEW)).toMatchObject({ userId: "u1" });
    expect(await verifySession(token, [NEW, OLD])).toMatchObject({ userId: "u1" });
  });

  it("applies to the other links too, and an empty list accepts nothing", async () => {
    const link = await signFileToken({ userId: "u1", fileId: "f1" }, OLD);
    expect(await verifyFileToken(link, [NEW, OLD])).toEqual({ userId: "u1", fileId: "f1" });
    expect(await verifyFileToken(link, [])).toBeNull();
  });
});
