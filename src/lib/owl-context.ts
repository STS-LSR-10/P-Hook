import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillCadence } from "@/lib/bill";
import { listBills } from "@/lib/bill-repo";
import { calendarMonthRange, cycleRange } from "@/lib/budget-cycle";
import { listDebts } from "@/lib/debt-repo";
import type { DebtDirection } from "@/lib/debt";
import { listGoals } from "@/lib/goal-repo";
import { formatBaht, toSatang } from "@/lib/money";
import { listNotes } from "@/lib/note-repo";
import type { Cadence } from "@/lib/recurring";
import { listRules } from "@/lib/recurring-repo";
import { looksSecret } from "@/lib/secret-text";
import { log, safeMessage } from "@/lib/log";
import {
  expenseTotalSatang,
  getBudgetMode,
  getSettings,
  loadBudgets,
  loadCategories,
  periodSummary,
} from "@/lib/repo";
import { loadCategorySpend } from "@/lib/summary-load";
import { bangkokParts, formatThaiDate, formatThaiMonthShort, fromBangkok } from "@/lib/thai-date";
import { describeReminder, type Repeat } from "@/lib/user-reminder";
import { listReminders } from "@/lib/user-reminder-repo";

const MAX_RECENT = 15;
const MAX_CATEGORIES = 8;
const MAX_REMINDERS = 8;
const MAX_NOTES = 8;
const MAX_NOTE_CHARS = 300;
const MAX_BUDGET_LINES = 8;
const MAX_DEBTS = 8;
const MAX_GOALS = 5;
const MAX_BILLS = 8;
const MAX_RECURRING = 8;

const CADENCE_LABEL: Record<Cadence | BillCadence, string> = {
  daily: "รายวัน",
  weekly: "รายสัปดาห์",
  monthly: "รายเดือน",
  yearly: "รายปี",
  once: "ครั้งเดียว",
};

export interface Money {
  incomeSatang: number;
  expenseSatang: number;
  count: number;
}

/** Everything the assistant may see about one person, as plain numbers and short texts. */
export interface OwlFacts {
  now: Date;
  month: Money | null;
  previousMonth: Money | null;
  year: Money | null;
  topCategories: { name: string; amountSatang: number }[];
  /** Last month's biggest categories, to compare with this month's. */
  previousCategories: { name: string; amountSatang: number }[];
  /** Income and expense of the last six months, oldest first (the current month last). */
  monthly: { monthStart: Date; incomeSatang: number; expenseSatang: number }[];
  budgets: { scope: string | null; spentSatang: number; limitSatang: number }[];
  cycleLabel: string | null;
  recent: {
    occurredAt: Date;
    type: "income" | "expense";
    title: string;
    amountSatang: number;
    category: string | null;
  }[];
  reminders: { remindAt: Date; body: string; repeat: Repeat | null }[];
  notes: { createdAt: Date; body: string }[];
  /** Every open debt, so the totals are real; only the biggest are listed. */
  debts: {
    direction: DebtDirection;
    person: string;
    remainingSatang: number;
    dueAt: Date | null;
  }[];
  goals: {
    name: string;
    savedSatang: number;
    targetSatang: number;
    dueOn: Date | null;
    monthlyNeededSatang: number | null;
  }[];
  /** All of them, so the person can be told when only some are listed. */
  bills: { name: string; amountSatang: number | null; cadence: BillCadence; nextDueOn: Date }[];
  /** All of them, as with `bills`. */
  recurring: {
    type: "income" | "expense";
    title: string;
    amountSatang: number;
    cadence: Cadence;
  }[];
}

const baht = (satang: number) => `฿${formatBaht(satang)}`;

function moneyLine(label: string, m: Money | null): string | null {
  if (!m) return null;
  return `${label}: รายรับ ${baht(m.incomeSatang)} · รายจ่าย ${baht(m.expenseSatang)} · คงเหลือ ${baht(m.incomeSatang - m.expenseSatang)} · ${m.count} รายการ`;
}

const oneLine = (s: string, max = 80) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** A calendar day (YYYY-MM-DD) as a date to print. */
function dayOf(ymd: string): Date {
  const [year = 0, month = 1, day = 1] = ymd.split("-").map(Number);
  return fromBangkok(year, month, day);
}

/** A heading that says when the list below is not all of it. */
const heading = (label: string, shown: number, total: number) =>
  `${label}${total > shown ? ` (แสดง ${shown} จาก ${total})` : ""}:`;

