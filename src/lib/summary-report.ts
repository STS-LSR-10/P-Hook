import { clampStartDay, monthStart, type DateRange } from "@/lib/budget-cycle";
import { money } from "@/lib/money";
import { addLocalDays, bangkokParts, formatThaiDayMonth, fromBangkok } from "@/lib/thai-date";
import type { BudgetCycle, LineMessage } from "@/lib/types";
import { bar, barColor, cardHeader, pillFooter, TINT } from "@/lib/line/card-style";

/** Hour (Bangkok) from which the automatic summaries may be sent. */
export const SUMMARY_HOUR = 9;

export type SummaryKind = "weekly" | "monthly";

const two = (n: number) => String(n).padStart(2, "0");

/** "2026-10-19" for the Bangkok day containing `now` (matches the `date` columns). */
export function bangkokDay(now: Date): string {
  const p = bangkokParts(now);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** Monday 09:00 or later, and not sent yet today. */
export function isWeeklySummaryDue(now: Date, lastSentOn: string | null): boolean {
  const p = bangkokParts(now);
  return p.weekday === 1 && p.hour >= SUMMARY_HOUR && lastSentOn !== bangkokDay(now);
}

/**
 * The monthly summary follows the person's budget cycle: it goes out on the cycle's start day
 * (day 1 for a weekly budget cycle, which has no start day) at 09:00 or later, once.
 */
export function monthlyStartDay(cycle: BudgetCycle, cycleStartDay: number): number {
  return cycle === "weekly" ? 1 : clampStartDay(cycleStartDay);
}

export function isMonthlySummaryDue(
  now: Date,
  cycle: BudgetCycle,
  cycleStartDay: number,
  lastSentOn: string | null,
): boolean {
  const p = bangkokParts(now);
  // a day past the end of the month falls on its last day
  const startsOn = bangkokParts(monthStart(p.year, p.month, monthlyStartDay(cycle, cycleStartDay)));
  return p.day === startsOn.day && p.hour >= SUMMARY_HOUR && lastSentOn !== bangkokDay(now);
}

/** The Monday-to-Sunday week that ended before the Monday of `now`. */
export function lastWeekRange(now: Date): DateRange {
  const p = bangkokParts(now);
  const sinceMonday = (p.weekday + 6) % 7;
  return {
    from: fromBangkok(p.year, p.month, p.day - sinceMonday - 7),
    to: fromBangkok(p.year, p.month, p.day - sinceMonday),
  };
}

/** The budget month that ended on the start day of the cycle containing `now`. */
export function lastMonthRange(now: Date, cycle: BudgetCycle, cycleStartDay: number): DateRange {
  const day = monthlyStartDay(cycle, cycleStartDay);
  const p = bangkokParts(now);
  const thisStart = now >= monthStart(p.year, p.month, day) ? p.month : p.month - 1;
  return {
    from: monthStart(p.year, thisStart - 1, day),
    to: monthStart(p.year, thisStart, day),
  };
}

/**
 * The period right before `range`, of the same kind (a week before a week, a month before a month).
 * `startDay`: the cycle's chosen start day, so a cycle cut short by its month (28 Feb for 31) is
 * preceded by one from the chosen day (31 Jan); without it the range's own start day is used.
 */
export function previousRange(kind: SummaryKind, range: DateRange, startDay?: number): DateRange {
  if (kind === "weekly") return { from: addLocalDays(range.from, -7), to: range.from };
  const p = bangkokParts(range.from);
  return { from: monthStart(p.year, p.month - 1, startDay ?? p.day), to: range.from };
}

export interface SummaryTx {
  occurredAt: Date;
  type: "income" | "expense";
  /** Integer satang. */
  amountSatang: number;
  categoryName: string | null;
}

export interface Totals {
  income: number;
  expense: number;
  count: number;
}

export interface CategoryShare {
  name: string;
  amountSatang: number;
  /** Whole percent of the period's expenses. */
  percent: number;
}

export interface SummaryData {
  current: Totals;
  previous: Totals;
  topExpenses: CategoryShare[];
}

export function summarize(txs: SummaryTx[], range: DateRange, previous: DateRange): SummaryData {
  const current: Totals = { income: 0, expense: 0, count: 0 };
  const before: Totals = { income: 0, expense: 0, count: 0 };
  const byCategory = new Map<string, number>();

  for (const tx of txs) {
    const t = tx.occurredAt.getTime();
    const bucket =
      t >= range.from.getTime() && t < range.to.getTime()
        ? current
        : t >= previous.from.getTime() && t < previous.to.getTime()
          ? before
          : null;
    if (!bucket) continue;
    bucket.count += 1;
    if (tx.type === "income") bucket.income += tx.amountSatang;
    else bucket.expense += tx.amountSatang;
    if (bucket === current && tx.type === "expense") {
      const name = tx.categoryName ?? "ไม่ระบุหมวด";
      byCategory.set(name, (byCategory.get(name) ?? 0) + tx.amountSatang);
    }
  }

  const topExpenses = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, amountSatang]) => ({
      name,
      amountSatang,
      percent: current.expense > 0 ? Math.round((amountSatang * 100) / current.expense) : 0,
    }));
  return { current, previous: before, topExpenses };
}

/** Whole-percent change of the expenses against the previous period; null without a baseline. */
export function expenseChangePercent(data: SummaryData): number | null {
  if (data.previous.expense <= 0) return null;
  return Math.round(((data.current.expense - data.previous.expense) * 100) / data.previous.expense);
}

