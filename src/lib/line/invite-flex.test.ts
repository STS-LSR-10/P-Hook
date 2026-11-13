import { describe, expect, it } from "vitest";
import { buildInviteFlex } from "./invite-flex";

const input = {
  code: "238BB11E",
  addFriendLink: "https://line.me/R/ti/p/%40p-hook",
  imageUrl: "https://app.example.com/phook-invite-card.jpg",
};

const find = (node: unknown, pred: (o: Record<string, unknown>) => boolean): unknown[] => {
  if (Array.isArray(node)) return node.flatMap((n) => find(n, pred));
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    return [...(pred(o) ? [o] : []), ...Object.values(o).flatMap((v) => find(v, pred))];
  }
  return [];
};

describe("buildInviteFlex", () => {
  const msg = buildInviteFlex(input);

  it("is a Flex bubble with the owl picture on top", () => {
    expect(msg.type).toBe("flex");
    const hero = (msg.contents as { hero: Record<string, unknown> }).hero;
    expect(hero).toMatchObject({ type: "image", url: input.imageUrl });
  });

  it("carries the code and has the add-friend link on the card and on the button", () => {
    expect(JSON.stringify(msg)).toContain("238BB11E");
    const uris = find(msg.contents, (o) => o.type === "uri").map((o) => (o as { uri: string }).uri);
    expect(uris.length).toBeGreaterThanOrEqual(2);
    expect(new Set(uris)).toEqual(new Set([input.addFriendLink]));
  });

  it("has an alt text that works on its own (notifications, old clients)", () => {
    expect(msg.altText).toContain("238BB11E");
    expect(msg.altText).toContain(input.addFriendLink);
  });
});
