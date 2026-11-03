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
  /** What the cancel button sends (a group's reminder has its own). */
  cancelData?: string;
  /** The card's title (a group's reminder says so). */
  title?: string;
  /** "Add to calendar" links (a group's reminder): Google Calendar, and an .ics for the phone. */
  calendar?: { google: string; ics: string };
}

/** "Reminder set" card: what, when, and a button to cancel it. */
export function buildReminderCard(input: ReminderCardInput): LineMessage {
  return {
    type: "flex",
    altText: `ตั้งเตือนแล้ว: ${input.body}`,
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
            text: input.title ?? "ตั้งเตือนแล้ว ⏰",
            weight: "bold",
            size: "lg",
            color: "#0B5D4F",
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
            text: input.body,
            weight: "bold",
            size: "md",
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
          ...(input.calendar
            ? [
                {
                  type: "box",
                  layout: "horizontal",
                  spacing: "sm",
                  contents: [
                    {
                      type: "button",
                      style: "secondary",
                      height: "sm",
                      action: { type: "uri", label: "📅 Google", uri: input.calendar.google },
                    },
                    {
                      type: "button",
                      style: "secondary",
                      height: "sm",
                      action: { type: "uri", label: "📅 iPhone", uri: input.calendar.ics },
                    },
                  ],
                },
                {
                  type: "text",
                  text: "เพิ่มลงปฏิทินในมือถือ ให้มือถือเตือนเองตรงเวลา",
                  size: "xs",
                  color: COLOR.muted,
                  wrap: true,
                  align: "center",
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
              data: input.cancelData ?? `a=rmx&id=${input.id}`,
              displayText: "ยกเลิกเตือนนี้",
            },
          },
        ],
      },
    },
  };
}

/** The buttons that pop up under a reminder when it arrives: done, or remind me again later. */
export function reminderActions(id: string) {
  const picks: [label: string, data: string][] = [
    ["✅ ทำแล้ว", `a=rmd&id=${id}`],
    ["⏰ อีก 10 นาที", `a=rms&id=${id}&s=10`],
    ["⏰ อีก 1 ชม.", `a=rms&id=${id}&s=60`],
    ["🌅 พรุ่งนี้เช้า", `a=rms&id=${id}&s=tm`],
  ];
  return {
    items: picks.map(([label, data]) => ({
      type: "action",
      action: { type: "postback", label, data, displayText: label },
    })),
  };
}
