import { describe, expect, it } from "vitest";
import { txEmoji } from "./tx-icon";

const of = (title: string, categoryIcon: string | null = null) => txEmoji({ title, categoryIcon });

describe("txEmoji", () => {
  it("a word of the title gives its icon", () => {
    expect(of("กาแฟ")).toBe("☕");
    expect(of("ข้าวมันไก่")).toBe("🍚");
    expect(of("ก๋วยเตี๋ยวเรือ")).toBe("🍜");
    expect(of("เติมน้ำมัน")).toBe("⛽");
    expect(of("BTS")).toBe("🚇");
    expect(of("Grab ไปสนามบิน")).toBe("🚕");
    expect(of("ค่าไฟ")).toBe("💡");
    expect(of("Netflix")).toBe("🎬");
    expect(of("แมว")).toBe("🐱");
  });

  it("an emoji a person gave their own category comes first", () => {
    expect(of("กาแฟ", "🐶")).toBe("🐶");
  });

  it("the title beats the system category, which is the fallback", () => {
    expect(of("กาแฟ", "utensils")).toBe("☕");
    expect(of("อะไรสักอย่าง", "utensils")).toBe("🍜");
    expect(of("อะไรสักอย่าง", "bus")).toBe("🚌");
    expect(of("เงินเดือนพิเศษ", "wallet")).toBe("💰");
  });

  it("nothing known gives none (the card keeps its coloured dot)", () => {
    expect(of("อะไรสักอย่าง")).toBeNull();
    expect(of("อะไรสักอย่าง", "unknown-icon")).toBeNull();
    expect(of("")).toBeNull();
  });

  it("a short word is not found inside longer ones it only looks like", () => {
    expect(of("ยางรถ")).not.toBe("💊"); // ยา + ง
    expect(of("ยานพาหนะ")).not.toBe("💊");
    expect(of("หมอนใบใหม่")).not.toBe("🩺"); // หมอ + น
    expect(of("หมากฝรั่ง")).not.toBe("🐶");
    expect(of("น้ำมันพืช")).not.toBe("⛽");
    expect(of("ชาร์จมือถือ")).not.toBe("🧋");
  });

  it("the words that do belong still match around prefixes like ค่า", () => {
    expect(of("ค่ายา")).toBe("💊");
    expect(of("ซื้อยาแก้ไอ")).toBe("💊");
    expect(of("ค่าหมอ")).toBe("🩺");
    expect(of("ค่าน้ำ")).toBe("🚰");
  });

  it("a bill and a drink do not mix: ค่าน้ำ is water supply, not a drink", () => {
    expect(of("ค่าน้ำ")).toBe("🚰");
    expect(of("น้ำเปล่า")).toBe("💧");
  });
});

describe("English words only match as whole words", () => {
  it("ais, bts, gym… are not found inside other English words", () => {
    expect(of("praise")).toBeNull();
    expect(of("waist")).toBeNull();
    expect(of("AIS")).toBe("📱");
    expect(of("bts")).toBe("🚇");
    expect(of("Tuber")).toBeNull();
    expect(of("seashell")).toBeNull();
  });
});
