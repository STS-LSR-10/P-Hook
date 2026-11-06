import { describe, expect, it } from "vitest";
import { applyManner, MANNER_LINES } from "./manner-text";
import { PERSONA_IDS } from "./personalize";
import {
  ALREADY_RECORDED_TEXT,
  ERROR_TEXT,
  NOT_FOUND_TEXT,
  NOTHING_TO_DELETE_TEXT,
  SLIP_CANCELLED_TEXT,
  text,
} from "./line/messages";
import { buildConfirmMessage } from "./line/flex";
import { enterLocale, withZoneScope } from "./zone-scope";

const card = (edited: boolean, type: "expense" | "income" = "expense") =>
  buildConfirmMessage({
    style: "full",
    txId: "t1",
    type,
    title: "กาแฟ",
    categoryName: "อาหาร",
    amountSatang: 5000,
    occurredAt: new Date("2026-11-06T05:00:00Z"),
    cycleTotalSatang: null,
    edited,
  } as Parameters<typeof buildConfirmMessage>[0]);

const texts = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) =>
      k === "text" && typeof v === "string" ? [v] : texts(v),
    );
  }
  return [];
};

describe("applyManner", () => {
  it("leaves messages alone for the plain manner", () => {
    const msgs = [card(false), text(ERROR_TEXT)];
    expect(applyManner(msgs, "plain", "เจ้านาย")).toBe(msgs);
  });

  it("every fixed line has a version for each of the five manners and no bare braces", () => {
    for (const [key, byPersona] of Object.entries(MANNER_LINES)) {
      for (const id of PERSONA_IDS) {
        const line = byPersona[id];
        expect(line, `${key} / ${id}`).toBeTruthy();
        expect(line!.replace("{name}", "")).not.toMatch(/[{}]/);
      }
    }
  });

  it.each(PERSONA_IDS)("rewrites the saved card title and subtitle in the %s manner", (id) => {
    const before = texts(card(false));
    const after = texts(applyManner([card(false)], id, null)[0]);
    expect(before).toContain("จดสำเร็จ ✅");
    expect(before).toContain("อย่าลืมตรวจสอบรายการที่จดด้วยนะ");
    expect(after).not.toContain("จดสำเร็จ ✅");
    expect(after).not.toContain("อย่าลืมตรวจสอบรายการที่จดด้วยนะ");
  });

  it("rewrites the edited and income card texts", () => {
    const edited = texts(applyManner([card(true)], "bestie", null)[0]).join("|");
    expect(edited).not.toContain("แก้ไขรายการสำเร็จ ✅");
    expect(edited).not.toContain("อัปเดตรายการเรียบร้อยแล้ว");
    const income = texts(applyManner([card(false, "income")], "bestie", null)[0]).join("|");
    expect(income).not.toContain("เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ");
  });

  it.each([
    ERROR_TEXT,
    NOT_FOUND_TEXT,
    NOTHING_TO_DELETE_TEXT,
    ALREADY_RECORDED_TEXT,
    SLIP_CANCELLED_TEXT,
  ])("rewrites the plain reply %s and keeps it one text message", (line) => {
    for (const id of PERSONA_IDS) {
      const [out] = applyManner([text(line)], id, null);
      expect(out).toMatchObject({ type: "text" });
      expect((out as unknown as { text: string }).text).not.toBe(line);
    }
  });

  it("puts the call name in, and nothing when there is none", () => {
    const withN = applyManner([text(ERROR_TEXT)], "warm", "เจ้านาย")[0] as unknown as {
      text: string;
    };
    const without = applyManner([text(ERROR_TEXT)], "warm", null)[0] as unknown as { text: string };
    expect(withN.text).toContain(" เจ้านาย");
    expect(without.text).not.toContain("เจ้านาย");
    expect(without.text).not.toContain("{name}");
  });

  it("changes the lead of a delete notice and keeps its figures", () => {
    const out = applyManner([text("ลบแล้ว: กาแฟ ฿50.00")], "spicy", null)[0] as unknown as {
      text: string;
    };
    expect(out.text.startsWith("ลบแล้ว:")).toBe(false);
    expect(out.text).toContain("กาแฟ ฿50.00");
  });

  it("changes the empty line of a summary and keeps its heading", () => {
    const out = applyManner(
      [text("สรุปวันนี้ (6 พ.ย.)\nยังไม่มีรายการเลย")],
      "bestie",
      null,
    )[0] as unknown as { text: string };
    expect(out.text.startsWith("สรุปวันนี้ (6 พ.ย.)\n")).toBe(true);
    expect(out.text.endsWith("ยังไม่มีรายการเลย")).toBe(false);
  });

  it("does not touch other text or the shape of a card", () => {
    const msg = text("กาแฟ 50 จดแล้ว");
    expect(applyManner([msg], "spicy", null)[0]).toEqual(msg);
    const c = card(false);
    const out = applyManner([c], "spicy", null)[0] as typeof c;
    expect(Object.keys(out)).toEqual(Object.keys(c));
  });

  it("leaves English users alone (their texts are translated later)", () => {
    withZoneScope(() => {
      enterLocale("en");
      const msgs = [card(false), text(ERROR_TEXT)];
      expect(applyManner(msgs, "bestie", null)).toBe(msgs);
    });
  });

  it("does not rewrite an AI answer or an entry title that merely looks like a notice", () => {
    const answer = text("หนี้ทั้งหมด\nยังไม่มีรายการเลย");
    expect(applyManner([answer], "spicy", null)[0]).toEqual(answer);
    const titled = { type: "flex", altText: "x", contents: { type: "text", text: "ลบแล้ว: กาแฟ" } };
    expect(applyManner([titled], "spicy", null)[0]).toEqual(titled);
  });

  it("keeps the text of a message action exact, because the bot reads it as a command", () => {
    const quick = {
      type: "text",
      text: "x",
      quickReply: { items: [{ action: { type: "message", label: "ok", text: "จดสำเร็จ ✅" } }] },
    };
    const out = applyManner([quick], "spicy", null)[0] as unknown as typeof quick;
    expect(out.quickReply.items[0]?.action.text).toBe("จดสำเร็จ ✅");
  });

  it.each(PERSONA_IDS)(
    "says the title of a many-entries card in the %s manner, keeping the count",
    (id) => {
      const card = {
        type: "flex",
        altText: "x",
        contents: { type: "text", text: "จดสำเร็จ 4 รายการ ✅" },
      };
      const out = applyManner([card], id, "เจ้านาย")[0] as unknown as {
        contents: { text: string };
      };
      expect(out.contents.text).not.toBe("จดสำเร็จ 4 รายการ ✅");
      expect(out.contents.text).toContain("4");
      expect(out.contents.text).not.toMatch(/[{}]/);
    },
  );
});
