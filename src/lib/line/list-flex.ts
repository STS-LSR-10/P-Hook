import { formatBaht } from "@/lib/money";
import { noteTitle, type NoteDto } from "@/lib/note";
import { bangkokParts, formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import type { Repeat } from "@/lib/user-reminder";
import { compactFooter, compactHeader } from "./card-style";
import { COLOR } from "./flex";
import { dayLabel } from "./reminder-flex";
import { t } from "@/lib/i18n";

/** A narrow card: the one-row header, rows in its body and (with a link) a small button at the foot. */
function listCard(input: {
  title: string;
  /** A few words at the right of the title ("3 โน้ต"). */
  right: string;
  /** A small picture before the title. */
  icon?: string;
  altText: string;
  rows: unknown[];
  button?: { label: string; uri: string | undefined };
}): LineMessage {
  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "kilo",
    header: compactHeader(input.title, input.right, input.icon),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: input.rows },
  };
  const footer = input.button ? compactFooter(input.button.label, input.button.uri) : undefined;
  if (footer) bubble.footer = footer;
  return { type: "flex", altText: input.altText, contents: bubble };
}

const muted = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  text,
  size: "xs",
  color: COLOR.muted,
  wrap: true,
  ...extra,
});

/** Rows with a separator between them. */
const separated = (rows: unknown[][]): unknown[] =>
  rows.flatMap((row, i) => (i === 0 ? [row] : [{ type: "separator", margin: "md" }, row])).flat();

/** "โน้ตล่าสุด" / "โน้ตที่มี …": each note's first line with its day, and a button to all of them. */
export function buildNoteListCard(input: {
  title: string;
  items: Pick<NoteDto, "body" | "createdAt">[];
  url: string | undefined;
  /** There are more than the ones shown. */
  more?: boolean;
}): LineMessage {
  const rows = input.items.map((n, i) => [
    {
      type: "box",
      layout: "vertical",
      margin: i === 0 ? "none" : "md",
      spacing: "xs",
      contents: [
        muted(formatThaiDate(new Date(n.createdAt))),
        { type: "text", text: noteTitle(n.body, 50), size: "md", color: COLOR.text, wrap: true },
      ],
    },
  ]);
  const body = separated(rows);
  if (input.more) body.push(muted(t("ยังมีอีก ดูทั้งหมดได้ในแอป"), { margin: "lg" }));
  return listCard({
    title: input.title,
    right: t("{0} โน้ต", input.items.length),
    icon: "📒",
    altText: `${input.title}: ${input.items.length}`,
    rows: body,
    button: { label: t("ดูโน้ตทั้งหมด"), uri: input.url },
  });
}

/** "เตือนกลุ่ม": the group's reminders, numbered so that "ยกเลิกเตือน 2" can name one. */
export function buildGroupRemindersCard(input: {
  items: { id: string; body: string; remindAt: string; repeat: Repeat | null }[];
  now?: Date;
}): LineMessage {
  const now = input.now ?? new Date();
  const rows = input.items.map((r, i) => {
    const at = new Date(r.remindAt);
    const p = bangkokParts(at);
    const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    return [
      {
        type: "box",
        layout: "horizontal",
        margin: i === 0 ? "none" : "md",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: String(i + 1),
            size: "md",
            weight: "bold",
            color: COLOR.muted,
            flex: 0,
          },
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            spacing: "xs",
            contents: [
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
                    text: dayLabel(at, r.repeat, now),
                    size: "sm",
                    color: COLOR.muted,
                    wrap: true,
                  },
                ],
              },
              { type: "text", text: r.body, size: "md", color: COLOR.text, wrap: true },
            ],
          },
        ],
      },
    ];
  });
  const body = separated(rows);
  body.push(
    muted(t('ยกเลิก พิมพ์ "ยกเลิกเตือน" ตามด้วยเลข เช่น "ยกเลิกเตือน 1"'), { margin: "lg" }),
  );
  return listCard({
    title: t("เตือนของกลุ่ม"),
    icon: "⏰",
    right: t("{0} รายการ", input.items.length),
    altText: t("เตือนของกลุ่ม {0} รายการ", input.items.length),
    rows: body,
  });
}

/** "รายการล่าสุด" of a group: what, how much, and who paid. */
export function buildGroupRecentCard(
  items: { title: string; amountSatang: number; payer: string }[],
): LineMessage {
  const rows = items.map((e, i) => [
    {
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "none" : "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 5,
          spacing: "xs",
          contents: [
            { type: "text", text: e.title, size: "md", color: COLOR.text, wrap: true },
            muted(e.payer),
          ],
        },
        {
          type: "text",
          text: `฿${formatBaht(e.amountSatang)}`,
          size: "md",
          weight: "bold",
          color: COLOR.expense,
          align: "end",
          flex: 3,
        },
      ],
    },
  ]);
  return listCard({
    title: t("รายการล่าสุดของกลุ่ม"),
    right: t("{0} รายการ", items.length),
    altText: t("รายการล่าสุดของกลุ่ม {0} รายการ", items.length),
    rows: separated(rows),
  });
}

/** "ทริปที่จบแล้ว": each trip's name, the day it ended and its total. */
export function buildGroupTripsCard(
  trips: { name: string; closedAt: string | null; totalSatang: number }[],
): LineMessage {
  const rows = trips.map((trip, i) => [
    {
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "none" : "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 5,
          spacing: "xs",
          contents: [
            { type: "text", text: trip.name, size: "md", color: COLOR.text, wrap: true },
            ...(trip.closedAt ? [muted(formatThaiDate(new Date(trip.closedAt)))] : []),
          ],
        },
        {
          type: "text",
          text: `฿${formatBaht(trip.totalSatang)}`,
          size: "md",
          weight: "bold",
          color: COLOR.text,
          align: "end",
          flex: 3,
        },
      ],
    },
  ]);
  return listCard({
    title: t("ทริปที่จบแล้ว"),
    icon: "📌",
    right: t("{0} ทริป", trips.length),
    altText: t("ทริปที่จบแล้ว {0} ทริป", trips.length),
    rows: separated(rows),
  });
}
