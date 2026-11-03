import type { Insight } from "@/lib/insight";
import type { LineMessage } from "@/lib/types";
import { cardHeader, pillFooter, TINT } from "./card-style";
import { COLOR } from "./flex";
import { HOME_CURRENCIES, symbolOf } from "@/lib/currency";
import { t } from "@/lib/i18n";

/** The soft tints the observations take in turn (lavender, peach, sky). */
const LINE_TINTS = [
  { bg: TINT.lavender, accent: "#7E22CE" },
  { bg: TINT.peach, accent: "#C2410C" },
  { bg: TINT.cool, accent: "#1D4ED8" },
] as const;

/** An amount after a currency sign (฿, $, €, RM, kr …): the signs of every currency we offer. */
const SIGNS = [...new Set(HOME_CURRENCIES.map((c) => symbolOf(c).trim()))]
  .sort((a, b) => b.length - a.length)
  .map((sign) => sign.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&"));
const AMOUNT = new RegExp(`((?:${SIGNS.join("|")})\\s?[\\d,]+(?:\\.\\d+)?)`, "g");
const IS_AMOUNT = new RegExp(`^(?:${SIGNS.join("|")})\\s?\\d`);

/** A sentence as text spans, with each amount (฿1,234, $12) picked out in the tint's accent colour. */
function highlighted(line: string, accent: string) {
  const parts = line.split(AMOUNT).filter((p) => p !== "");
  return {
    type: "text",
    wrap: true,
    size: "sm",
    color: TINT.strong,
    contents: parts.map((part) =>
      IS_AMOUNT.test(part)
        ? { type: "span", text: part, weight: "bold", color: accent }
        : { type: "span", text: part },
    ),
  };
}

/** "AI Insight": a few observations about the spending, one tip, and where they came from. */
export function buildInsightCard(input: {
  insight: Insight;
  /** e.g. "1 ต.ค. – 17 ต.ค. เทียบ 1 ก.ย. – 17 ก.ย." */
  subtitle: string;
  moreUrl?: string;
}): LineMessage {
  const { insight } = input;
  const body: unknown[] = insight.lines.map((line, i) => {
    const tint = LINE_TINTS[i % LINE_TINTS.length] ?? LINE_TINTS[0];
    return {
      type: "box",
      layout: "vertical",
      margin: i === 0 ? "none" : "md",
      paddingAll: "12px",
      cornerRadius: "14px",
      backgroundColor: tint.bg,
      contents: [highlighted(line, tint.accent)],
    };
  });

  if (insight.tip) {
    body.push({
      type: "box",
      layout: "vertical",
      margin: "md",
      spacing: "xs",
      paddingAll: "12px",
      cornerRadius: "14px",
      backgroundColor: TINT.warm,
      contents: [
        { type: "text", text: "💡 คำแนะนำเพื่อคุณ", weight: "bold", size: "sm", color: "#7A4B00" },
        { type: "text", text: insight.tip, size: "sm", color: TINT.strong, wrap: true },
      ],
    });
  }
  body.push({
    type: "text",
    text:
      insight.source === "ai"
        ? t("สร้างโดย AI จากตัวเลขของคุณ เป็นข้อสังเกตและคำแนะนำทั่วไป ไม่ใช่คำแนะนำทางการเงินส่วนบุคคล")
        : t("สรุปจากตัวเลขของคุณ เป็นข้อสังเกตทั่วไป ไม่ใช่คำแนะนำทางการเงินส่วนบุคคล"),
    size: "xs",
    color: COLOR.muted,
    wrap: true,
    margin: "lg",
  });

  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: cardHeader("AI Insight ✨", [input.subtitle], "🧠"),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const foot = pillFooter(t("ดูรายละเอียดในแอป ➡️"), input.moreUrl);
  if (foot) bubble.footer = foot;
  return {
    type: "flex",
    altText: `AI Insight: ${insight.lines[0] ?? "วิเคราะห์การใช้จ่าย"}`,
    contents: bubble,
  };
}
