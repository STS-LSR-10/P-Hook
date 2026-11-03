import { categoryLabel } from "@/lib/category-emoji";
import type { CategorySlice } from "@/lib/category-spend";
import { type ChangeKind, type CompareRow } from "@/lib/period-compare";
import type { TxDto } from "@/lib/dto";
import { money } from "@/lib/money";
import { formatThaiDate, formatThaiMonthShort } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { badge, bar, barColor, cardHeader, pillFooter, TINT } from "./card-style";
import { COLOR } from "./flex";

const footer = (label: string, uri: string | undefined) =>
  uri?.startsWith("https://")
    ? {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#0F766E",
            height: "sm",
            action: { type: "uri", label, uri },
          },
        ],
      }
    : undefined;

const header = (title: string, subtitle: string) => ({
  type: "box",
  layout: "vertical",
  backgroundColor: "#CCFBF1",
  paddingAll: "12px",
  contents: [
    { type: "text", text: title, weight: "bold", size: "lg", color: "#0B5D4F" },
    { type: "text", text: subtitle, size: "xs", color: "#3F6B63", margin: "xs", wrap: true },
  ],
});

/** "ใช้จ่ายตามหมวด": each category with its amount, share and a thick coloured bar. */
export function buildCategorySpendCard(input: {
  subtitle: string;
  slices: CategorySlice[];
  totalSatang: number;
  moreUrl?: string;
}): LineMessage {
  const body: unknown[] = [];
  input.slices.forEach((s, i) => {
    body.push({
      type: "box",
      layout: "vertical",
      margin: i === 0 ? "none" : "lg",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          alignItems: "center",
          contents: [
            {
              type: "text",
              text: categoryLabel(s.name, s.icon),
              size: "md",
              weight: "bold",
              color: TINT.strong,
              flex: 5,
              wrap: true,
            },
            {
              type: "text",
              text: `${money(s.amountSatang)} · ${s.percent}%`,
              size: "md",
              color: TINT.strong,
              align: "end",
              flex: 5,
            },
          ],
        },
        bar(s.percent, s.other ? "#9CA3AF" : barColor(i), "12px"),
      ],
    });
  });
  body.push(
    { type: "separator", margin: "lg", color: "#EDEDF2" },
    {
      type: "box",
      layout: "horizontal",
      alignItems: "center",
      margin: "lg",
      contents: [
        {
          type: "text",
          text: "รายจ่ายรวม 💰",
          size: "lg",
          weight: "bold",
          color: TINT.strong,
          flex: 5,
        },
        {
          type: "text",
          text: `${money(input.totalSatang)}`,
          size: "lg",
          weight: "bold",
          color: TINT.bad,
          align: "end",
          flex: 5,
        },
      ],
    },
  );
  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: cardHeader("ใช้จ่ายตามหมวด", [input.subtitle], "📊"),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const f = pillFooter("ดูกราฟในแอป 📈", input.moreUrl);
  if (f) bubble.footer = f;
  return {
    type: "flex",
    altText: `ใช้จ่ายตามหมวด ${input.subtitle}: รวม ${money(input.totalSatang)}`,
    contents: bubble,
  };
}

/** "รายการล่าสุด": the newest entries, one line each. */
export function buildRecentCard(input: { items: TxDto[]; moreUrl?: string }): LineMessage {
  const body: unknown[] = [];
  input.items.forEach((tx, i) => {
    const income = tx.type === "income";
    body.push({
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "none" : "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 5,
          contents: [
            { type: "text", text: tx.title, size: "sm", color: COLOR.text, wrap: true },
            {
              type: "text",
              text: `${tx.categoryName ? categoryLabel(tx.categoryName, tx.categoryIcon) : "ไม่ระบุหมวด"} · ${formatThaiDate(new Date(tx.occurredAt), true)}`,
              size: "xs",
              color: COLOR.muted,
              wrap: true,
            },
          ],
        },
        {
          type: "text",
          text: `${income ? "+" : "-"}${money(tx.amountSatang)}`,
          size: "sm",
          weight: "bold",
          color: income ? COLOR.income : COLOR.expense,
          align: "end",
          flex: 3,
        },
      ],
    });
  });
  body.push({
    type: "text",
    text: "ลบล่าสุด · แก้ล่าสุด 45",
    size: "xs",
    color: COLOR.muted,
    margin: "lg",
  });
  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: header("รายการล่าสุด", `${input.items.length} รายการล่าสุดที่จดไว้`),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const f = footer("ดูทั้งหมดในแอป", input.moreUrl);
  if (f) bubble.footer = f;
  return {
    type: "flex",
    altText: `รายการล่าสุด ${input.items.length} รายการ`,
    contents: bubble,
  };
}

