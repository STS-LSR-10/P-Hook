import type { Forecast, Occurrence, Scenario } from "@/lib/forecast";
import { money } from "@/lib/money";
import { formatThaiDayMonth } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { cardHeader, pillFooter, TINT } from "./card-style";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

const DAY_MS = 86_400_000;
const MAX_LISTED = 4;

const tone = (satang: number) => (satang < 0 ? COLOR.expense : COLOR.income);

const row = (label: string, value: string, color: string = TINT.strong) => ({
  type: "box",
  layout: "horizontal",
  alignItems: "center",
  margin: "md",
  contents: [
    { type: "text", text: label, size: "md", color: TINT.strong, flex: 5, wrap: true },
    { type: "text", text: value, size: "md", weight: "bold", color, align: "end", flex: 5 },
  ],
});

/** A filled status pill: green when all is well, red when the money runs short. */
const statusPill = (text: string, good: boolean) => ({
  type: "box",
  layout: "horizontal",
  margin: "md",
  contents: [
    {
      type: "box",
      layout: "vertical",
      flex: 0,
      cornerRadius: "10px",
      backgroundColor: good ? "#2F9E5B" : TINT.bad,
      paddingTop: "5px",
      paddingBottom: "5px",
      paddingStart: "10px",
      paddingEnd: "10px",
      contents: [{ type: "text", text, size: "sm", weight: "bold", color: "#FFFFFF", wrap: true }],
    },
    { type: "filler" },
  ],
});

/** What-if line in a soft blue box. */
const scenarioBox = (text: string) => ({
  type: "box",
  layout: "vertical",
  margin: "lg",
  paddingAll: "12px",
  cornerRadius: "12px",
  backgroundColor: TINT.cool,
  borderWidth: "1px",
  borderColor: "#C9DAF8",
  contents: [{ type: "text", text, size: "sm", weight: "bold", color: TINT.strong, wrap: true }],
});

const note = (text: string, color: string = COLOR.muted) => ({
  type: "text",
  text,
  size: "xs",
  color,
  wrap: true,
  margin: "md",
});

/** "ประมาณ 28 ต.ค. (อีก 17 วัน)" for the first day the money runs out. */
function runOutText(date: Date, today: Date): string {
  const days = Math.round((date.getTime() - today.getTime()) / DAY_MS);
  return `${formatThaiDayMonth(date)} (${days <= 0 ? "วันนี้" : `อีก ${days} วัน`})`;
}

function scenarioLine(label: string, s: Scenario): string {
  return `${label}: ใช้วันละ ${money(s.dailyRateSatang)} → ${
    s.runsOutOn
      ? t("เงินหมด {0}", formatThaiDayMonth(s.runsOutOn))
      : t("เหลือ {0}", money(s.endBalanceSatang))
  }`;
}

function upcomingLines(items: Occurrence[], sign: "+" | "-") {
  return items
    .slice(0, MAX_LISTED)
    .map((o) =>
      row(
        `${formatThaiDayMonth(o.date)} ${o.title}`,
        `${sign}${money(o.amountSatang)}`,
        sign === "+" ? COLOR.income : COLOR.expense,
      ),
    );
}

/** "พยากรณ์เงินปลายรอบ": where this cycle's money is heading, and the day it could run out. */
export function buildForecastCard(input: {
  forecast: Forecast;
  today: Date;
  subtitle: string;
  moreUrl?: string;
}): LineMessage {
  const f = input.forecast;
  const body: unknown[] = [
    { type: "text", text: "คาดว่าสิ้นรอบจะเหลือ", size: "md", color: TINT.strong },
    {
      type: "text",
      text: money(f.endBalanceSatang),
      size: "lg",
      weight: "bold",
      color: tone(f.endBalanceSatang),
    },
  ];

  if (f.alreadyNegative) {
    body.push(statusPill(t("⚠️ ตอนนี้รายจ่ายมากกว่ารายรับของรอบนี้แล้ว"), false));
  } else if (f.runsOutOn) {
    body.push(statusPill(t("⚠️ เงินจะหมดประมาณ {0}", runOutText(f.runsOutOn, input.today)), false));
  } else {
    body.push(statusPill(t("✅ เงินพอใช้ไปถึงสิ้นรอบ 👍"), true));
  }

  body.push(
    { type: "separator", margin: "lg", color: "#EDEDF2" },
    row(t("เหลือตอนนี้"), money(f.netNowSatang), tone(f.netNowSatang)),
    row(t("ใช้จ่ายทั่วไปต่อวัน"), money(f.dailyRateSatang)),
    row(t("เหลืออีก"), t("📆 {0} วัน", f.remainingDays)),
  );

  if (f.upcomingIncomes.length > 0 || f.upcomingExpenses.length > 0) {
    body.push(
      { type: "text", text: "รายการประจำที่กำลังมา", size: "xs", color: COLOR.muted, margin: "lg" },
      ...upcomingLines(f.upcomingIncomes, "+"),
      ...upcomingLines(f.upcomingExpenses, "-"),
    );
    const hidden = f.upcomingIncomes.length + f.upcomingExpenses.length;
    const shown =
      Math.min(MAX_LISTED, f.upcomingIncomes.length) +
      Math.min(MAX_LISTED, f.upcomingExpenses.length);
    if (hidden > shown) body.push(note(t("และอีก {0} รายการ", hidden - shown)));
  }

  if (f.trend) {
    body.push(scenarioBox(scenarioLine(t("ถ้าใช้จ่ายเท่า 7 วันล่าสุด"), f.trend)));
  }

  if (f.budget) {
    const b = f.budget;
    const line = b.overNow
      ? t("งบรวม {0}: ใช้เกินงบแล้ว", money(b.limitSatang))
      : b.exhaustedOn
        ? t(
            "งบรวม {0}: คาดว่าจะใช้ {1}% และงบหมดประมาณ {2}",
            money(b.limitSatang),
            b.percent,
            runOutText(b.exhaustedOn, input.today),
          )
        : t("งบรวม {0}: คาดว่าจะใช้ {1}% ของงบ", money(b.limitSatang), b.percent);
    body.push(note(line, b.overNow || b.percent >= 100 ? COLOR.expense : COLOR.muted));
  }

  if (f.lowData) {
    body.push(
      note(t("ข้อมูลยังน้อย (ต่ำกว่า 5 วันหรือ 5 รายการ) ตัวเลขอาจคลาดเคลื่อนมาก"), COLOR.expense),
    );
  }
  body.push(
    note(
      t(
        "เป็นการประมาณจากอัตราใช้จ่ายของรอบนี้ ไม่รวมรายรับที่ยังไม่เกิดและไม่ใช่รายการประจำ (เช่น โบนัส)",
      ),
    ),
  );

  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: cardHeader(t("พยากรณ์เงินปลายรอบ"), [input.subtitle], "🐷"),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const foot = pillFooter(t("ดูสรุปในแอป 📈"), input.moreUrl);
  if (foot) bubble.footer = foot;
  return {
    type: "flex",
    altText: `พยากรณ์: สิ้นรอบจะเหลือ ${money(f.endBalanceSatang)}${
      f.runsOutOn ? t(" เงินหมดประมาณ {0}", formatThaiDayMonth(f.runsOutOn)) : ""
    }`,
    contents: bubble,
  };
}
