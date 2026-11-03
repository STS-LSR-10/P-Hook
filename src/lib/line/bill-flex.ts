import { dueState, type BillDto } from "@/lib/bill";
import { formatBaht } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";

const CADENCE: Record<BillDto["cadence"], string> = {
  monthly: "ทุกเดือน",
  yearly: "ทุกปี",
  once: "ครั้งเดียว",
};

/** "บิล": every bill with its next due date (red when late, amber within 3 days) and the amount. */
export function buildBillsCard(input: {
  bills: BillDto[];
  today: string;
  manageUrl?: string;
}): LineMessage {
  const rows = input.bills.slice(0, 10).map((b) => {
    const state = dueState(b.nextDueOn, input.today);
    const [y, m, d] = b.nextDueOn.split("-").map(Number);
    const due = formatThaiDate(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 5)));
    return {
      type: "box",
      layout: "horizontal",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 5,
          contents: [
            {
              type: "text",
              text: b.name,
              size: "sm",
              weight: "bold",
              color: COLOR.text,
              wrap: true,
            },
            {
              type: "text",
              text: `${CADENCE[b.cadence]}${b.fromCard ? " · วันชำระบัตร" : ""}`,
              size: "xs",
              color: COLOR.muted,
            },
          ],
        },
        {
          type: "box",
          layout: "vertical",
          flex: 4,
          contents: [
            {
              type: "text",
              text: due,
              size: "sm",
              align: "end",
              weight: "bold",
              color:
                state === "overdue" ? COLOR.expense : state === "soon" ? "#D97706" : COLOR.text,
            },
            {
              type: "text",
              text: b.amountSatang ? `฿${formatBaht(b.amountSatang)}` : "ไม่ระบุยอด",
              size: "xs",
              align: "end",
              color: COLOR.muted,
            },
          ],
        },
      ],
    };
  });

  return {
    type: "flex",
    altText: `บิลที่ตั้งเตือน ${input.bills.length} รายการ`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          { type: "text", text: "บิลที่ต้องจ่าย", weight: "bold", size: "lg", color: "#0B5D4F" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          ...rows,
          {
            type: "text",
            text: 'จ่ายแล้วพิมพ์ "จ่ายบิล ค่าไฟ" หรือกดปุ่มในข้อความเตือน',
            size: "xs",
            color: COLOR.muted,
            wrap: true,
            margin: "lg",
          },
        ],
      },
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
                  action: { type: "uri", label: "จัดการบิล", uri: input.manageUrl },
                },
              ],
            },
          }
        : {}),
    },
  };
}