/** "▲ 25%", "▼ 10%", "ใหม่", "−100%", "เท่าเดิม": text and colour of a change in expense. */
export function changeLabel(
  kind: ChangeKind,
  percent: number | null,
): { text: string; color: string } {
  switch (kind) {
    case "up":
      return { text: `▲ ${percent}%`, color: COLOR.expense };
    case "down":
      return { text: `▼ ${Math.abs(percent ?? 0)}%`, color: COLOR.income };
    case "gone":
      return { text: "▼ 100%", color: COLOR.income };
    case "new":
      return { text: "ใหม่", color: COLOR.expense };
    default:
      return { text: "เท่าเดิม", color: COLOR.muted };
  }
}

const BADGE_BG: Record<string, string> = {
  up: TINT.badSoft,
  new: TINT.badSoft,
  down: TINT.goodSoft,
  gone: TINT.goodSoft,
};

/** "เทียบรายจ่ายรายหมวด": this period against the same days of the one before, category by category. */
export function buildCompareCard(input: {
  currentLabel: string;
  previousLabel: string;
  rows: CompareRow[];
  currentSatang: number;
  previousSatang: number;
  totalChange: { kind: ChangeKind; changePercent: number | null };
  moreUrl?: string;
}): LineMessage {
  const total = changeLabel(input.totalChange.kind, input.totalChange.changePercent);
  const line = (
    name: string,
    previousSatang: number,
    currentSatang: number,
    change: { text: string; color: string },
    kind: ChangeKind,
    strong: boolean,
  ) => ({
    type: "box",
    layout: "horizontal",
    alignItems: "center",
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 5,
        contents: [
          {
            type: "text",
            text: name,
            size: "md",
            weight: "bold",
            color: TINT.strong,
            wrap: true,
          },
          {
            type: "text",
            text: `ก่อนหน้า ${money(previousSatang)}`,
            size: "xs",
            color: COLOR.muted,
          },
        ],
      },
      {
        type: "box",
        layout: "vertical",
        flex: 4,
        alignItems: "flex-end",
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: `${money(currentSatang)}`,
            size: "md",
            weight: strong ? "bold" : "regular",
            color: strong ? TINT.bad : TINT.strong,
            align: "end",
          },
          badge(change.text, change.color, BADGE_BG[kind] ?? TINT.neutralSoft),
        ],
      },
    ],
  });

  const body: unknown[] = [
    {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      cornerRadius: "14px",
      borderWidth: "1px",
      borderColor: "#E3E3EA",
      backgroundColor: "#FFFFFF",
      contents: [
        line(
          "💰 รายจ่ายรวม",
          input.previousSatang,
          input.currentSatang,
          total,
          input.totalChange.kind,
          true,
        ),
      ],
    },
  ];
  for (const r of input.rows) {
    body.push({
      ...line(
        r.name,
        r.previousSatang,
        r.currentSatang,
        changeLabel(r.kind, r.changePercent),
        r.kind,
        false,
      ),
      margin: "lg",
      paddingStart: "4px",
      paddingEnd: "4px",
    });
  }
  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: cardHeader(
      "เทียบรายจ่ายรายหมวด",
      [`รอบนี้ ${input.currentLabel}`, `เทียบ ${input.previousLabel}`],
      "⚖️",
    ),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const f = pillFooter("ดูกราฟในแอป 📈", input.moreUrl);
  if (f) bubble.footer = f;
  return {
    type: "flex",
    altText: `เทียบรายจ่ายรายหมวด: ${money(input.currentSatang)} (${total.text}) จาก ${money(input.previousSatang)}`,
    contents: bubble,
  };
}

