import { describe, expect, it } from "vitest";
import { canSendToChat } from "./liff-chat";

const liff = (inClient: boolean, type?: string) => ({
  isInClient: () => inClient,
  getContext: () => (type ? { type } : null),
});

describe("canSendToChat", () => {
  it("is true in LINE when opened from a chat: 1:1, a group, or a room", () => {
    expect(canSendToChat(liff(true, "utou"))).toBe(true);
    expect(canSendToChat(liff(true, "group"))).toBe(true);
    expect(canSendToChat(liff(true, "room"))).toBe(true);
  });

  it("is false outside LINE, or opened from somewhere that is not a chat", () => {
    expect(canSendToChat(liff(false, "utou"))).toBe(false);
    expect(canSendToChat(liff(true, "external"))).toBe(false);
    expect(canSendToChat(liff(true, "none"))).toBe(false);
    expect(canSendToChat(liff(true))).toBe(false);
  });
});
