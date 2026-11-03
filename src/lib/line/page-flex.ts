import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";

export const PAGE_INFO = {
  summary: { title: "สรุป", hint: "ภาพรวมรายรับรายจ่ายและงบ" },
  transactions: { title: "รายการ", hint: "ดู ค้นหา แก้ไข และส่งออกรายการทั้งหมด" },
  budgets: { title: "หมวดและงบ", hint: "ตั้งงบ จัดการหมวดหมู่" },
  analytics: { title: "วิเคราะห์", hint: "กราฟและเปรียบเทียบการใช้จ่าย" },
} as const;

export type PageKey = keyof typeof PAGE_INFO;

/** A small card with one button that opens a page of the app (for the pages not on the menu). */
export function buildOpenPageCard(page: PageKey, url: string): LineMessage {
  const info = PAGE_INFO[page];
  return {
    type: "flex",
    altText: `เปิดหน้า${info.title}`,
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
