import { describe, expect, it } from "vitest";
import { MEMORY_TURNS, historyText, memorable, replyText } from "./chat-memory";

describe("replyText", () => {
  it("keeps what the bot said: text, or a card's alt text, cut short", () => {
    expect(
      replyText([
        { type: "text", text: "เปิดแผนที่ได้เลย" },
        { type: "flex", altText: "ตั้งเตือนแล้ว: กินยา" },
      ]),
    ).toBe("เปิดแผนที่ได้เลย / ตั้งเตือนแล้ว: กินยา");
    expect(replyText([{ type: "text", text: "ก".repeat(900) }]).length).toBeLessThanOrEqual(300);
    expect(replyText([])).toBe("");
  });
});

describe("historyText", () => {
  it("lists the turns oldest first, with who said each", () => {
    expect(
      historyText([
        { role: "user", body: "เมกาบางนา รถติดไหม" },
        { role: "bot", body: "น่าจะติดนะ" },
      ]),
    ).toBe("ผู้ใช้: เมกาบางนา รถติดไหม\nพี่ฮูก: น่าจะติดนะ");
    expect(historyText([])).toBe("");
  });
  it("remembers a few turns only", () => {
    expect(MEMORY_TURNS).toBe(6);
  });
});

describe("memorable: what may be kept and sent on to the AI later", () => {
  it("keeps nothing of a secret-looking message, nor its answer", () => {
    expect(
      memorable([
        { role: "user", body: "รหัส ATM 1234" },
        { role: "bot", body: "จดโน้ตแล้ว: รหัส ATM 1234" },
      ]),
    ).toEqual([]);
  });
  it("hides a long number such as a bank account", () => {
    expect(
      memorable([
        { role: "user", body: "โอนเข้าบัญชี 1234567890 ให้แม่" },
        { role: "bot", body: "ได้เลย" },
      ]),
    ).toEqual([
      { role: "user", body: "โอนเข้าบัญชี ••• ให้แม่" },
      { role: "bot", body: "ได้เลย" },
    ]);
  });
  it("history never shows a secret kept before", () => {
    expect(historyText([{ role: "user", body: "รหัส ATM 1234" }])).toBe("");
  });
});
