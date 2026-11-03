import type { LineMessage } from "@/lib/types";
import { REPEAT_LABEL, type Repeat } from "@/lib/user-reminder";
import { bangkokParts, formatThaiDate, fromBangkok } from "@/lib/thai-date";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

export interface ReminderCardInput {
  id: string;
  body: string;
  remindAt: Date;
  repeat: Repeat | null;
  /** No time was given, so the usual morning time was used. */
  timeDefaulted: boolean;
  /** A time alone had already gone by today, so it was set for tomorrow. */
  rolledToTomorrow?: boolean;
  /** The LIFF reminders page, where the time is changed (the "เปลี่ยนเวลา" button is left out without it). */
  listUrl?: string;
  /** What the cancel button sends (a group's reminder has its own). */
  cancelData?: string;
  /** The card's title (a group's reminder says so). */
  title?: string;
  /** "Add to calendar" links (a group's reminder): Google Calendar, and an .ics for the phone. */
  calendar?: { google: string; ics: string };
  /** Now, to say "วันนี้" / "พรุ่งนี้" beside the time. */
  now?: Date;
}

const INK = "#0B5D4F";
const LINE = "#CBD5E1";

/** "Reminder set" card: what, the time large with its day, and buttons to change the time or cancel. */
export function buildReminderCard(input: ReminderCardInput): LineMessage {
  const now = input.now ?? new Date();
  const p = bangkokParts(input.remindAt);
  const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const notes = [
    ...(input.rolledToTomorrow
      ? [t("เวลานี้ของวันนี้ผ่านไปแล้ว เลยตั้งเป็นพรุ่งนี้ (ถ้าไม่ใช่ ยกเลิกแล้วตั้งใหม่ได้)")]
      : []),
    ...(input.timeDefaulted
      ? [t("ไม่ได้ระบุเวลา เลยใช้ 09:00 (อยากเปลี่ยน ยกเลิกแล้วตั้งใหม่พร้อมเวลา)")]
      : []),
  ];
  return {
    type: "flex",
    altText: t("ตั้งเตือนแล้ว: {0}", input.body),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "horizontal",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: input.title ?? t("ตั้งเตือนแล้ว"),
            weight: "bold",
            size: "md",
            color: INK,
            flex: 1,
          },
          {
            type: "text",
            text: input.repeat ? REPEAT_LABEL[input.repeat] : t("ครั้งเดียว"),
            size: "sm",
            color: INK,
            align: "end",
            gravity: "center",
            flex: 0,
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
            color: COLOR.text,
            wrap: true,
          },
          {
            type: "box",
            layout: "baseline",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: clock,
                size: "lg",
                weight: "bold",
                color: COLOR.primary,
                flex: 0,
              },
              {
                type: "text",
                text: dayLabel(input.remindAt, input.repeat, now),
                size: "sm",
                color: COLOR.muted,
                flex: 0,
              },
            ],
          },
          ...notes.map((text) => ({
            type: "text",
            text,
            size: "xs",
            color: COLOR.muted,
            wrap: true,
          })),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "12px",
        paddingTop: "0px",
        spacing: "sm",
        contents: [
          ...(input.calendar
            ? [
                {
                  type: "box",
                  layout: "horizontal",
                  spacing: "sm",
                  contents: [
                    pill("📅 Google", {
                      type: "uri",
                      label: "📅 Google",
                      uri: input.calendar.google,
                    }),
                    pill("📅 iPhone", { type: "uri", label: "📅 iPhone", uri: input.calendar.ics }),
                  ],
                },
                {
                  type: "text",
                  text: t("เพิ่มลงปฏิทินในมือถือ ให้มือถือเตือนเองตรงเวลา"),
                  size: "xs",
                  color: COLOR.muted,
                  wrap: true,
                  align: "center",
                },
              ]
            : []),
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              ...(input.listUrl
                ? [
                    pill(t("เปลี่ยนเวลา"), {
                      type: "uri",
                      label: t("เปลี่ยนเวลา"),
                      uri: input.listUrl,
                    }),
                  ]
                : []),
              pill(
                t("ยกเลิก"),
                {
                  type: "postback",
                  label: t("ยกเลิกเตือนนี้"),
                  data: input.cancelData ?? `a=rmx&id=${input.id}`,
                  displayText: t("ยกเลิกเตือนนี้"),
                },
                COLOR.muted,
              ),
            ],
          },
        ],
      },
    },
  };
}

/** An outlined, rounded button. */
function pill(label: string, action: Record<string, unknown>, color = "#334155") {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    cornerRadius: "20px",
    borderWidth: "1px",
    borderColor: LINE,
    paddingAll: "8px",
    action,
    contents: [{ type: "text", text: label, align: "center", size: "sm", weight: "bold", color }],
  };
}

const WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

/** Beside the time: "วันนี้", "พรุ่งนี้" or the date; for a repeating one, which days. */
function dayLabel(at: Date, repeat: Repeat | null, now: Date): string {
  const p = bangkokParts(at);
  if (repeat === "daily") return t("ทุกวัน");
  if (repeat === "weekly") return t("ทุกวัน{0}", t(WEEKDAYS[p.weekday] ?? ""));
  if (repeat === "monthly") return t("ทุกวันที่ {0}", p.day);
  const today = bangkokParts(now);
  const same = (a: typeof p, b: typeof p) =>
    a.year === b.year && a.month === b.month && a.day === b.day;
  if (same(p, today)) return t("วันนี้");
  if (same(p, bangkokParts(fromBangkok(today.year, today.month, today.day + 1)))) {
    return t("พรุ่งนี้");
  }
  return formatThaiDate(at);
}

/** The buttons that pop up under a reminder when it arrives: done, or remind me again later. */
export function reminderActions(id: string) {
  const picks: [label: string, data: string][] = [
    [t("✅ ทำแล้ว"), `a=rmd&id=${id}`],
    [t("⏰ อีก 10 นาที"), `a=rms&id=${id}&s=10`],
    [t("⏰ อีก 1 ชม."), `a=rms&id=${id}&s=60`],
    [t("🌅 พรุ่งนี้เช้า"), `a=rms&id=${id}&s=tm`],
  ];
  return {
    items: picks.map(([label, data]) => ({
      type: "action",
      action: { type: "postback", label, data, displayText: label },
    })),
  };
}
