import { dueState, type PersonTotal } from "@/lib/debt";
import { money } from "@/lib/money";
import { formatThaiDayMonth } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";

const baht = (satang: number) => money(satang);

function section(title: string, color: string, people: PersonTotal[], total: number, now: Date) {
  const rows = people.slice(0, 8).map((p) => {
    const state = dueState(p.dueAt, now);
    const sub =
      p.dueAt && state !== "none"
        ? `${state === "overdue" ? "เลยกำหนด " : "ครบ "}${formatThaiDayMonth(new Date(p.dueAt))}`
        : null;
    return {
      type: "box",
      layout: "horizontal",
      margin: "sm",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 5,
          contents: [
            { type: "text", text: p.person, size: "sm", color: COLOR.text, wrap: true },
            ...(sub
              ? [
                  {
                    type: "text",
                    text: sub,
                    size: "xs",
                    color: state === "overdue" ? COLOR.expense : COLOR.muted,
                  },
                ]
              : []),
          ],
        },
        {
          type: "text",
          text: baht(p.remainingSatang),
          size: "sm",
          weight: "bold",
          color,
          align: "end",
          flex: 4,
        },
      ],
    };
  });
  return [
    {
      type: "box",
      layout: "horizontal",
      margin: "lg",
      contents: [
        { type: "text", text: title, weight: "bold", size: "md", flex: 5 },
        {
          type: "text",
          text: baht(total),
          weight: "bold",
          size: "md",
          color,
          align: "end",
          flex: 4,
        },
      ],
    },
    ...rows,
    ...(people.length > 8
      ? [
          {
            type: "text",
            text: `และอีก ${people.length - 8} คน`,
            size: "xs",
            color: COLOR.muted,
            margin: "sm",
          },
        ]
      : []),
  ];
}

/** "หนี้": who owes me and whom I owe, per person, with due dates. */
export function buildDebtsCard(input: {
  people: PersonTotal[];
  now: Date;
  manageUrl?: string;
}): LineMessage {
  const lent = input.people.filter((p) => p.direction === "lent");
  const borrowed = input.people.filter((p) => p.direction === "borrowed");
  const sum = (list: PersonTotal[]) => list.reduce((s, p) => s + p.remainingSatang, 0);
  const body: unknown[] = [];
  if (lent.length > 0)
    body.push(...section("คนที่ติดเรา", COLOR.income, lent, sum(lent), input.now));
  if (borrowed.length > 0) {
    body.push(...section("เราติดใคร", COLOR.expense, borrowed, sum(borrowed), input.now));
  }
  body.push({
    type: "text",
    text: 'พิมพ์ "สมชายคืน 200" เมื่อได้เงินคืน หรือ "คืนแม่ 1000" เมื่อเราคืนเงิน',
    size: "xs",
    color: COLOR.muted,
    wrap: true,
    margin: "lg",
  });
  return {
    type: "flex",
    altText: `หนี้สิน: ติดเรา ${baht(sum(lent))} · เราติด ${baht(sum(borrowed))}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [{ type: "text", text: "หนี้สิน", weight: "bold", size: "lg", color: "#0B5D4F" }],
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
                  action: { type: "uri", label: "จัดการหนี้", uri: input.manageUrl },
                },
              ],
            },
          }
        : {}),
    },
  };
}

/** A confirmation text with a Quick Reply that undoes it. */
export function buildDebtDone(input: { text: string; undoData: string }): LineMessage {
  return {
    type: "text",
    text: input.text,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "↩ ยกเลิก",
            data: input.undoData,
            displayText: "ยกเลิก",
          },
        },
      ],
    },
  };
}
