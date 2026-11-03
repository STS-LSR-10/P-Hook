import { z } from "zod";
import { formatBaht, money } from "@/lib/money";
import type { CompareRow } from "@/lib/period-compare";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";

export const MAX_INSIGHT_LINES = 4;
export const MAX_LINE_CHARS = 160;
const MAX_TITLE_ROWS = 6;
const MAX_CATEGORY_ROWS = 6;
const MAX_TITLE_CHARS = 40;
/** A rise smaller than this is noise, not an observation. */
const MIN_RISE_PERCENT = 10;

export interface TitleSpend {
  name: string;
  amountSatang: number;
  count: number;
}

export interface TitleRow {
  name: string;
  currentSatang: number;
  previousSatang: number;
  currentCount: number;
  previousCount: number;
  /** Whole percent against the previous period; null when there was nothing before. */
  changePercent: number | null;
}

const pct = (cur: number, prev: number) =>
  prev > 0 ? Math.round(((cur - prev) * 100) / prev) : null;

/** Names joined across the two periods, biggest now first, capped. */
export function buildTitleRows(current: TitleSpend[], previous: TitleSpend[]): TitleRow[] {
  const by = new Map<string, TitleRow>();
  const row = (name: string) =>
    by.get(name) ??
    ({
      name,
      currentSatang: 0,
      previousSatang: 0,
      currentCount: 0,
      previousCount: 0,
      changePercent: null,
    } as TitleRow);
  for (const c of current) {
    const r = row(c.name.slice(0, MAX_TITLE_CHARS));
    r.currentSatang += c.amountSatang;
    r.currentCount += c.count;
    by.set(r.name, r);
  }
  for (const p of previous) {
    const r = row(p.name.slice(0, MAX_TITLE_CHARS));
    r.previousSatang += p.amountSatang;
    r.previousCount += p.count;
    by.set(r.name, r);
  }
  return [...by.values()]
    .map((r) => ({ ...r, changePercent: pct(r.currentSatang, r.previousSatang) }))
    .filter((r) => r.currentSatang > 0)
    .sort((a, b) => b.currentSatang - a.currentSatang || a.name.localeCompare(b.name))
    .slice(0, MAX_TITLE_ROWS);
}

export interface InsightFacts {
  periodLabel: string;
  previousLabel: string;
  expenseSatang: number;
  previousExpenseSatang: number;
  incomeSatang: number;
  expenseChangePercent: number | null;
  categories: CompareRow[];
  titles: TitleRow[];
}

export function buildInsightFacts(input: {
  periodLabel: string;
  previousLabel: string;
  expenseSatang: number;
  previousExpenseSatang: number;
  incomeSatang: number;
  categories: CompareRow[];
  titles: TitleRow[];
}): InsightFacts {
  return {
    ...input,
    categories: input.categories.filter((c) => !c.other).slice(0, MAX_CATEGORY_ROWS),
    titles: input.titles,
    expenseChangePercent: pct(input.expenseSatang, input.previousExpenseSatang),
  };
}

/** Enough to say something? (a month with no spending has nothing to analyse) */
export function hasSomethingToSay(f: InsightFacts): boolean {
  return f.expenseSatang > 0;
}

const baht = (satang: number) => money(satang);

export interface Insight {
  lines: string[];
  tip: string | null;
  source: "ai" | "rules";
}

/**
 * Observations worked out by plain code from the same facts the AI is given. They are the
 * fallback when there is no AI, it fails, or its words do not pass the checks.
 */
