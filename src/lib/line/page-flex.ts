import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

export const PAGE_INFO = {
  summary: { title: t("สรุป"), hint: t("ภาพรวมรายรับรายจ่ายและงบ") },
  transactions: { title: t("รายการ"), hint: t("ดู ค้นหา แก้ไข และส่งออกรายการทั้งหมด") },
  budgets: { title: t("หมวดและงบ"), hint: t("ตั้งงบ จัดการหมวดหมู่") },
  analytics: { title: t("วิเคราะห์"), hint: t("กราฟและเปรียบเทียบการใช้จ่าย") },
} as const;

export type PageKey = keyof typeof PAGE_INFO;

/** A small card with one button that opens a page of the app (for the pages not on the menu). */
export function buildOpenPageCard(page: PageKey, url: string): LineMessage {
  const info = PAGE_INFO[page];
  return {
    type: "flex",
    altText: t("เปิดหน้า{0}", info.title),
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "12px",
        spacing: "sm",
        contents: [
          { type: "text", text: info.title, weight: "bold", size: "lg", color: COLOR.text },
          { type: "text", text: info.hint, size: "xs", color: COLOR.muted, wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: COLOR.primary,
            action: { type: "uri", label: `เปิดหน้า${info.title}`, uri: url },
          },
        ],
      },
    },
  };
}
