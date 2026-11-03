import type { GoalDto } from "@/lib/goal";
import { money } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

const baht = (satang: number) => money(satang);
const label = (g: Pick<GoalDto, "emoji" | "name">) => (g.emoji ? `${g.emoji} ${g.name}` : g.name);

function bar(percent: number, done: boolean) {
  const width = Math.min(100, Math.max(percent > 0 ? 3 : 0, percent));
  return {
    type: "box",
    layout: "vertical",
    height: "8px",
    cornerRadius: "4px",
    backgroundColor: "#E5EAEE",
    margin: "sm",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: `${width}%`,
        height: "8px",
        cornerRadius: "4px",
        backgroundColor: done ? COLOR.income : COLOR.primary,
        contents: [],
      },
    ],
  };
}

/** "เป้าหมาย": every live goal with a bar, what is saved and what a month must bring to make the date. */
export function buildGoalsCard(input: { goals: GoalDto[]; manageUrl?: string }): LineMessage {
  const body: unknown[] = [];
  input.goals.slice(0, 8).forEach((g, i) => {
    if (i > 0) body.push({ type: "separator", margin: "lg" });
    body.push(
      {
        type: "box",
        layout: "horizontal",
        margin: i > 0 ? "lg" : "none",
        contents: [
          {
            type: "text",
            text: label(g),
            weight: "bold",
            size: "md",
            color: "#14352E",
            wrap: true,
            flex: 5,
          },
          {
            type: "text",
            text: g.done ? t("ครบแล้ว 🎉") : `${g.percent}%`,
            weight: "bold",
            size: "md",
            color: g.done ? COLOR.income : COLOR.primary,
            align: "end",
            flex: 3,
          },
        ],
      },
      bar(g.percent, g.done),
      {
        type: "text",
        text: `${baht(g.savedSatang)} จาก ${baht(g.targetSatang)}${g.done ? "" : ` · เหลือ ${baht(g.remainingSatang)}`}`,
        size: "xs",
        color: COLOR.muted,
        margin: "sm",
        wrap: true,
      },
    );
    if (g.dueOn && !g.done) {
      const [y, m, d] = g.dueOn.split("-").map(Number);
      const due = formatThaiDate(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 5)));
      body.push({
        type: "text",
        text: g.overdue
          ? t("เลยกำหนด {0} แล้ว", due)
          : `ภายใน ${due}${g.monthlyNeededSatang !== null ? ` · เก็บเดือนละ ${baht(g.monthlyNeededSatang)}` : ""}`,
        size: "xs",
        color: g.overdue ? COLOR.expense : COLOR.muted,
        wrap: true,
      });
    }
  });
  if (input.goals.length > 8) {
    body.push({
      type: "text",
      text: t("และอีก {0} เป้าหมาย", input.goals.length - 8),
      size: "xs",
      color: COLOR.muted,
      margin: "md",
    });
  }
  body.push({
    type: "text",
    text: t("หยอดกระปุกด้วย \"ออม ชื่อเป้าหมาย 2000\" ถอนด้วย \"ถอน ชื่อเป้าหมาย 500\""),
    size: "xs",
    color: COLOR.muted,
    wrap: true,
    margin: "lg",
  });

  return {
    type: "flex",
    altText: t("เป้าหมายการออม {0} ใบ", input.goals.length),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          { type: "text", text: "เป้าหมายการออม", weight: "bold", size: "lg", color: "#0B5D4F" },
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
                  action: { type: "uri", label: "ดูกราฟและจัดการ", uri: input.manageUrl },
                },
              ],
            },
          }
        : {}),
    },
  };
}

/** The little celebration when a deposit takes a goal to its target. */
export function buildGoalReachedCard(goal: GoalDto): LineMessage {
  return {
    type: "flex",
    altText: t("ถึงเป้าแล้ว! {0} {1}", goal.name, baht(goal.savedSatang)),
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: t("🎉 ถึงเป้าแล้ว!"),
            weight: "bold",
            size: "lg",
            color: COLOR.income,
          },
          { type: "text", text: label(goal), weight: "bold", size: "md", wrap: true },
          {
            type: "text",
            text: t("ออมครบ {0} จากเป้า {1} เก่งมาก!", baht(goal.savedSatang), baht(goal.targetSatang)),
            size: "sm",
            color: COLOR.muted,
            wrap: true,
          },
        ],
      },
    },
  };
}

/** A confirmation text with a Quick Reply that undoes it. */
export function buildGoalDone(input: { text: string; undoData: string }): LineMessage {
  return {
    type: "text",
    text: input.text,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: t("↩ ยกเลิก"),
            data: input.undoData,
            displayText: t("ยกเลิก"),
          },
        },
      ],
    },
  };
}
