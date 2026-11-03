import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadTimePhrases, setLocaleSource } from "@/lib/i18n";
import { localizeMessages } from "./localize";

afterEach(() => setLocaleSource(null));
// the app's own fixed phrases (in the bot they are made when the code loads)
beforeAll(() => {
  for (const p of [
    "บันทึกแล้ว",
    "ยกเลิก",
    "บันทึก",
    "ลบแล้ว",
    "บันทึกไม่สำเร็จ ลองใหม่อีกครั้งนะ",
  ]) {
    loadTimePhrases.add(p);
  }
});

const card = {
  type: "flex",
  altText: "บันทึกแล้ว",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      contents: [
        { type: "text", text: "ยกเลิก" },
        { type: "text", contents: [{ type: "span", text: "บันทึก" }] },
        {
          type: "button",
          action: { type: "postback", label: "ลบ", data: "a=del&id=1", displayText: "ลบ" },
        },
        { type: "button", action: { type: "message", label: "ยกเลิก", text: "ยกเลิก" } },
        { type: "button", action: { type: "uri", label: "ดูทั้งหมด", uri: "https://x/ลบ" } },
      ],
    },
  },
  quickReply: {
    items: [{ type: "action", action: { type: "message", label: "บันทึก", text: "บันทึก" } }],
  },
};

describe("what the bot sends, in the person's language", () => {
  it("is untouched in Thai", () => {
    expect(localizeMessages([card])).toEqual([card]);
  });

  it("in English, words the dictionary knows are English; what the bot reads back stays Thai", () => {
    setLocaleSource(() => "en");
    const [out] = localizeMessages([card]) as [typeof card];
    expect(out.altText).toBe("Saved");
    const parts = out.contents.body.contents as Record<string, unknown>[];
    expect(parts[0]).toEqual({ type: "text", text: "Cancel" });
    expect(parts[1]).toEqual({ type: "text", contents: [{ type: "span", text: "Save" }] });
    // a postback: its label and the words shown as the person's are English, its data is not
    expect(parts[2]).toEqual({
      type: "button",
      action: { type: "postback", label: "Delete", data: "a=del&id=1", displayText: "Delete" },
    });
    // a message button sends its text to the bot as a command: that stays Thai
    expect(parts[3]).toEqual({
      type: "button",
      action: { type: "message", label: "Cancel", text: "ยกเลิก" },
    });
    expect((parts[4] as { action: { uri: string } }).action.uri).toBe("https://x/ลบ");
    expect(out.quickReply.items[0]?.action).toEqual({
      type: "message",
      label: "Save",
      text: "บันทึก",
    });
  });

  it("a plain text message is translated when known, and kept when not", () => {
    setLocaleSource(() => "en");
    expect(localizeMessages([{ type: "text", text: "ลบแล้ว" }])).toEqual([
      { type: "text", text: "Deleted" },
    ]);
    expect(localizeMessages([{ type: "text", text: "ข้าวมันไก่ 45" }])).toEqual([
      { type: "text", text: "ข้าวมันไก่ 45" },
    ]);
  });
});

describe("the AI answers in the person's language", () => {
  it("is told to answer in English, but not in a group", async () => {
    const { owlUserPrompt } = await import("@/lib/ai/owl");
    setLocaleSource(() => "en");
    expect(owlUserPrompt({ question: "ใช้ไปเท่าไร", data: null } as never)).toContain(
      "Answer in English.",
    );
    expect(
      owlUserPrompt({ question: "ใช้ไปเท่าไร", data: null, group: true } as never),
    ).not.toContain("Answer in English.");
    setLocaleSource(null);
    expect(owlUserPrompt({ question: "x", data: null } as never)).not.toContain("English");
  });
});

describe("sending in English stays within LINE's rules and leaves the person's own words", () => {
  it("a quick-reply label fits LINE's 20 characters, any other label its 40", () => {
    setLocaleSource(() => "en");
    const [out] = localizeMessages([
      {
        type: "text",
        text: "x",
        quickReply: {
          items: [
            { type: "action", action: { type: "message", label: "📷 จดแบบพิเศษ", text: "a" } },
          ],
        },
      },
    ]) as unknown as [{ quickReply: { items: { action: { label: string } }[] } }];
    expect([...(out.quickReply.items[0]?.action.label ?? "")].length).toBeLessThanOrEqual(20);
  });

  it("text that is not one of the app's fixed phrases is left as written: the person's own words", () => {
    setLocaleSource(() => "en");
    loadTimePhrases.add("เงินสด"); // the wallet kind's name is also a fixed phrase, but a wallet's name too
    expect(localizeMessages([{ type: "text", text: "เงินสด" }])).toEqual([
      { type: "text", text: "เงินสด" },
    ]);
    // a sentence is still the app's own words
    expect(localizeMessages([{ type: "text", text: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้งนะ" }])).toEqual(
      [{ type: "text", text: "Couldn't save. Please try again" }],
    );
  });

  it("every help chip still fits in English", async () => {
    const { HELP_TOPICS } = await import("./help-flex");
    const { EN } = await import("@/lib/i18n-en");
    for (const topic of HELP_TOPICS) {
      expect([...(EN[topic.chip] ?? topic.chip)].length, topic.chip).toBeLessThanOrEqual(20);
    }
  });
});