/** "สรุปรายปี": the year's totals, top categories and a bar per month. */
export function buildYearCard(input: {
  yearBE: number;
  subtitle: string;
  income: number;
  expense: number;
  /** Change of the expenses against the same days a year earlier; null without a baseline. */
  changePercent: number | null;
  topExpenses: { name: string; amountSatang: number; percent: number }[];
  months: { month: Date; expenseSatang: number }[];
  moreUrl?: string;
}): LineMessage {
  const net = input.income - input.expense;
  const sumRow = (label: string, value: string, color: string) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: COLOR.muted, flex: 3 },
      { type: "text", text: value, size: "md", weight: "bold", color, align: "end", flex: 5 },
    ],
  });
  const body: unknown[] = [
    sumRow("รายรับ", `+${money(input.income)}`, COLOR.income),
    sumRow("รายจ่าย", `-${money(input.expense)}`, COLOR.expense),
    sumRow(
      "เหลือ",
      `${net < 0 ? "-" : ""}${money(Math.abs(net))}`,
      net < 0 ? COLOR.expense : COLOR.income,
    ),
  ];
  if (input.changePercent !== null) {
    const up = input.changePercent > 0;
    body.push({
      type: "text",
      text:
        input.changePercent === 0
          ? "รายจ่ายเท่ากับปีก่อน (ช่วงวันที่เดียวกัน)"
          : `รายจ่าย${up ? "เพิ่มขึ้น" : "ลดลง"} ${Math.abs(input.changePercent)}% จากปีก่อน (ช่วงวันที่เดียวกัน)`,
      size: "xs",
      color: up ? COLOR.expense : COLOR.income,
      wrap: true,
      margin: "md",
    });
  }
  if (input.topExpenses.length > 0) {
    body.push(
      { type: "separator", margin: "lg" },
      { type: "text", text: "ใช้จ่ายเยอะสุด", size: "xs", color: COLOR.muted, margin: "lg" },
    );
    for (const c of input.topExpenses) {
      body.push({
        type: "box",
        layout: "horizontal",
        margin: "sm",
        contents: [
          { type: "text", text: c.name, size: "sm", color: COLOR.text, flex: 4, wrap: true },
          {
            type: "text",
            text: `${money(c.amountSatang)} · ${c.percent}%`,
            size: "sm",
            color: COLOR.muted,
            align: "end",
            flex: 5,
          },
        ],
      });
    }
  }
  const maxMonth = Math.max(0, ...input.months.map((m) => m.expenseSatang));
  body.push(
    { type: "separator", margin: "lg" },
    { type: "text", text: "รายจ่ายรายเดือน", size: "xs", color: COLOR.muted, margin: "lg" },
  );
  for (const m of input.months) {
    const pct = maxMonth > 0 ? Math.round((m.expenseSatang * 100) / maxMonth) : 0;
    body.push({
      type: "box",
      layout: "horizontal",
      margin: "sm",
      alignItems: "center",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: formatThaiMonthShort(m.month),
          size: "xs",
          color: COLOR.muted,
          flex: 2,
        },
        {
          type: "box",
          layout: "vertical",
          flex: 5,
          height: "6px",
          cornerRadius: "3px",
          backgroundColor: "#E5EAEE",
          contents:
            m.expenseSatang > 0
              ? [
                  {
                    type: "box",
                    layout: "vertical",
                    width: `${Math.max(3, pct)}%`,
                    height: "6px",
                    cornerRadius: "3px",
                    backgroundColor: COLOR.expense,
                    contents: [],
                  },
                ]
              : [],
        },
        {
          type: "text",
          text: `${money(m.expenseSatang)}`,
          size: "xs",
          color: COLOR.text,
          align: "end",
          flex: 4,
        },
      ],
    });
  }
  const bubble: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: header(`สรุปรายปี ${input.yearBE}`, input.subtitle),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: body },
  };
  const f = footer("ดูกราฟในแอป", input.moreUrl);
  if (f) bubble.footer = f;
  return {
    type: "flex",
    altText: `สรุปรายปี ${input.yearBE}: รายรับ ${money(input.income)} รายจ่าย ${money(input.expense)}`,
    contents: bubble,
  };
}