function debtLines(debts: OwlFacts["debts"]): string[] {
  if (debts.length === 0) return [];
  const total = (direction: DebtDirection) =>
    debts.filter((d) => d.direction === direction).reduce((s, d) => s + d.remainingSatang, 0);
  const listed = [...debts]
    .sort((a, b) => b.remainingSatang - a.remainingSatang)
    .slice(0, MAX_DEBTS);
  return [
    `หนี้ที่ยืมมาคงเหลือรวม ${baht(total("borrowed"))} · เงินที่ให้ยืมคงเหลือรวม ${baht(total("lent"))}`,
    "รายการหนี้ (มากไปน้อย ไม่มีข้อมูลดอกเบี้ย):",
    ...listed.map(
      (d) =>
        `- ${d.direction === "borrowed" ? "ยืมมาจาก" : "ให้ยืม"} ${oneLine(d.person, 40)} | เหลือ ${baht(d.remainingSatang)}${d.dueAt ? ` | ครบ ${formatThaiDate(d.dueAt)}` : ""}`,
    ),
  ];
}

/** The facts as the text the model reads (Thai, one fact per line, nothing but what is listed). */
export function renderOwlContext(f: OwlFacts): string {
  const p = bangkokParts(f.now);
  const prev = fromBangkok(p.year, p.month - 1, 15);
  const lines: (string | null)[] = [
    `วันนี้: ${formatThaiDate(f.now)} (เวลาไทย)`,
    moneyLine(`เดือนนี้ (${formatThaiMonthShort(f.now)})`, f.month),
    moneyLine(`เดือนก่อน (${formatThaiMonthShort(prev)})`, f.previousMonth),
    moneyLine(`ปีนี้ (${p.year + 543})`, f.year),
  ];
  if (f.topCategories.length > 0) {
    lines.push(
      `หมวดรายจ่ายเดือนนี้ (มากไปน้อย): ${f.topCategories.map((c) => `${c.name} ${baht(c.amountSatang)}`).join(" · ")}`,
    );
  }
  if (f.previousCategories.length > 0) {
    lines.push(
      `หมวดรายจ่ายเดือนก่อน (มากไปน้อย): ${f.previousCategories.map((c) => `${c.name} ${baht(c.amountSatang)}`).join(" · ")}`,
    );
  }
  if (f.month && f.month.expenseSatang > 0) {
    lines.push(
      `รายจ่ายเฉลี่ยต่อวันเดือนนี้ (${p.day} วันที่ผ่านมา): ${baht(Math.round(f.month.expenseSatang / p.day))}`,
    );
  }
  if (f.monthly.length > 0) {
    lines.push(
      `ย้อนหลัง ${f.monthly.length} เดือน (รายรับ/รายจ่าย): ${f.monthly
        .map(
          (m) =>
            `${formatThaiMonthShort(m.monthStart)} ${baht(m.incomeSatang)}/${baht(m.expenseSatang)}`,
        )
        .join(" · ")}`,
    );
  }
  if (f.budgets.length > 0) {
    lines.push(
      `งบ${f.cycleLabel ? ` (รอบ${f.cycleLabel})` : ""}: ${f.budgets
        .map((b) => {
          const pct = b.limitSatang > 0 ? Math.floor((b.spentSatang * 100) / b.limitSatang) : 0;
          return `${b.scope ? `หมวด${b.scope}` : "งบรวม"} ใช้ไป ${baht(b.spentSatang)} จาก ${baht(b.limitSatang)} (${pct}%)`;
        })
        .join(" | ")}`,
    );
  }
  if (f.recent.length > 0) {
    lines.push("รายการล่าสุด (ใหม่ไปเก่า):");
    for (const r of f.recent) {
      lines.push(
        `- ${formatThaiDate(r.occurredAt, true)} | ${r.type === "income" ? "รายรับ" : "รายจ่าย"} | ${oneLine(r.title)} | ${baht(r.amountSatang)}${r.category ? ` | ${r.category}` : ""}`,
      );
    }
  }
  if (f.reminders.length > 0) {
    lines.push("เตือนที่รออยู่:");
    for (const r of f.reminders) {
      lines.push(`- ${describeReminder(r.remindAt, r.repeat)} | ${oneLine(r.body, 100)}`);
    }
  }
  if (f.notes.length > 0) {
    lines.push("โน้ตของผู้ใช้ที่เกี่ยวกับคำถาม:");
    for (const n of f.notes) {
      lines.push(
        `- ${formatThaiDate(n.createdAt)}: ${n.body.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS)}`,
      );
    }
  }
  lines.push(...debtLines(f.debts));
  if (f.goals.length > 0) {
    lines.push("เป้าออม:");
    for (const g of f.goals) {
      lines.push(
        `- ${oneLine(g.name, 40)} | ออมแล้ว ${baht(g.savedSatang)} จาก ${baht(g.targetSatang)}${g.dueOn ? ` | ครบ ${formatThaiDate(g.dueOn)}` : ""}${g.monthlyNeededSatang !== null ? ` | ต้องเก็บเดือนละ ${baht(g.monthlyNeededSatang)}` : ""}`,
      );
    }
  }
  if (f.bills.length > 0) {
    const listed = f.bills.slice(0, MAX_BILLS);
    lines.push(heading("บิลที่ต้องจ่าย", listed.length, f.bills.length));
    for (const b of listed) {
      lines.push(
        `- ${oneLine(b.name, 40)} ${b.amountSatang === null ? "ยังไม่ระบุยอด" : baht(b.amountSatang)} ${CADENCE_LABEL[b.cadence]} | ครบ ${formatThaiDate(b.nextDueOn)}`,
      );
    }
  }
  if (f.recurring.length > 0) {
    const listed = f.recurring.slice(0, MAX_RECURRING);
    lines.push(heading("รายการประจำ", listed.length, f.recurring.length));
    for (const r of listed) {
      lines.push(
        `- ${r.type === "income" ? "รายรับ" : "รายจ่าย"} ${oneLine(r.title, 40)} ${baht(r.amountSatang)} ${CADENCE_LABEL[r.cadence]}`,
      );
    }
  }
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** Words of the question to look for in notes (Thai has no spaces, so only spaced words count). */
export function noteSearchWords(question: string): string[] {
  const words = question
    .split(/[\s,;?!]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 30);
  return [...new Set(words)].slice(0, 3);
}

/** Does the question ask about the person's notes in general? */
export const asksAboutNotes = (question: string) => /โน้ต|บันทึกไว้|จดไว้/.test(question);

/** Run one part of the facts; a failing part is left out (and logged) instead of failing the answer. */
async function part<T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    log.warn("owl_context_part_failed", { part: name, reason: safeMessage(error) });
    return fallback;
  }
}

