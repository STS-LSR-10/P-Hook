import type { TxDto } from "@/lib/dto";
import { money } from "@/lib/money";
import type { SearchTotals } from "@/lib/search";
import { formatThaiDayMonth } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

const row = (label: string, value: string, color: string) => ({
  type: "box",
  layout: "horizontal",
  contents: [
    { type: "text", text: label, size: "sm", color: COLOR.muted, flex: 3 },
    { type: "text", text: value, size: "md", weight: "bold", color, align: "end", flex: 5 },
  ],
});

const MAX_SHOWN = 5;

/** Result card for "ค้นหา …": totals of everything found, the newest matches, a link to the rest. */
export function buildSearchCard(input: {
  /** The text as typed ("กาแฟ" or "#ปาร์ตี้"). */
  term: string;
  totals: SearchTotals;
  items: TxDto[];
  /** Opens the entries list with the same search (omitted when unknown). */
  moreUrl?: string;
}): LineMessage {
  const { term, totals, items } = input;
  const net = totals.incomeSatang - totals.expenseSatang;

  const body: unknown[] = [
    row(t("รายรับ"), `+${money(totals.incomeSatang)}`, COLOR.income),
    row(t("รายจ่าย"), `-${money(totals.expenseSatang)}`, COLOR.expense),
    row(
      t("สุทธิ"),
      `${net < 0 ? "-" : ""}${money(Math.abs(net))}`,
      net < 0 ? COLOR.expense : COLOR.income,
    ),
    {
      type: "text",
      text: t("พบ {0} รายการ", totals.count),
      size: "xs",
      color: COLOR.muted,
      margin: "sm",
    },
  ];

  const shown = items.slice(0, MAX_SHOWN);
  if (shown.length > 0) {
    body.push(
      { type: "separator", margin: "lg" },
      { type: "text", text: "ล่าสุด", size: "xs", color: COLOR.muted, margin: "lg" },
    );
    for (const tx of shown) {
      const income = tx.type === "income";
      body.push({
        type: "box",
        layout: "horizontal",
        margin: "sm",
        contents: [
          {
            type: "text",
            text: `${formatThaiDayMonth(new Date(tx.occurredAt))} ${tx.title}`,
            size: "sm",
            color: COLOR.text,
            flex: 5,
            wrap: true,
          },
          {
            type: "text",
            text: `${income ? "+" : "-"}${money(tx.amountSatang)}`,
            size: "sm",
            color: income ? COLOR.income : COLOR.expense,
            align: "end",
            flex: 3,
          },
        ],
      });
    }
    if (totals.count > shown.length) {
      body.push({
        type: "text",
        text: t("และอีก {0} รายการ", totals.count - shown.length),
        size: "xs",
        color: COLOR.muted,
        margin: "sm",
      });
    }
  }

  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#CCFBF1",
      paddingAll: "12px",
      contents: [
        { type: "text", text: "ผลการค้นหา", weight: "bold", size: "lg", color: "#0B5D4F" },
        { type: "text", text: term, size: "sm", color: "#3F6B63", margin: "xs", wrap: true },
      ],
    },
    body: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: body },
  };
  if (input.moreUrl?.startsWith("https://")) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#0F766E",
          height: "sm",
          action: { type: "uri", label: "ดูทั้งหมดในแอป", uri: input.moreUrl },
        },
      ],
    };
  }
  return {
    type: "flex",
    altText: t("ค้นหา {0}: พบ {1} รายการ รายจ่าย {2}", term, totals.count, money(totals.expenseSatang)),
    contents: bubble,
  };
}
