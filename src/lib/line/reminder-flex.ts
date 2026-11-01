import type { LineMessage } from "@/lib/types";
import { describeReminder, type Repeat } from "@/lib/user-reminder";
import { COLOR } from "./flex";

export interface ReminderCardInput {
  id: string;
  body: string;
  remindAt: Date;
  repeat: Repeat | null;
  /** No time was given, so the usual morning time was used. */
  timeDefaulted: boolean;
  /** A time alone had already gone by today, so it was set for tomorrow. */
  rolledToTomorrow?: boolean;
  /** The LIFF reminders page (the "ดูเตือนทั้งหมด" button is left out without it). */
  listUrl?: string;
}

/** "Reminder set" card: what, when, and a button to cancel it. */
export function buildReminderCard(input: ReminderCardInput): LineMessage {
  return {
    type: "flex",
    altText: `ตั้งเตือนแล้ว: ${input.body}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "14px",
        contents: [
          { type: "text", text: "ตั้งเตือนแล้ว ⏰", weight: "bold", size: "lg", color: "#0B5D4F" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: input.body,
            weight: "bold",
            size: "lg",
            wrap: true,
            color: COLOR.text,
          },
          {
            type: "text",
            text: describeReminder(input.remindAt, input.repeat),
            size: "md",
            color: COLOR.primary,
            weight: "bold",
            wrap: true,
          },
          ...(input.rolledToTomorrow
            ? [
                {
                  type: "text",
                  text: "เวลานี้ของวันนี้ผ่านไปแล้ว เลยตั้งเป็นพรุ่งนี้ (ถ้าไม่ใช่ ยกเลิกแล้วตั้งใหม่ได้)",
                  size: "xs",
                  color: COLOR.muted,
                  wrap: true,
                },
              ]
            : []),
          ...(input.timeDefaulted
            ? [
                {
                  type: "text",
                  text: "ไม่ได้ระบุเวลา เลยใช้ 09:00 (อยากเปลี่ยน ยกเลิกแล้วตั้งใหม่พร้อมเวลา)",
                  size: "xs",
                  color: COLOR.muted,
                  wrap: true,
                },
              ]
            : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        spacing: "sm",
        contents: [
          ...(input.listUrl
            ? [
                {
                  type: "button",
                  style: "primary",
                  height: "sm",
                  color: COLOR.primary,
                  action: { type: "uri", label: "ดูเตือนทั้งหมด", uri: input.listUrl },
                },
              ]
            : []),
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "ยกเลิกเตือนนี้",
              data: `a=rmx&id=${input.id}`,
              displayText: "ยกเลิกเตือนนี้",
            },
          },
        ],
      },
    },
  };
}
