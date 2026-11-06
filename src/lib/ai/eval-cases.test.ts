import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/commands";
import { parseMessage } from "@/lib/parse/text-parser";
import { EVAL_CASES, MUTATING } from "./eval-cases";
import { needsRouter } from "./route-text";

const NOW = new Date("2026-11-01T05:00:00Z");

describe("the Thai sentence set", () => {
  it("is a real set: about 200 different sentences, every kind of message in it", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(190);
    const texts = EVAL_CASES.map((c) => c.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const intent of [
      "money",
      "ask",
      "reminder_add",
      "reminder_edit",
      "note_add",
      "search",
      "query",
      "file_save",
    ]) {
      expect(EVAL_CASES.filter((c) => c.expected === intent).length).toBeGreaterThanOrEqual(8);
    }
    expect(EVAL_CASES.filter((c) => !c.expected && c.never).length).toBeGreaterThanOrEqual(15);
  });

  it("says what is right for every sentence", () => {
    for (const c of EVAL_CASES) expect(c.expected || c.never, c.text).toBeTruthy();
    for (const c of EVAL_CASES.filter((c) => c.expected === "ask")) {
      expect(c.never, c.text).toEqual(MUTATING);
    }
  });

  // The rules alone, no AI: a money sentence they are sure of must give the right amount, and a
  // sentence that is not money must never be taken for an entry without the AI being asked.
  it("the rules read every money sentence they keep for themselves correctly", () => {
    for (const c of EVAL_CASES.filter((c) => c.expected === "money")) {
      const r = parseMessage(c.text, NOW, { currencies: true });
      if (needsRouter(c.text, r)) continue;
      expect(r.entries.length, c.text).toBeGreaterThan(0);
      expect((r.entries[0]?.amountSatang ?? 0) / 100, c.text).toBe(c.amount);
    }
  });

  it("no sentence that must not be written is taken as an entry by the rules alone", () => {
    for (const c of EVAL_CASES.filter((c) => c.expected !== "money")) {
      // an exact command is done by its own handler, before any entry is read
      if (parseCommand(c.text)) continue;
      const r = parseMessage(c.text, NOW, { currencies: true });
      if (r.entries.length === 0) continue;
      // the rules would record it: only allowed when the AI is asked first
      expect(needsRouter(c.text, r), c.text).toBe(true);
    }
  });
});
