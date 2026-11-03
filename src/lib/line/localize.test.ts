import { afterEach, describe, expect, it } from "vitest";
import { setLocaleSource } from "@/lib/i18n";
import { localizeMessages } from "./localize";

afterEach(() => setLocaleSource(null));

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
