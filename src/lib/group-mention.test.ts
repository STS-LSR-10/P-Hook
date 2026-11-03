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
    });
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