export function ruleInsights(f: InsightFacts): Insight {
  const lines: string[] = [];
  const against = f.previousLabel;

  if (f.expenseChangePercent !== null) {
    const p = f.expenseChangePercent;
    lines.push(
      p === 0
        ? `รายจ่ายรวม ${baht(f.expenseSatang)} เท่ากับ${against}`
        : `รายจ่ายรวม ${baht(f.expenseSatang)} ${p > 0 ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(p)}% จาก${against}`,
    );
  } else {
    lines.push(`รายจ่ายรวม ${baht(f.expenseSatang)} (ยังไม่มีข้อมูล${against}ให้เทียบ)`);
  }

  const rises = f.categories
    .filter((c) => c.previousSatang > 0 && (c.changePercent ?? 0) >= MIN_RISE_PERCENT)
    .sort((a, b) => b.currentSatang - b.previousSatang - (a.currentSatang - a.previousSatang));
  const topRise = rises[0];
  if (topRise) {
    lines.push(
      `หมวด${topRise.name}เพิ่มขึ้น ${topRise.changePercent}% (${baht(topRise.previousSatang)} → ${baht(topRise.currentSatang)})`,
    );
  }

  const titleRises = f.titles
    .filter((t) => t.previousSatang > 0 && (t.changePercent ?? 0) >= MIN_RISE_PERCENT)
    .sort((a, b) => b.currentSatang - b.previousSatang - (a.currentSatang - a.previousSatang));
  const topTitle = titleRises[0];
  if (topTitle) {
    lines.push(
      `${topTitle.name} ใช้ไป ${baht(topTitle.currentSatang)} (${topTitle.currentCount} ครั้ง) เพิ่มขึ้น ${topTitle.changePercent}% จาก${against}`,
    );
  }

  const falls = f.categories
    .filter((c) => c.previousSatang > 0 && c.kind === "down")
    .sort((a, b) => b.previousSatang - b.currentSatang - (a.previousSatang - a.currentSatang));
  const topFall = falls[0];
  if (topFall && lines.length < MAX_INSIGHT_LINES) {
    lines.push(`หมวด${topFall.name}ลดลง ${Math.abs(topFall.changePercent ?? 0)}% ทำได้ดี`);
  }

  const top = f.categories[0];
  if (top && lines.length < MAX_INSIGHT_LINES && top.currentSatang > 0) {
    lines.push(`หมวดที่ใช้มากสุดคือ${top.name} ${baht(top.currentSatang)}`);
  }

  const tip = topRise
    ? `ลองตั้งงบเฉพาะหมวด${topRise.name}ในรอบหน้า เพื่อดูแนวโน้มไม่ให้เพิ่มต่อเนื่อง`
    : topTitle
      ? `ลองกำหนดเพดานให้ ${topTitle.name} ในรอบหน้า`
      : "จดรายการให้ครบต่อเนื่อง จะเห็นแนวโน้มชัดขึ้นในรอบหน้า";
  return { lines: lines.slice(0, MAX_INSIGHT_LINES), tip, source: "rules" };
}

// ───── checking what the AI wrote ─────

const rawOutput = z.object({
  insights: z.array(z.string()).default([]),
  tip: z.string().nullable().optional(),
});

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
// the product gives no personal investment advice: a line that advises one is dropped
const INVESTMENT_ADVICE_RE =
  /(ควร|แนะนำ|ลอง|น่า).{0,24}(ลงทุน|ซื้อหุ้น|ซื้อกองทุน|คริปโต|ซื้อทอง|เล่นหุ้น)/;

/** Every number the AI may use: amounts, differences, percents and counts from the facts. */
export function allowedNumbers(f: InsightFacts): Set<string> {
  const out = new Set<string>();
  const money = (satang: number) => out.add(formatBaht(Math.abs(satang)).replace(/,/g, ""));
  const percent = (p: number | null) => {
    if (p !== null) out.add(String(Math.abs(p)));
  };
  money(f.expenseSatang);
  money(f.previousExpenseSatang);
  money(f.incomeSatang);
  money(f.expenseSatang - f.previousExpenseSatang);
  percent(f.expenseChangePercent);
  for (const c of f.categories) {
    money(c.currentSatang);
    money(c.previousSatang);
    money(c.currentSatang - c.previousSatang);
    percent(c.changePercent);
  }
  for (const t of f.titles) {
    money(t.currentSatang);
    money(t.previousSatang);
    money(t.currentSatang - t.previousSatang);
    percent(t.changePercent);
    out.add(String(t.currentCount));
    out.add(String(t.previousCount));
  }
  return out;
}

/** True when every number in `text` is one the facts contain (nothing invented). */
export function usesOnlyKnownNumbers(text: string, allowed: Set<string>): boolean {
  const tokens = normalizeThaiDigits(text).match(NUMBER_RE) ?? [];
  return tokens.every((t) => allowed.has(t.replace(/,/g, "")));
}

function acceptable(text: string, allowed: Set<string>): boolean {
  return text.length > 0 && !INVESTMENT_ADVICE_RE.test(text) && usesOnlyKnownNumbers(text, allowed);
}

/**
 * Keep the AI's lines that pass: short enough, no number that is not in the facts, no investment
 * advice. Null when too little is left to be worth showing (the caller then uses `ruleInsights`).
 */
export function sanitizeInsightOutput(raw: unknown, f: InsightFacts): Insight | null {
  const parsed = rawOutput.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = allowedNumbers(f);
  const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS);
  const lines = parsed.data.insights
    .map(clean)
    .filter((l) => acceptable(l, allowed))
    .slice(0, MAX_INSIGHT_LINES);
  if (lines.length < 2) return null;
  const tipText = clean(parsed.data.tip ?? "");
  return { lines, tip: acceptable(tipText, allowed) ? tipText : null, source: "ai" };
}

/** The AI's words when they pass the checks, otherwise the plain-code observations. */
export function chooseInsight(f: InsightFacts, aiRaw: unknown | null): Insight {
  const fromAi = aiRaw === null ? null : sanitizeInsightOutput(aiRaw, f);
  return fromAi ?? ruleInsights(f);
}
