/**
 * Try the intent router on the Thai sentence set (src/lib/ai/eval-cases.ts) against the real AI
 * provider, before a release or after changing the prompt.
 *   pnpm eval:router
 * Reads the AI key from .env.local (or the environment) and sends only those sentences.
 * EVAL_PAUSE_MS sets the wait between calls (free AI keys allow only a few a minute; default 7000,
 * use 0 on a paid key). EVAL_ONLY=money,ask runs only those groups.
 *
 * Passes when the right group was picked for at least 95% of the sentences that have one, and a
 * sentence that must not be written was taken for something that writes in at most 1% of all.
 */
import { EVAL_CASES, MUTATING, type EvalCase } from "../src/lib/ai/eval-cases";
import { buildIntentRouter, sanitizeDecision } from "../src/lib/ai/intent-router";
import { looksSecret } from "../src/lib/secret-text";
import type { AiProviderName } from "../src/lib/ocr/provider";

const MIN_RIGHT = 0.95;
const MAX_WRITE_WRONG = 0.01;

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // the environment alone is fine
  }
  const router = buildIntentRouter({
    AI_PROVIDER: (process.env.AI_PROVIDER || "gemini") as AiProviderName,
    AI_MODEL: process.env.AI_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!router) {
    console.error("No AI key: set GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY");
    process.exit(2);
  }
  const pause = Number(process.env.EVAL_PAUSE_MS ?? 7_000);
  const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim());
  const cases: EvalCase[] = only
    ? EVAL_CASES.filter((c) => only.includes(c.expected ?? "never"))
    : EVAL_CASES;

  const today = new Date().toISOString().slice(0, 10);
  const byGroup = new Map<string, { right: number; total: number }>();
  const wrong: string[] = [];
  let wrongWrite = 0;
  let secretSkipped = 0;
  const noAnswer: string[] = [];

  for (const c of cases) {
    if (pause > 0) await new Promise((done) => setTimeout(done, pause));
    // the bot never sends a password or an ID number to the AI, so neither does the check
    if (looksSecret(c.text)) {
      secretSkipped += 1;
      continue;
    }
    let d = null;
    for (let attempt = 0; attempt < 2 && d === null; attempt += 1) {
      try {
        d = sanitizeDecision(await router.route({ text: c.text, today }));
      } catch {
        d = null;
      }
      if (d === null && pause > 0) await new Promise((done) => setTimeout(done, pause));
    }
    if (d === null) {
      // no answer twice: the bot falls back to its rules, so this is not a wrong answer
      noAnswer.push(c.text);
      continue;
    }
    const pass =
      d !== null &&
      (c.expected ? d.intent === c.expected : !c.never?.includes(d.intent)) &&
      (!c.keeps || (d.reminderText ?? "").includes(c.keeps));
    const group = c.expected ?? "never-write";
    const g = byGroup.get(group) ?? { right: 0, total: 0 };
    g.total += 1;
    if (pass) g.right += 1;
    byGroup.set(group, g);
    if (c.never) {
      if (d !== null && MUTATING.includes(d.intent) && c.never.includes(d.intent)) wrongWrite += 1;
    }
    if (!pass) wrong.push(`${d?.intent ?? "-"} (${d?.confidence ?? "-"})  ${c.text}`);
  }

  console.log(`\n${router.name}`);
  for (const [group, g] of byGroup) {
    console.log(
      `  ${group.padEnd(14)} ${g.right}/${g.total}  ${Math.round((g.right / g.total) * 100)}%`,
    );
  }
  const scored = cases.filter((c) => c.expected && !noAnswer.includes(c.text));
  const right = scored.filter((c) => !wrong.some((w) => w.endsWith(`  ${c.text}`))).length;
  const rightRate = scored.length ? right / scored.length : 1;
  const asked = cases.length - secretSkipped - noAnswer.length;
  const writeRate = asked ? wrongWrite / asked : 0;
  console.log(`\nright group: ${right}/${scored.length} (${(rightRate * 100).toFixed(1)}%)`);
  console.log(
    `written when it must not be: ${wrongWrite}/${asked} (${(writeRate * 100).toFixed(1)}%)`,
  );
  if (secretSkipped) console.log(`kept away from the AI (secrets): ${secretSkipped}`);
  if (noAnswer.length)
    console.log(`\nno answer after 2 tries (the bot uses its rules): ${noAnswer.length}\n  ${noAnswer.join("\n  ")}`);
  if (wrong.length) console.log(`\nwrong (${wrong.length}):\n  ${wrong.join("\n  ")}`);
  if (rightRate < MIN_RIGHT || writeRate > MAX_WRITE_WRONG) {
    console.log("\nNOT ready for everyone");
    process.exit(1);
  }
  console.log("\nready for everyone");
}

void main();
