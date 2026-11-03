import type { GroupSummary } from "@/lib/group";
import { formatBaht } from "@/lib/money";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";

const baht = (satang: number) => `฿${formatBaht(satang)}`;

/** "สรุป": the group's total and what each member paid, with a bar of their share. */
export function buildGroupSummaryCard(input: {
  title: string;
  subtitle: string;
  summary: GroupSummary;
}): LineMessage {
  const { summary } = input;
  const rows = summary.payers.slice(0, 10).flatMap((p, i) => [
    {
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "md" : "lg",
      contents: [
        { type: "text", text: p.name, size: "sm", color: COLOR.text, wrap: true, flex: 5 },
        {
          type: "text",
          text: `${baht(p.totalSatang)} · ${p.percent}%`,
          size: "sm",
          weight: "bold",
          align: "end",
          flex: 5,
        },
      ],
    },
    {
      type: "box",
      layout: "vertical",
      height: "6px",
      cornerRadius: "3px",
      backgroundColor: "#E5EAEE",
      margin: "sm",
      contents: [
        {
          type: "box",
          layout: "vertical",
          width: `${Math.min(100, Math.max(p.percent > 0 ? 3 : 0, p.percent))}%`,
          height: "6px",
          cornerRadius: "3px",
          backgroundColor: COLOR.primary,
          contents: [],
        },
      ],
    },
  ]);
  return {
    type: "flex",
    altText: `${input.title}: รวม ${baht(summary.totalSatang)} (${summary.count} รายการ)`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          { type: "text", text: input.title, weight: "bold", size: "lg", color: "#0B5D4F" },
          { type: "text", text: input.subtitle, size: "xs", color: "#3F6B63", margin: "xs" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "รวมทั้งกลุ่ม", weight: "bold", size: "md", flex: 5 },
              {
                type: "text",
                text: baht(summary.totalSatang),
                weight: "bold",
                size: "md",
                color: COLOR.expense,
                align: "end",
                flex: 5,
              },
            ],
          },
          { type: "text", text: `${summary.count} รายการ`, size: "xs", color: COLOR.muted },
          { type: "separator", margin: "lg" },
          { type: "text", text: "ใครจ่ายไปเท่าไร", size: "xs", color: COLOR.muted, margin: "lg" },
          ...rows,
        ],
      },
    },
  };
}

import type { Settlement } from "@/lib/trip";

/** "สรุปทริป": total, what each person paid and should have paid, and who transfers whom. */
export function buildTripSummaryCard(input: {
  name: string;
  closed: boolean;
  entryCount: number;
  settlement: Settlement;
  nameOf: (lineUserId: string) => string;
}): LineMessage {
  const { settlement } = input;
  const people = settlement.people.slice(0, 12).flatMap((p, i) => [
    {
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "md" : "lg",
      contents: [
        { type: "text", text: input.nameOf(p.id), size: "sm", weight: "bold", wrap: true, flex: 4 },
        {
          type: "text",
          text:
            p.netSatang === 0
              ? "พอดี"
              : p.netSatang > 0
                ? `ได้คืน ${baht(p.netSatang)}`
                : `ต้องจ่าย ${baht(-p.netSatang)}`,
          size: "sm",
          weight: "bold",
          color: p.netSatang > 0 ? COLOR.income : p.netSatang < 0 ? COLOR.expense : COLOR.muted,
          align: "end",
          flex: 4,
        },
      ],
    },
    {
      type: "text",
      text: `จ่ายไป ${baht(p.paidSatang)} · ส่วนของตัวเอง ${baht(p.owedSatang)}`,
      size: "xs",
      color: COLOR.muted,
    },
  ]);

  const transfers =
    settlement.transfers.length === 0
      ? [
          {
            type: "text",
            text: "ไม่มีใครต้องโอนเพิ่ม 🎉",
            size: "sm",
            color: COLOR.muted,
            margin: "md",
          },
        ]
      : settlement.transfers.map((t) => ({
          type: "box",
          layout: "horizontal",
          margin: "md",
          contents: [
            {
              type: "text",
              text: `${input.nameOf(t.from)} → ${input.nameOf(t.to)}`,
              size: "sm",
              wrap: true,
              flex: 6,
            },
            {
              type: "text",
              text: baht(t.amountSatang),
              size: "sm",
              weight: "bold",
              align: "end",
              flex: 3,
            },
          ],
        }));

  return {
    type: "flex",
    altText: `สรุปทริป ${input.name}: รวม ${baht(settlement.totalSatang)}`,
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
            text: `🧳 ${input.name}`,
            weight: "bold",
            size: "lg",
            color: "#0B5D4F",
            wrap: true,
          },
          {
            type: "text",
            text: input.closed ? "ปิดทริปแล้ว" : "ทริปกำลังดำเนินอยู่",
            size: "xs",
            color: "#3F6B63",
            margin: "xs",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "ค่าใช้จ่ายรวม", weight: "bold", size: "md", flex: 5 },
              {
                type: "text",
                text: baht(settlement.totalSatang),
                weight: "bold",
                size: "md",
                color: COLOR.expense,
                align: "end",
                flex: 5,
              },
            ],
          },
          { type: "text", text: `${input.entryCount} รายการ`, size: "xs", color: COLOR.muted },
          { type: "separator", margin: "lg" },
          { type: "text", text: "สรุปรายคน", size: "xs", color: COLOR.muted, margin: "lg" },
          ...people,
          { type: "separator", margin: "lg" },
          { type: "text", text: "ใครต้องโอนให้ใคร", size: "xs", color: COLOR.muted, margin: "lg" },
          ...transfers,
        ],
      },
    },
  };
}
