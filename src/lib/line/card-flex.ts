import { money } from "@/lib/money";
import type { CardStatus } from "@/lib/card";
import { formatThaiDayMonth } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { walletLabel, type Wallet } from "@/lib/wallet";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

const row = (label: string, value: string, color: string = COLOR.text) => ({
  type: "box",
  layout: "horizontal",
  margin: "sm",
  contents: [
    { type: "text", text: label, size: "sm", color: COLOR.muted, flex: 5, wrap: true },
    { type: "text", text: value, size: "sm", weight: "bold", color, align: "end", flex: 4 },
  ],
});

function bar(percent: number) {
  const width = Math.min(100, Math.max(percent > 0 ? 3 : 0, percent));
  const color = percent >= 100 ? COLOR.expense : percent >= 80 ? "#D97706" : COLOR.primary;
  return {
    type: "box",
    layout: "vertical",
    height: "8px",
    cornerRadius: "4px",
    backgroundColor: "#E5EAEE",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: `${width}%`,
        height: "8px",
        cornerRadius: "4px",
        backgroundColor: color,
        contents: [],
      },
    ],
  };
}

/** "บัตร": for each credit card the amount owed, the limit left and this/last statement cycle. */
export function buildCardsCard(input: {
  cards: { wallet: Wallet; status: CardStatus }[];
  manageUrl?: string;
}): LineMessage {
  const body: unknown[] = [];
  input.cards.forEach(({ wallet, status }, i) => {
    if (i > 0) body.push({ type: "separator", margin: "lg" });
    body.push({
      type: "text",
      text: walletLabel(wallet),
      weight: "bold",
      size: "md",
      color: "#14352E",
      margin: i > 0 ? "lg" : "none",
      wrap: true,
    });
    body.push(
      row(
        t("ยอดค้างชำระ"),
        money(status.owedSatang),
        status.owedSatang > 0 ? COLOR.expense : COLOR.income,
      ),
    );
    if (status.limitSatang !== null && status.availableSatang !== null) {
      body.push(row(t("วงเงิน"), money(status.limitSatang)));
      body.push(
        row(
          status.availableSatang < 0 ? t("เกินวงเงิน") : t("วงเงินคงเหลือ"),
          money(Math.abs(status.availableSatang)),
          status.availableSatang < 0 ? COLOR.expense : COLOR.income,
        ),
      );
      if (status.usedPercent !== null) {
        body.push(bar(status.usedPercent));
        body.push({
          type: "text",
          text: t("ใช้วงเงินไป {0}%", status.usedPercent),
          size: "xs",
          color: COLOR.muted,
          margin: "sm",
        });
      }
    }
    if (status.cycle) {
      body.push(row(t("ยอดใช้รอบนี้"), money(status.cycleSpentSatang)));
      body.push(row(t("ยอดใช้รอบที่แล้ว"), money(status.previousCycleSpentSatang)));
    }
    if (status.nextStatement)
      body.push(row(t("ตัดรอบบิลถัดไป"), formatThaiDayMonth(status.nextStatement)));
    if (status.nextDue) body.push(row(t("ครบกำหนดชำระ"), formatThaiDayMonth(status.nextDue)));
  });

  return {
    type: "flex",
    altText: t("บัตรเครดิต {0} ใบ", input.cards.length),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          { type: "text", text: "บัตรเครดิต", weight: "bold", size: "lg", color: "#0B5D4F" },
        ],
      },
      body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
      ...(input.manageUrl?.startsWith("https://")
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  color: COLOR.primary,
                  height: "sm",
                  action: { type: "uri", label: "ตั้งวงเงิน/วันตัดรอบ", uri: input.manageUrl },
                },
              ],
            },
          }
        : {}),
    },
  };
}
