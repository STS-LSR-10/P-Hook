import { describe, expect, it } from "vitest";
import { categorizeByRules, matchLeadingCategory, type CategoryLite } from "./rules";

function cat(p: Partial<CategoryLite> & { id: string; name: string }): CategoryLite {
  return {
    user_id: null,
    type: "expense",
    keywords: [],
    sort_order: 0,
    is_hidden: false,
    ...p,
  };
}

const categories: CategoryLite[] = [
  cat({ id: "food", name: "อาหาร", keywords: ["กาแฟ", "ข้าว", "น้ำ"] }),
  cat({ id: "water", name: "ค่าน้ำ-ไฟ", keywords: ["ค่าน้ำ", "ค่าไฟ"] }),
  cat({ id: "fuel", name: "เดินทาง", keywords: ["น้ำมัน", "bts"] }),
  cat({ id: "other", name: "อื่นๆ" }),
  cat({ id: "salary", name: "เงินเดือน", type: "income", keywords: ["เงินเดือน"] }),
  cat({ id: "income-other", name: "อื่นๆ", type: "income" }),
];

describe("categorizeByRules", () => {
  it("matches a keyword", () => {
    expect(categorizeByRules({ title: "กาแฟ", type: "expense", categories, memory: [] })).toEqual({
      categoryId: "food",
      via: "keyword",
    });
  });

  it("the longest keyword wins", () => {
    const r = categorizeByRules({ title: "ค่าน้ำ", type: "expense", categories, memory: [] });
    expect(r.categoryId).toBe("water");
    const fuel = categorizeByRules({ title: "น้ำมัน", type: "expense", categories, memory: [] });
    expect(fuel.categoryId).toBe("fuel");
  });

  it("is case-insensitive", () => {
    expect(
      categorizeByRules({ title: "BTS", type: "expense", categories, memory: [] }).categoryId,
    ).toBe("fuel");
  });

  it("only considers categories of the same type", () => {
    const r = categorizeByRules({ title: "เงินเดือน", type: "expense", categories, memory: [] });
    expect(r.categoryId).toBe("other");
    expect(r.via).toBe("fallback");
  });

  it("falls back to อื่นๆ", () => {
    expect(
      categorizeByRules({ title: "อะไรสักอย่าง", type: "income", categories, memory: [] }),
    ).toEqual({
      categoryId: "income-other",
      via: "fallback",
    });
  });

  it("memory beats keywords", () => {
    const r = categorizeByRules({
      title: "กาแฟ ร้านลุงหนวด",
      type: "expense",
      categories,
      memory: [{ match_text: "ลุงหนวด", category_id: "other" }],
    });
    expect(r).toEqual({ categoryId: "other", via: "memory" });
  });

  it("ignores memory that points at a hidden or wrong-type category", () => {
    const r = categorizeByRules({
      title: "กาแฟ ลุงหนวด",
      type: "expense",
      categories,
      memory: [{ match_text: "ลุงหนวด", category_id: "salary" }],
    });
    expect(r.via).toBe("keyword");
  });

  it("the user's own category beats a system one on equal keyword length", () => {
    const withOwn = [
      ...categories,
      cat({ id: "mine", user_id: "u1", name: "คาเฟ่", keywords: ["กาแฟ"] }),
    ];
    expect(
      categorizeByRules({ title: "กาแฟ", type: "expense", categories: withOwn, memory: [] })
        .categoryId,
    ).toBe("mine");
  });

  it("skips hidden categories", () => {
    const hidden = categories.map((c) => (c.id === "food" ? { ...c, is_hidden: true } : c));
    expect(
      categorizeByRules({ title: "กาแฟ", type: "expense", categories: hidden, memory: [] })
        .categoryId,
    ).toBe("other");
  });

  it("returns none when there is no fallback category", () => {
    expect(categorizeByRules({ title: "x", type: "expense", categories: [], memory: [] })).toEqual({
      categoryId: null,
      via: "none",
    });
  });
});

describe("matchLeadingCategory", () => {
  const id = (title: string, type: "expense" | "income" = "expense", list = categories) =>
    matchLeadingCategory(title, type, list)?.id ?? null;

  it("matches a title that is just the category name", () => {
    expect(id("อาหาร")).toBe("food");
    expect(id("เดินทาง")).toBe("fuel");
    expect(id("ค่าน้ำ-ไฟ")).toBe("water");
  });

  it("matches a name followed by more words", () => {
    expect(id("เดินทาง วิน")).toBe("fuel");
  });

  it("does not match when the name is only the start of a longer word", () => {
    expect(id("อาหารเสริม")).toBeNull();
  });

  it("does not match a name in the middle of the title", () => {
    expect(id("กิน อาหาร")).toBeNull();
    expect(id("กาแฟ")).toBeNull();
  });

  it("picks income or expense by the parsed type when the name is shared", () => {
    expect(id("อื่นๆ", "expense")).toBe("other");
    expect(id("อื่นๆ", "income")).toBe("income-other");
  });

  it("reads an income category even when the parsed type said expense", () => {
    expect(matchLeadingCategory("เงินเดือน", "expense", categories)?.type).toBe("income");
  });

  it("ignores hidden categories and prefers the person's own category on a tie", () => {
    const list = [
      cat({ id: "food", name: "อาหาร", is_hidden: true }),
      cat({ id: "sys", name: "ของใช้" }),
      cat({ id: "mine", name: "ของใช้", user_id: "u1" }),
    ];
    expect(id("อาหาร", "expense", list)).toBeNull();
    expect(id("ของใช้", "expense", list)).toBe("mine");
  });

  it("prefers the longest name", () => {
    const list = [cat({ id: "a", name: "ค่า" }), cat({ id: "b", name: "ค่า น้ำ" })];
    expect(id("ค่า น้ำ", "expense", list)).toBe("b");
  });
});

describe("English keywords match whole words from their start", () => {
  const english: CategoryLite[] = [
    cat({ id: "home", name: "ที่พัก", keywords: ["room", "rent"] }),
    cat({ id: "save", name: "ออม/ลงทุน", keywords: ["fund"] }),
    cat({ id: "go", name: "เดินทาง", keywords: ["grab"] }),
    cat({ id: "food", name: "อาหาร", keywords: ["tea", "กาแฟ"] }),
    cat({ id: "other", name: "อื่นๆ" }),
  ];
  const of = (title: string) =>
    categorizeByRules({ title, type: "expense", categories: english, memory: [] }).categoryId;

  it("not inside another word", () => {
    expect(of("mushroom soup 80")).toBe("other");
    expect(of("gift for parent 500")).toBe("other");
    expect(of("refund fee 30")).toBe("other");
    expect(of("steak 300")).toBe("other");
  });

  it("a word that starts with one still counts, as before (grabfood)", () => {
    expect(of("grabfood 120")).toBe("go");
    expect(of("room service 200")).toBe("home");
    expect(of("ice tea 40")).toBe("food");
    expect(of("ชากาแฟ 40")).toBe("food");
  });
});
