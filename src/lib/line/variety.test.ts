import { afterEach, describe, expect, it } from "vitest";
import { enterLocale, withZoneScope } from "@/lib/zone-scope";
import { MANNER_LINES, MANNER_MORE, applyManner } from "@/lib/manner-text";
import { applyVariety, pickOne, setVarietyRandom, varyText } from "./variety";
import { VARIANTS } from "./variants-data";

afterEach(() => {
  setVarietyRandom(null);
});

/** The parts of a sentence that carry its meaning, which no other wording may change. */
const marks = (s: string) => ({
  holes: [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
  quoted: [...s.matchAll(/"[^"]*"/g)].map((m) => m[0]).sort(),
  numbers: [...s.replace(/\{\d+\}/g, "").matchAll(/\d+(?:[.,:/]\d+)*/g)].map((m) => m[0]).sort(),
  lines: s.split("\n").length,
  symbols: [...s.matchAll(/[✅🎉🦉🧳💑⚠️⏰📎📆@#+%฿]|Starter|Pro|Elite|LINE|AI|PDF/gu)]
    .map((m) => m[0])
    .sort(),
});

describe("every other wording says the same thing", () => {
  for (const [key, others] of Object.entries(VARIANTS)) {
    it(key.slice(0, 40), () => {
      expect(others.length).toBeGreaterThanOrEqual(1);
      expect(new Set([key, ...others]).size).toBe(others.length + 1); // no repeats, none the same as the original
      const base = marks(key);
      for (const v of others) {
        expect(v.trim()).toBe(v);
        const m = marks(v);
        expect(m.holes).toEqual(base.holes);
        expect(m.quoted).toEqual(base.quoted);
        expect(m.numbers).toEqual(base.numbers);
        expect(m.lines).toBe(base.lines);
        expect(m.symbols).toEqual(base.symbols);
      }
    });
  }
});

describe("the manner lines have more wordings too, with the same marks", () => {
  for (const [key, more] of Object.entries(MANNER_MORE)) {
    for (const [persona, list] of Object.entries(more)) {
      it(`${key.slice(0, 24)} · ${persona}`, () => {
        const first = (MANNER_LINES[key] as Record<string, string>)[persona] as string;
        const base = marks(first);
        for (const v of list ?? []) {
          expect(v).not.toBe(first);
          expect(marks(v).holes).toEqual(base.holes); // {name}
          expect(marks(v).symbols.filter((x) => x === "✅")).toEqual(
            base.symbols.filter((x) => x === "✅"),
          );
        }
      });
    }
  }
});

describe("varyText", () => {
  it("in tests the dice give the original, so every other test sees the usual words", () => {
    expect(varyText("ลบให้แล้ว")).toBe("ลบให้แล้ว"); // not a line of the bot: untouched
    expect(varyText("ยังไม่มีรายการให้ลบนะ")).toBe("ยังไม่มีรายการให้ลบนะ");
  });

  it("picks among the original and the others by the dice", () => {
    const original = "ยังไม่มีรายการให้ลบนะ";
    const others = VARIANTS[original] as string[];
    setVarietyRandom(() => 0);
    expect(varyText(original)).toBe(original);
    setVarietyRandom(() => 0.4);
    expect(varyText(original)).toBe(others[0]);
    setVarietyRandom(() => 0.99);
    expect(varyText(original)).toBe(others[others.length - 1]);
  });

  it("puts the same numbers and names into the other wording", () => {
    const template = "ได้โบนัสชวนเพื่อน +{0} ฮูกคอยน์แล้ว! ตรวจดูได้ที่หน้าตั้งค่า";
    const said = "ได้โบนัสชวนเพื่อน +50 ฮูกคอยน์แล้ว! ตรวจดูได้ที่หน้าตั้งค่า";
    setVarietyRandom(() => 0.99);
    const out = varyText(said);
    expect(out).not.toBe(said);
    expect(out).toContain("+50");
    expect(out).not.toContain("{0}");
    expect(VARIANTS[template]).toBeDefined();
  });

  it("every template matches its own filled-in text and gives back the original at dice 0", () => {
    setVarietyRandom(() => 0);
    for (const key of Object.keys(VARIANTS)) {
      const filled = key.replace(/\{(\d+)\}/g, (_m, n) => `<${n}>`);
      expect(varyText(filled)).toBe(filled);
    }
  });

  it("a template with several holes keeps each in its place", () => {
    const key = Object.keys(VARIANTS).find(
      (k) =>
        k.startsWith("เดือนนี้อ่านสลิปครบ {0} ใบแล้ว (แผน {1}) พิมพ์จดเองได้ไม่จำกัด") &&
        k.endsWith("และอ่านสลิปได้ใหม่ต้นเดือนหน้านะ"),
    )!;
    expect(key).toBeDefined();
    const said = key.replace("{0}", "60").replace("{1}", "Starter");
    setVarietyRandom(() => 0.99);
    const out = varyText(said);
    expect(out).toContain("60");
    expect(out).toContain("Starter");
    expect(out).toContain('"ค่าไฟ 1200"');
    expect(out).not.toBe(said);
  });
});

describe("applyVariety", () => {
  const text = (t: string) => ({ type: "text", text: t });

  it("changes the words of a plain reply and leaves everything else alone", () => {
    setVarietyRandom(() => 0.99);
    const button = { type: "message", label: "ลบ", text: "ยังไม่มีรายการให้ลบนะ" };
    const [a, b, c] = applyVariety([
      text("ยังไม่มีรายการให้ลบนะ"),
      text("พิมพ์อะไรก็ได้ที่ไม่ใช่ข้อความของบอท"),
      {
        type: "flex",
        altText: "x",
        contents: {
          type: "bubble",
          body: [{ type: "text", text: "ยังไม่มีรายการให้ลบนะ" }, { action: button }],
        },
      },
    ]);
    expect((a as { text: string }).text).not.toBe("ยังไม่มีรายการให้ลบนะ");
    expect((b as { text: string }).text).toBe("พิมพ์อะไรก็ได้ที่ไม่ใช่ข้อความของบอท");
    // the words in a card change; what a button sends does not (the bot reads it as a command)
    const card = c as unknown as {
      contents: { body: { text?: string; action?: typeof button }[] };
    };
    expect(card.contents.body[0]?.text).not.toBe("ยังไม่มีรายการให้ลบนะ");
    expect(card.contents.body[1]?.action).toEqual(button);
  });

  it("an English chat is left as it is", () => {
    withZoneScope(() => {
      enterLocale("en");
      setVarietyRandom(() => 0.99);
      const out = applyVariety([text("ยังไม่มีรายการให้ลบนะ")]);
      expect((out[0] as { text: string }).text).toBe("ยังไม่มีรายการให้ลบนะ");
    });
  });

  it("asking the same thing twice can be answered in two ways", () => {
    const answers = new Set<string>();
    for (const roll of [0, 0.5, 0.99]) {
      setVarietyRandom(() => roll);
      answers.add((applyVariety([text("ยังไม่มีรายการให้ลบนะ")])[0] as { text: string }).text);
    }
    expect(answers.size).toBeGreaterThanOrEqual(2);
  });
});

describe("a manner picks among its own wordings", () => {
  it("warm: the first wording at dice 0, another at dice 0.99, the same meaning and mark", () => {
    const msg = [{ type: "text", text: "ยังไม่มีรายการให้ลบนะ" }];
    setVarietyRandom(() => 0);
    const first = (applyManner(msg, "warm", "เอ")[0] as { text: string }).text;
    setVarietyRandom(() => 0.99);
    const last = (applyManner(msg, "warm", "เอ")[0] as { text: string }).text;
    expect(first).not.toBe(last);
    expect(first).toContain("ลบ");
    expect(last).toContain("ลบ");
  });
});

describe("pickOne", () => {
  it("is even, and never past the end", () => {
    setVarietyRandom(() => 0.999999);
    expect(pickOne(["a", "b", "c"])).toBe("c");
    setVarietyRandom(() => 0);
    expect(pickOne(["a", "b", "c"])).toBe("a");
  });
});