/**
 * Collect what the assistant may see: this month, last month and this year in numbers, the biggest
 * categories, the budget(s), the last entries, waiting reminders, open debts, goals, bills and
 * recurring entries, and notes only when the question asks for them (all notes, or those that
 * contain a word of the question).
 */
export async function loadOwlFacts(
  db: SupabaseClient,
  userId: string,
  question: string,
  now: Date,
): Promise<OwlFacts> {
  const p = bangkokParts(now);
  const month = calendarMonthRange(now);
  const previous = { from: fromBangkok(p.year, p.month - 1, 1), to: month.from };
  const year = { from: fromBangkok(p.year, 1, 1), to: fromBangkok(p.year + 1, 1, 1) };

  const [
    thisMonth,
    lastMonth,
    thisYear,
    categories,
    previousCategories,
    monthly,
    budgetPart,
    recent,
    reminders,
    notes,
    debts,
    goals,
    bills,
    rules,
  ] = await Promise.all([
    part("month", () => periodSummary(db, { userId, ...month }), null),
    part("previous_month", () => periodSummary(db, { userId, ...previous }), null),
    part("year", () => periodSummary(db, { userId, ...year }), null),
    part("categories", () => loadCategorySpend(db, userId, month), []),
    part("previous_categories", () => loadCategorySpend(db, userId, previous), []),
    part(
      "monthly",
      async () => {
        const starts = [5, 4, 3, 2, 1, 0].map((back) => fromBangkok(p.year, p.month - back, 1));
        const rows = await Promise.all(
          starts.map(async (from, i) => ({
            monthStart: from,
            ...(await periodSummary(db, {
              userId,
              from,
              to: i === starts.length - 1 ? month.to : (starts[i + 1] as Date),
            })),
          })),
        );
        return rows.map((r) => ({
          monthStart: r.monthStart,
          incomeSatang: r.incomeSatang,
          expenseSatang: r.expenseSatang,
        }));
      },
      [],
    ),
    part(
      "budgets",
      async () => {
        const [settings, mode, budgets, cats] = await Promise.all([
          getSettings(db, userId),
          getBudgetMode(db, userId),
          loadBudgets(db, userId),
          loadCategories(db, userId),
        ]);
        const range = cycleRange(now, settings.budget_cycle, settings.cycle_start_day);
        const wanted = budgets
          .filter((b) => (mode === "category" ? b.category_id !== null : b.category_id === null))
          .slice(0, MAX_BUDGET_LINES);
        const rows = await Promise.all(
          wanted.map(async (b) => ({
            scope: b.category_id ? (cats.find((c) => c.id === b.category_id)?.name ?? null) : null,
            limitSatang: toSatang(b.amount),
            spentSatang: await expenseTotalSatang(db, {
              userId,
              ...range,
              categoryId: b.category_id ?? undefined,
            }),
          })),
        );
        return {
          rows: rows.filter((r) => r.limitSatang > 0 && (mode !== "category" || r.scope !== null)),
          label:
            settings.budget_cycle === "weekly"
              ? "รายสัปดาห์"
              : `รายเดือน วันที่ ${settings.cycle_start_day}`,
        };
      },
      { rows: [], label: "" },
    ),
    part(
      "recent",
      async () => {
        const { data, error } = await db
          .from("transactions")
          .select("occurred_at,type,title,amount,categories(name)")
          .eq("user_id", userId)
          .eq("status", "confirmed")
          .order("occurred_at", { ascending: false })
          .limit(MAX_RECENT);
        if (error) throw new Error(error.message);
        const rows = (data ?? []).filter((r) => !looksSecret(String(r.title ?? "")));
        return rows.map((r) => {
          const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
          return {
            occurredAt: new Date(r.occurred_at as string),
            type: r.type as "income" | "expense",
            title: String(r.title ?? ""),
            amountSatang: toSatang(r.amount as string | number),
            category: (cat as { name?: string } | null)?.name ?? null,
          };
        });
      },
      [],
    ),
    part("reminders", () => listReminders(db, userId, MAX_REMINDERS), []),
    part(
      "notes",
      async () => {
        if (asksAboutNotes(question)) {
          const { items } = await listNotes(db, userId, { limit: MAX_NOTES });
          return items.filter((n) => !looksSecret(n.body));
        }
        const found = new Map<string, { createdAt: string; body: string }>();
        for (const w of noteSearchWords(question)) {
          for (const n of (await listNotes(db, userId, { q: w, limit: 3 })).items) {
            if (!looksSecret(n.body)) found.set(n.id, n);
          }
        }
        return [...found.values()].slice(0, 5);
      },
      [],
    ),
    part("debts", () => listDebts(db, userId), []),
    part("goals", () => listGoals(db, userId, now), []),
    part("bills", () => listBills(db, userId), []),
    part("recurring", () => listRules(db, userId), []),
  ]);

  return {
    now,
    month: thisMonth,
    previousMonth: lastMonth,
    year: thisYear,
    topCategories: categories.slice(0, MAX_CATEGORIES).map((c) => ({
      name: c.name,
      amountSatang: c.amountSatang,
    })),
    previousCategories: previousCategories.slice(0, MAX_CATEGORIES).map((c) => ({
      name: c.name,
      amountSatang: c.amountSatang,
    })),
    monthly,
    budgets: budgetPart.rows,
    cycleLabel: budgetPart.label || null,
    recent,
    reminders: reminders
      .filter((r) => !looksSecret(r.body))
      .map((r) => ({
        remindAt: new Date(r.remindAt),
        body: r.body,
        repeat: r.repeat,
      })),
    notes: notes.map((n) => ({ createdAt: new Date(n.createdAt), body: n.body })),
    debts: debts
      .filter((d) => d.remainingSatang > 0 && !looksSecret(d.person))
      .map((d) => ({
        direction: d.direction,
        person: d.person,
        remainingSatang: d.remainingSatang,
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
      })),
    goals: goals
      .filter((g) => !g.archived && !g.done && !looksSecret(g.name))
      .slice(0, MAX_GOALS)
      .map((g) => ({
        name: g.name,
        savedSatang: g.savedSatang,
        targetSatang: g.targetSatang,
        dueOn: g.dueOn ? dayOf(g.dueOn) : null,
        monthlyNeededSatang: g.monthlyNeededSatang,
      })),
    bills: bills
      .filter((b) => !looksSecret(b.name))
      .map((b) => ({
        name: b.name,
        amountSatang: b.amountSatang,
        cadence: b.cadence,
        nextDueOn: dayOf(b.nextDueOn),
      })),
    recurring: rules
      .filter((r) => r.is_active && !looksSecret(r.title))
      .map((r) => ({
        type: r.type,
        title: r.title,
        amountSatang: toSatang(r.amount),
        cadence: r.cadence,
      })),
  };
}
