import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./i18n-en";

/** Every source file of the app (tests aside). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

/** The words given to t("…") / tr("…") / apiError("…") in the code, as written. */
function keys(): { key: string; where: string }[] {
  const out: { key: string; where: string }[] = [];
  for (const file of sources(join(__dirname, ".."))) {
    const text = readFileSync(file, "utf8");
    const where = file.split("/src/")[1] ?? file;
    // t("…") / t('…'), and the message of apiError("…") (it is put through t() when sent)
    for (const m of text.matchAll(
      /\b(?:t|tr|apiError)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    )) {
      const raw = m[1] ?? '""';
      const key = raw.startsWith("'")
        ? raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"')
        : (JSON.parse(raw) as string);
      out.push({ key, where });
    }
  }
  return out;
}

describe("the English dictionary", () => {
  it("has every phrase the code asks for", () => {
    const missing = keys()
      .filter((k) => /[฀-๿]/.test(k.key) && !(k.key in EN))
      .map((k) => `${k.where}: ${k.key}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps the values of a phrase ({0}, {1}) in its English", () => {
    const bad = Object.entries(EN).filter(([th, en]) => {
      const slots = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      return slots(th) !== slots(en);
    });
    expect(bad).toEqual([]);
  });

  it("has no Thai left in its English, but chat commands in quotes (the bot reads Thai) and ฿", () => {
    // Thai letters, not the baht sign
    const thai = /[\u0E01-\u0E3E\u0E40-\u0E7F]/;
    const left = Object.entries(EN).filter(([, en]) =>
      thai.test(en.replace(/"[^"]*"|“[^”]*”/g, "")),
    );
    expect(left).toEqual([]);
  });
});
