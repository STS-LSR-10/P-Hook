import { money } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage, TxType } from "@/lib/types";
import { COLOR, row } from "./flex";
import { t } from "@/lib/i18n";

export interface VoiceCardInput {
  txId: string;
  type: TxType;
  title: string;
  amountSatang: number;
  categoryName: string | null;
  occurredAt: Date;
  /** "voice": heard from a voice note. "ai": a long typed sentence the AI helped read. */
  variant?: "voice" | "ai";
}

/**
 * "Did I hear you right?" card for a voice entry. Nothing is saved until the person taps
 * "จดเลย" (the pending entry is confirmed by the same `sc` step as a checked slip).
 */
export function buildVoiceCard(input: VoiceCardInput): LineMessage {
  const ai = input.variant === "ai";
  const income = input.type === "income";
  const amountText = `${income ? "+" : "-"}${money(input.amountSatang)}`;

  const button = (
    label: string,
    action: string,
    style: "primary" | "secondary" | "link",
    color?: string,
  ) => ({
    type: "button",
    style,
    height: "sm",
    ...(color ? { color } : {}),
    action: {
      type: "postback",
      label,
      data: `a=${action}&id=${input.txId}`,
      displayText: label,
    },
  });

  return {
    type: "flex",
    altText: `${ai ? "ตรวจรายการที่ AI อ่านให้" : "ตรวจรายการจากเสียง"}: ${input.title} ${amountText}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: ai
              ? t("ตรวจรายการที่ AI อ่านให้ — ยังไม่ได้จด")
              : t("ตรวจรายการจากเสียง — ยังไม่ได้จด"),
            weight: "bold",
            color: COLOR.primary,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "12px",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: input.title,
            weight: "bold",
            size: "md",
            wrap: true,
            color: COLOR.text,
          },
          {
            type: "text",
            text: amountText,
            weight: "bold",
            size: "lg",
            color: income ? COLOR.income : COLOR.expense,
          },
          row(t("ประเภท"), income ? t("รายรับ") : t("รายจ่าย")),
          row(t("หมวด (เดา)"), input.categoryName ?? t("ไม่ระบุหมวด")),
          row(t("วันเวลา"), formatThaiDate(input.occurredAt, true)),
          {
            type: "text",
            text: ai
              ? t("AI อ่านผิด? กดยกเลิกแล้วพิมพ์ใหม่ให้สั้นลง หรือแก้หมวดได้เลย")
              : t("ฟังผิด? กดยกเลิกแล้วพูดใหม่ หรือพิมพ์จดเองได้เลย"),
            size: "xs",
            color: COLOR.muted,
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        spacing: "sm",
        contents: [
          button(t("จดเลย"), "sc", "primary", COLOR.primary),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              button(t("เปลี่ยนหมวด"), "se", "secondary"),
              button(t("ยกเลิก"), ai ? "ax" : "vx", "secondary"),
            ],
          },
        ],
      },
    },
  };
}
