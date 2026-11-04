import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every card the bot sends uses one scale, so they look alike: words in lg (titles, the one big number),
 * md (headings, names, amounts), sm (body) and xs (small print); 12px of room at most; one width
 * (mega), but for the file previews that slide in a row (micro); small buttons.
 */
const DIR = join(__dirname);
const files = [
  ...readdirSync(DIR)
    .filter(
      (f) =>
        (f.endsWith("-flex.ts") || f === "flex.ts" || f === "card-style.ts") &&
        !f.includes(".test."),
    )
    .map((f) => join(DIR, f)),
  join(DIR, "..", "summary-report.ts"),
];

/** "file:line value" for each quoted value, on a line setting one of `keys`, that is not allowed. */
const offending = (keys: string, allowed: (v: string, file: string) => boolean) =>
  files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) =>
        new RegExp(`^\\s*(?:${keys}):`).test(line)
          ? [...line.matchAll(/"([^"]*)"/g)]
              .map((m) => m[1] ?? "")
              .filter((v) => !allowed(v, f.split("/").pop() ?? ""))
              .map((v) => `${f.split("/").pop()}:${i + 1} ${v}`)
          : [],
      ),
  );

const WORDS = new Set(["lg", "md", "sm", "xs"]);
const WIDTHS = new Set(["mega", "micro"]);
/** A picture as wide as its box. */
const PICTURE = new Set(["full"]);
/** Room as LINE's keywords (lg is 12px) or pixels, 12 at most. */
const ROOM = (v: string) =>
  ["none", "xs", "sm", "md", "lg"].includes(v) || (/^\d+px$/.test(v) && parseInt(v, 10) <= 12);

describe("the cards' one scale", () => {
  it("covers every card file", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("words are lg, md, sm or xs; one width, but for the cards that slide in a row", () => {
    // pixel sizes are pictures and icons
    expect(
      offending(
        "size",
        (v, file) =>
          WORDS.has(v) ||
          WIDTHS.has(v) ||
          PICTURE.has(v) ||
          /^\d+px$/.test(v) ||
          // the group welcome (small cards to swipe through), the reminder card and the short lists (narrow)
          (v === "kilo" &&
            ["help-flex.ts", "reminder-flex.ts", "list-flex.ts", "file-flex.ts"].includes(file)),
      ),
    ).toEqual([]);
  });

  it("no room wider than 12px", () => {
    expect(offending("padding(?:All|Top|Bottom|Start|End)", ROOM)).toEqual([]);
  });

  it("small buttons", () => {
    expect(offending("height", (v) => v !== "md" && v !== "lg")).toEqual([]);
  });
});
