import type { LineMessage } from "@/lib/types";
import { t } from "@/lib/i18n";

/** The summaries offered when someone types just "สรุป" (each button sends its own command). */
export const SUMMARY_MENU_TEXT =
  t("อยากดูสรุปแบบไหน? เลือกได้เลย หรือพิมพ์ช่วงเอง เช่น สรุป 20/10-30/10");

export const SUMMARY_MENU_ITEMS = [
  { label: t("📅 วันนี้"), text: t("สรุปวันนี้") },
  { label: t("🗓️ เมื่อวาน"), text: t("สรุปเมื่อวาน") },
  { label: t("📆 สัปดาห์นี้"), text: t("สรุปสัปดาห์นี้") },
  { label: t("📆 สัปดาห์ที่แล้ว"), text: t("สรุปสัปดาห์ที่แล้ว") },
  { label: t("🗓️ เดือนนี้"), text: t("สรุปเดือนนี้") },
  { label: t("🗓️ เดือนที่แล้ว"), text: t("สรุปเดือนที่แล้ว") },
  { label: t("🏷️ ตามหมวด"), text: t("สรุปหมวด") },
  { label: t("⚖️ เทียบเดือนก่อน"), text: t("เทียบเดือน") },
  { label: t("📊 ปีนี้"), text: t("สรุปปีนี้") },
  { label: t("📌 เลือกช่วงวันที่"), text: t("สรุปช่วง") },
] as const;

/** A question with the summaries as quick replies, and a last button that opens the summary page. */
export function buildSummaryMenu(pageUrl: string | undefined): LineMessage {
  return {
    type: "text",
    text: SUMMARY_MENU_TEXT,
    quickReply: {
      items: [
        ...SUMMARY_MENU_ITEMS.map((i) => ({
          type: "action",
          action: { type: "message", label: i.label, text: i.text },
        })),
        ...(pageUrl?.startsWith("https://")
          ? [{ type: "action", action: { type: "uri", label: "🖥️ เปิดหน้าสรุป", uri: pageUrl } }]
          : []),
      ],
    },
  };
}
