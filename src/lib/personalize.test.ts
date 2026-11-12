import { describe, expect, it } from "vitest";
import { dailyBudgetAlert } from "./daily-budget";
import {
  BASE_PALETTE,
  PERSONA_IDS,
  currentPersona,
  isPersonaId,
  THEMES,
  THEME_IDS,
  applyTheme,
  budgetAlertLine,
  cleanCallName,
  dailyOverLines,
  dailyStillOverLine,
  effectivePrefs,
  withName,
} from "./personalize";

const card = {
  type: "flex",
  contents: {
    type: "bubble",
    header: {
      type: "box",
      backgroundColor: "#CCFBF1",
      contents: [
        { type: "text", text: "หัว", color: "#0B5D4F" },
        { type: "text", text: "รอง", color: "#3F6B63" },
        { type: "text", text: "ลิงก์", color: "#0F766E" },
      ],
    },
    body: {
      type: "box",
      contents: [
        { type: "text", text: "tip", color: "#0B5D4F" },
        { type: "text", text: "-฿5", color: "#E11D48" },
        { type: "text", text: "+฿5", color: "#059669" },
        { type: "button", color: "#0F766E" },
      ],
    },
  },
};

describe("applyTheme", () => {
  it("leaves the default theme untouched (same object)", () => {
    const list = [card];
    expect(applyTheme(list, "mint")).toBe(list);
  });

  it("recolours the header and the buttons but never income / expense colours", () => {
    const text = JSON.stringify(applyTheme([card], "ocean"));
    expect(text).toContain(THEMES.ocean.palette.soft);
    expect(text).toContain(THEMES.ocean.palette.primary);
    expect(text).not.toContain(BASE_PALETTE.soft);
    expect(text).not.toContain(BASE_PALETTE.primary);
    expect(text).toContain("#E11D48");
    expect(text).toContain("#059669");
  });

  it("does not change the input", () => {
    const before = JSON.stringify(card);
    applyTheme([card], "rose");
    expect(JSON.stringify(card)).toBe(before);
  });

  it("keeps the dark theme readable: light text on the band, dark text on white", () => {
    const out = applyTheme([card], "night")[0] as typeof card;
    const night = THEMES.night.palette;
    expect(out.contents.header.backgroundColor).toBe(night.soft);
    expect(out.contents.header.contents[0]?.color).toBe(night.headTitle);
    expect(out.contents.header.contents[2]?.color).toBe(night.headAccent);
    expect(out.contents.body.contents[0]?.color).toBe(night.bodyTitle);
    expect(out.contents.body.contents[3]?.color).toBe(night.primary);
  });

  it("every theme has all colours", () => {
    for (const id of THEME_IDS) {
      for (const value of Object.values(THEMES[id].palette))
        expect(value).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("persona lines", () => {
  it("plain adds nothing and keeps the original budget text", () => {
    expect(budgetAlertLine("plain", { level: 80, scope: "รวม", figures: "x" })).toBeNull();
    expect(dailyOverLines("plain")).toBeUndefined();
  });

  it("every manner words both budget levels with the figures", () => {
    for (const persona of PERSONA_IDS) {
      for (const level of [80, 100] as const) {
        const line = budgetAlertLine(
          persona,
          { level, scope: "หมวดอาหาร", figures: "฿90 จาก ฿100" },
          0,
        );
        expect(line).toContain("฿90 จาก ฿100");
      }
    }
  });

  it("the daily scold follows the manner and always names the excess", () => {
    for (const persona of PERSONA_IDS) {
      for (const pick of [0, 0.5, 0.99]) {
        const text = dailyBudgetAlert({
          beforeSatang: 40_000,
          afterSatang: 62_000,
          limitSatang: 50_000,
          pick,
          persona,
        });
        expect(text).toContain("฿120");
      }
      const again = dailyBudgetAlert({
        beforeSatang: 62_000,
        afterSatang: 70_000,
        limitSatang: 50_000,
        persona,
      });
      expect(again).toContain("฿200");
    }
  });
});

describe("effectivePrefs", () => {
  it("free and unknown values read as the defaults; paid plans use the saved choice", () => {
    expect(
      effectivePrefs("free", { card_theme: "ocean", bot_persona: "spicy", call_name: "บาส" }),
    ).toEqual({ theme: "mint", persona: "plain", name: null });
    expect(
      effectivePrefs("plus", { card_theme: "ocean", bot_persona: "spicy", call_name: "บาส" }),
    ).toEqual({ theme: "ocean", persona: "spicy", name: "บาส" });
    expect(effectivePrefs("ultimate", { card_theme: "nope", bot_persona: 3 })).toEqual({
      theme: "mint",
      persona: "plain",
      name: null,
    });
  });
});

describe("the name the bot calls someone", () => {
  it("goes into a line where it belongs, and leaves no gap without one", () => {
    expect(withName("จัดไป{name}!", "คุณบาส")).toBe("จัดไป คุณบาส!");
    expect(withName("จัดไป{name}!", null)).toBe("จัดไป!");
    expect(withName("จัดไป{name}!", "")).toBe("จัดไป!");
  });

  it("no line ever shows a bare {name}", () => {
    for (const persona of PERSONA_IDS) {
      for (const pick of [0, 0.3, 0.6, 0.99]) {
        for (const name of [null, "บาส"]) {
          const lines = [
            budgetAlertLine(persona, { level: 80, scope: "รวม", figures: "x" }, pick, name),
            budgetAlertLine(persona, { level: 100, scope: "รวม", figures: "x" }, pick, name),
            dailyStillOverLine(persona, "5", name),
            dailyOverLines(persona)?.[0]?.({ spent: "1", limit: "1", over: "1", name }),
          ];
          for (const line of lines) expect(line).not.toContain("{");
        }
      }
    }
  });

  it("is used in a line when one is given", () => {
    expect(
      budgetAlertLine("bestie", { level: 80, scope: "รวม", figures: "x" }, 0, "บาส"),
    ).toContain("บาส");
    expect(dailyStillOverLine("tea", "5", "บาส")).toContain("บาส");
  });

  it("is cleaned: one line, at most 20 letters, nothing that looks like a placeholder or markup", () => {
    expect(cleanCallName("  คุณบาส ")).toBe("คุณบาส");
    expect(cleanCallName("a\nb")).toBe("a b");
    expect(cleanCallName("")).toBeNull();
    expect(cleanCallName("   ")).toBeNull();
    expect(cleanCallName("ก".repeat(21))).toBeNull();
    expect(cleanCallName("ก".repeat(20))).toBe("ก".repeat(20));
    expect(cleanCallName("{name}<b>")).toBe("name b");
    expect(cleanCallName(42)).toBeNull();
  });
});

describe("the four manners", () => {
  it("are warm, bestie, spicy and tea: the night owl is gone", () => {
    expect([...PERSONA_IDS]).toEqual(["warm", "bestie", "spicy", "tea"]);
    expect(isPersonaId("night")).toBe(false);
  });

  it("a row that still says night (before the migration) is read as bestie, the manner it became", () => {
    expect(
      effectivePrefs("ultimate", { card_theme: "mint", bot_persona: "night", call_name: null })
        .persona,
    ).toBe("bestie");
    expect(currentPersona("night")).toBe("bestie");
    expect(currentPersona("warm")).toBe("warm");
    expect(currentPersona("toString")).toBe("toString"); // never a function from the object's own methods
  });

  it("every manner keeps the places its lines fill in", () => {
    for (const persona of PERSONA_IDS) {
      for (const level of [80, 100] as const) {
        const line = budgetAlertLine(
          persona,
          { level, scope: "อาหาร", figures: "฿500/฿1,000" },
          0,
          "เอ",
        );
        expect(line).toContain("อาหาร");
        expect(line).toContain("฿500/฿1,000");
        expect(line).not.toMatch(/\{(scope|figures|name)\}/);
      }
    }
  });
});
