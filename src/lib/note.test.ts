import { describe, expect, it } from "vitest";
import { cleanNoteBody, firstUrl, noteCapacity, noteTitle } from "./note";

describe("cleanNoteBody", () => {
  it("keeps the person's lines, trims the edges and the ends of lines, and caps blank runs", () => {
    expect(cleanNoteBody("  ซื้อนม  \r\n\r\n\r\n\r\nไข่ \t\n")).toBe("ซื้อนม\n\nไข่");
  });
  it("is empty for blanks", () => {
    expect(cleanNoteBody(" \n \t ")).toBe("");
  });
});

describe("noteTitle", () => {
  it("is the first line, cut with … when long", () => {
    expect(noteTitle("รหัสไวไฟ\n1234")).toBe("รหัสไวไฟ");
    expect(noteTitle("ก".repeat(60), 10)).toBe(`${"ก".repeat(9)}…`);
  });
});

describe("noteCapacity", () => {
  it("grows with the plan", () => {
    expect([noteCapacity("free"), noteCapacity("plus"), noteCapacity("ultimate")]).toEqual([
      30, 500, 2000,
    ]);
  });
});

describe("firstUrl", () => {
  it("finds the link in a note", () => {
    expect(firstUrl("ดูที่ https://example.com/a?b=1 นะ")).toBe("https://example.com/a?b=1");
  });
  it("is null with no link", () => expect(firstUrl("ซื้อนม")).toBeNull());
  it("takes only web links", () => {
    expect(firstUrl("javascript:alert(1) ftp://x.y")).toBeNull();
  });
  it("leaves a closing bracket out", () => {
    expect(firstUrl("(https://example.com)")).toBe("https://example.com");
  });
});
