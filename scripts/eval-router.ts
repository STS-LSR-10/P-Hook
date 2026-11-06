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
  let wrongWriteTotal = 0;

  for (const c of cases) {
    if (pause > 0) await new Promise((done) => setTimeout(done, pause));
    let d = null;
    try {
      d = sanitizeDecision(await router.route({ text: c.text, today }));
    } catch {
      d = null;
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
      wrongWriteTotal += 1;
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
  const scored = cases.filter((c) => c.expected);
  const right = scored.filter((c) => !wrong.some((w) => w.endsWith(`  ${c.text}`))).length;
  const rightRate = scored.length ? right / scored.length : 1;
  const writeRate = wrongWriteTotal ? wrongWrite / wrongWriteTotal : 0;
  console.log(`\nright group: ${right}/${scored.length} (${(rightRate * 100).toFixed(1)}%)`);
  console.log(
    `written when it must not be: ${wrongWrite}/${wrongWriteTotal} (${(writeRate * 100).toFixed(1)}%)`,
  );
  if (wrong.length) console.log(`\nwrong (${wrong.length}):\n  ${wrong.join("\n  ")}`);
  if (rightRate < MIN_RIGHT || writeRate > MAX_WRITE_WRONG) {
    console.log("\nNOT ready for everyone");
    process.exit(1);
  }
  console.log("\nready for everyone");
}

void main();