/** "13 – 19 ต.ค." style label for a range (the end day is the day before `to`). */
export function rangeLabel(range: DateRange): string {
  return `${formatThaiDayMonth(range.from)} – ${formatThaiDayMonth(addLocalDays(range.to, -1))}`;
}

const COLOR = { text: "#0F172A", muted: "#64748B", income: "#047857", expense: "#E11D48" };

/** The summary card pushed to the chat. `liffUrl` opens the analytics page (omitted when unknown). */
export function buildSummaryMessage(input: {
  kind: SummaryKind;
  range: DateRange;
  data: SummaryData;
  liffUrl?: string;
}): LineMessage {
  return buildSummaryCard({
    title: input.kind === "weekly" ? "สรุปรายสัปดาห์" : "สรุปรายเดือน",
    range: input.range,
    data: input.data,
    against: input.kind === "weekly" ? "สัปดาห์ก่อน" : "เดือนก่อน",
    liffUrl: input.liffUrl,
  });
}

/**
 * The one summary card: totals, the top expense categories and, when `against` names a previous
 * period, the change of the expenses against it. Used by the automatic pushes and the chat commands.
 */
export function buildSummaryCard(input: {
  title: string;
  range: DateRange;
  data: SummaryData;
  /** Name of the previous period ("เดือนก่อน"); omit for no comparison line. */
  against?: string;
  /** Replaces the range under the title (e.g. a single dated day). */
  subtitle?: string;
  /** A day card with a daily limit set: adds a line with how much of it is used. */
  dailyLimitSatang?: number;
  liffUrl?: string;
}): LineMessage {
  const { title, range, data, against } = input;
  const subtitle = input.subtitle ?? rangeLabel(range);
  const net = data.current.income - data.current.expense;
  const change = against ? expenseChangePercent(data) : null;

  const stat = (emoji: string, label: string, value: string, color: string, arrow = "") => ({
    type: "box",
    layout: "horizontal",
    alignItems: "center",
    margin: "md",
    contents: [
      { type: "text", text: `${emoji} ${label}`, size: "md", color: TINT.strong, flex: 4 },
      {
        type: "text",
        text: `${arrow}${value}`,
        size: "md",
        weight: "bold",
        color,
        align: "end",
        flex: 6,
      },
    ],
  });

  const body: unknown[] = [
    stat("💰", "รายรับ", `+${money(data.current.income)}`, TINT.good, "↑ "),
    stat("🧾", "รายจ่าย", `-${money(data.current.expense)}`, TINT.bad, "↓ "),
    {
      type: "box",
      layout: "horizontal",
      alignItems: "center",
      margin: "md",
      contents: [
        { type: "text", text: "เหลือ", size: "md", weight: "bold", color: TINT.strong, flex: 3 },
        {
          type: "text",
          text: `💵 ${net < 0 ? "-" : ""}${money(Math.abs(net))}`,
          size: "lg",
          weight: "bold",
          color: net < 0 ? TINT.bad : TINT.strong,
          align: "end",
          flex: 7,
        },
      ],
    },
  ];

  if (input.dailyLimitSatang && input.dailyLimitSatang > 0) {
    const used = Math.floor((data.current.expense * 100) / input.dailyLimitSatang);
    body.push({
      type: "text",
      text:
        data.current.expense > input.dailyLimitSatang
          ? `เกินงบวันนี้ ${money(data.current.expense - input.dailyLimitSatang)} (งบ ${money(input.dailyLimitSatang)})`
          : `ใช้ไป ${used}% ของงบวันนี้ ${money(input.dailyLimitSatang)}`,
      size: "xs",
      color:
        data.current.expense > input.dailyLimitSatang
          ? COLOR.expense
          : used >= 80
            ? "#D97706"
            : COLOR.muted,
      wrap: true,
      margin: "md",
    });
  }

  if (data.topExpenses.length > 0) {
    body.push(
      { type: "separator", margin: "lg", color: "#EDEDF2" },
      {
        type: "text",
        text: "ใช้จ่ายเยอะสุด",
        size: "md",
        weight: "bold",
        color: "#5B5F6B",
        margin: "lg",
      },
    );
    data.topExpenses.forEach((c, i) => {
      body.push({
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        spacing: "sm",
        margin: "md",
        contents: [
          { type: "text", text: c.name, size: "sm", color: TINT.strong, flex: 3, wrap: true },
          { ...bar(c.percent, barColor(i)), flex: 3 },
          {
            type: "text",
            text: `${money(c.amountSatang)} · ${c.percent}%`,
            size: "sm",
            color: TINT.strong,
            align: "end",
            flex: 4,
          },
        ],
      });
    });
  }

  if (change !== null) {
    const up = change > 0;
    body.push({
      type: "text",
      text:
        change === 0
          ? `รายจ่ายเท่ากับ${against}`
          : `รายจ่าย${up ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(change)}% จาก${against}`,
      size: "xs",
      color: up ? COLOR.expense : COLOR.income,
      wrap: true,
      margin: "lg",
    });
  }
  body.push({
    type: "text",
    text: `📝 จดไว้ ${data.current.count} รายการ`,
    size: "sm",
    color: COLOR.muted,
    margin: "md",
  });

  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: cardHeader(title, [subtitle], "📅"),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const foot = pillFooter("ดูรายละเอียด ➡️", input.liffUrl);
  if (foot) bubble.footer = foot;
  return {
    type: "flex",
    altText: `${title} ${subtitle}: รายรับ ${money(data.current.income)} รายจ่าย ${money(data.current.expense)}`,
    contents: bubble,
  };
}
