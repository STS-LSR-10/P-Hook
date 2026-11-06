import { describe, expect, it } from "vitest";
import { mentionedMessage, readMentions } from "./group-mention";

describe("readMentions", () => {
  it("keeps who was tagged, by the text that tags them", () => {
    const text = "เตือน 10 โมง บอกให้ @bot1 กับ @แอน ส่งงานด้วย";
    const out = readMentions(text, [
      { index: text.indexOf("@bot1"), length: 5, type: "user", userId: "U1" },
      { index: text.indexOf("@แอน"), length: 4, type: "user", userId: "U2" },
    ]);
    expect(out.text).toBe(text);
    expect(out.mentions).toEqual([
      { label: "@bot1", userId: "U1" },
      { label: "@แอน", userId: "U2" },
    ]);
  });

  it("takes off a tag of พี่ฮูก in front, so the command after it is read", () => {
    const text = "@พี่ฮูก เตือน 10 โมง ประชุม @All";
    const out = readMentions(text, [
      { index: 0, length: 7, type: "user", userId: "Ubot", isSelf: true },
      { index: text.indexOf("@All"), length: 4, type: "all" },
    ]);
    expect(out.text).toBe("เตือน 10 โมง ประชุม @All");
    expect(out.mentions).toEqual([{ label: "@All", all: true }]);
  });

  it("is the plain text when nobody was tagged", () => {
    expect(readMentions("เตือน 9 โมง ประชุม", undefined)).toEqual({
      text: "เตือน 9 โมง ประชุม",
      mentions: [],
      called: false,
    });
  });

  it("says when พี่ฮูก was tagged, wherever the tag stands", () => {
    const at = (text: string, index: number) =>
      readMentions(text, [{ index, length: 7, type: "user", isSelf: true }]);
    expect(at("@พี่ฮูก ช่วยจดหน่อย", 0).called).toBe(true);
    expect(at("ช่วย @พี่ฮูก จดหน่อย", 5).called).toBe(true);
    // a tag in the middle comes out of the text too
    expect(at("ช่วย @พี่ฮูก จดหน่อย", 5).text).toBe("ช่วย จดหน่อย");
  });

  it("takes the tag of พี่ฮูก out of the text wherever it stands", () => {
    const out = readMentions("ค่าข้าว 120 จด @พี่ฮูก", [
      { index: 15, length: 7, type: "user", isSelf: true },
    ]);
    expect(out.text).toBe("ค่าข้าว 120 จด");
    expect(out.called).toBe(true);
  });

  it("ignores a tag that does not fit the text", () => {
    expect(
      readMentions("hi", [{ index: 5, length: 3, type: "user", userId: "U1" }]).mentions,
    ).toEqual([]);
  });
});

describe("mentionedMessage", () => {
  it("tags each person where their name is", () => {
    const msg = mentionedMessage("⏰ เตือนกลุ่ม: บอกให้ @bot1 กับ @All ส่งงาน", [
      { label: "@bot1", userId: "U1" },
      { label: "@All", all: true },
    ]);
    expect(msg).toEqual({
      type: "textV2",
      text: "⏰ เตือนกลุ่ม: บอกให้ {m0} กับ {m1} ส่งงาน",
      substitution: {
        m0: { type: "mention", mentionee: { type: "user", userId: "U1" } },
        m1: { type: "mention", mentionee: { type: "all" } },
      },
    });
  });

  it("keeps braces typed by people from being read as tags", () => {
    const msg = mentionedMessage("{x} @bot1", [{ label: "@bot1", userId: "U1" }]);
    expect(msg).toMatchObject({ type: "textV2", text: "｛x｝ {m0}" });
  });

  it("is a plain text message when no name is found in it", () => {
    expect(mentionedMessage("ประชุม", [{ label: "@bot1", userId: "U1" }])).toEqual({
      type: "text",
      text: "ประชุม",
    });
    expect(mentionedMessage("ประชุม {x}", [])).toEqual({ type: "text", text: "ประชุม {x}" });
  });
});
