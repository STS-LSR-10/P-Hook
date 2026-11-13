import { money } from "@/lib/money";
import { t as tr } from "@/lib/i18n";
import type { LineMessage, TxType } from "@/lib/types";
import type { BudgetStatus } from "@/lib/budget-alert";
import { chip, COLOR, noticeBoxes } from "./flex";

/** One saved entry in the list. */
export interface BatchRow {
  txId: string;
  title: string;
  type: TxType;
  amountSatang: number;
  categoryName: string | null;
  /** The category's emoji, null when it has none. */
  categoryEmoji: string | null;
  /** Shown under the title once there is more than one wallet to tell apart. */
  walletName?: string | null;
  /** LIFF page that edits this entry; without it the ✏️ asks the bot for the link. */
  editUrl?: string;
}

/** Where one budget stands after the whole message. */
export interface BatchBudget {
  /** "งบเดือนนี้", "งบสัปดาห์นี้" or "งบอาหาร". */
  label: string;
  status: BudgetStatus;
}

export interface BatchCardInput {
  rows: BatchRow[];
  budgets: BatchBudget[];
  /** Warnings the card carries itself (budget, daily limit, card limit). */
  notices: { text: string; level: "warn" | "over" }[];
  /** Public PNG of the mascot for the header (https only). */
}

/** More than this many rows would make a card too long to read; the rest are only counted. */
export const MAX_BATCH_ROWS = 10;
const ALT_MAX = 400; // LINE's limit
const BAR = { ok: COLOR.primary, warn: "#D97706", over: COLOR.expense } as const;

const sign = (type: TxType) => (type === "income" ? "+" : "-");

function rowBox(r: BatchRow) {
  const income = r.type === "income";
  const accent = income ? COLOR.income : COLOR.expense;
  const accentSoft = income ? "#E6F7EF" : "#FDECEC";
  const sub = [r.categoryName, r.walletName].filter((s): s is string => Boolean(s)).join(" · ");
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    alignItems: "center",
    margin: "md",
    contents: [
      ...(r.categoryEmoji
        ? [{ type: "text", text: r.categoryEmoji, size: "xl", flex: 0, gravity: "center" }]
        : []),
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        contents: [
          { type: "text", text: r.title, weight: "bold", size: "md", color: "#1F2933", wrap: true },
          ...(sub ? [{ type: "text", text: sub, size: "sm", color: COLOR.muted, wrap: true }] : []),
        ],
      },
      {
        type: "text",
        text: `${sign(r.type)}${money(r.amountSatang)}`,
        weight: "bold",
        size: "md",
        color: accent,
        flex: 0,
      },
      chip(
        "✏️",
        "#EAEEF0",
        "#334155",
        r.editUrl
          ? { type: "uri", label: tr("แก้ไข"), uri: r.editUrl }
          : {
              type: "postback",
              label: tr("แก้ไข"),
              data: `a=edit&id=${r.txId}`,
              displayText: tr("แก้ไข"),
            },
        "36px",
        "32px",
      ),
      chip(
        "🗑️",
        accentSoft,
        COLOR.expense,
        {
          type: "postback",
          label: tr("ลบ"),
          data: `a=del&id=${r.txId}`,
          displayText: tr("ลบรายการ"),
        },
        "36px",
        "32px",
      ),
    ],
  };
}

function totalLine(label: string, text: string, color: string) {
  return {
    type: "box",
    layout: "horizontal",
    margin: "md",
    contents: [
      { type: "text", text: label, weight: "bold", size: "md", color: "#14352E", flex: 1 },
      { type: "text", text, weight: "bold", size: "md", color, align: "end", flex: 0 },
    ],
  };
}

function budgetBox(b: BatchBudget) {
  const { spentSatang: spent, limitSatang: limit, level } = b.status;
  const pct = Math.round((spent * 100) / limit);
  const rest = limit - spent;
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    spacing: "sm",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: `${b.label} ${money(limit)}`,
            size: "sm",
            color: COLOR.muted,
            flex: 1,
          },
          { type: "text", text: `${pct}%`, size: "md", color: "#14352E", align: "end", flex: 0 },
        ],
      },
      {
        type: "box",
        layout: "vertical",
        height: "8px",
        cornerRadius: "4px",
        backgroundColor: "#E5EAEE",
        contents: [
          {
            type: "box",
            layout: "vertical",
            width: `${Math.min(100, Math.max(3, pct))}%`,
            height: "8px",
            cornerRadius: "4px",
            backgroundColor: BAR[level],
            contents: [],
          },
        ],
      },
      {
        type: "text",
        text:
          rest >= 0
            ? tr("ใช้ไป {0} · เหลือ {1}", money(spent), money(rest))
            : tr("ใช้ไป {0} · เกินงบ {1}", money(spent), money(-rest)),
        size: "sm",
        color: rest >= 0 ? COLOR.muted : COLOR.expense,
        wrap: true,
      },
    ],
  };
}

/** One card for everything saved from one message: a row for each entry (with ✏️ and 🗑️), the total and the budget. */
export function buildBatchConfirmMessage(input: BatchCardInput): LineMessage {
  const all = input.rows;
  const shown = all.slice(0, MAX_BATCH_ROWS);
  const hidden = all.length - shown.length;
  const expense = all.filter((r) => r.type === "expense").reduce((s, r) => s + r.amountSatang, 0);
  const income = all.filter((r) => r.type === "income").reduce((s, r) => s + r.amountSatang, 0);

  const totals: unknown[] = [];
  if (expense > 0 && income > 0) {
    totals.push(
      totalLine(tr("รายจ่ายรวม"), `-${money(expense)}`, COLOR.expense),
      totalLine(tr("รายรับรวม"), `+${money(income)}`, COLOR.income),
    );
  } else if (income > 0) {
    totals.push(totalLine(tr("รวม"), `+${money(income)}`, COLOR.income));
  } else {
    totals.push(totalLine(tr("รวม"), `-${money(expense)}`, COLOR.expense));
  }

  const body: unknown[] = [
    ...shown.map(rowBox),
    ...(hidden > 0
      ? [
          {
            type: "text",
            text: tr("และอีก {0} รายการ (ดูทั้งหมดที่หน้ารายการ)", hidden),
            size: "sm",
            color: COLOR.muted,
            wrap: true,
            margin: "md",
          },
        ]
      : []),
    { type: "separator", margin: "lg" },
    ...totals,
    ...(input.budgets.length > 0 ? [{ type: "separator", margin: "md" }] : []),
    ...input.budgets.map(budgetBox),
    ...noticeBoxes(input.notices),
  ];

  const header: unknown[] = [
    {
      type: "box",
      layout: "vertical",
      flex: 1,
      spacing: "xs",
      contents: [
        {
          type: "text",
          text: tr("จดสำเร็จ {0} รายการ ✅", all.length),
          weight: "bold",
          size: "lg",
          color: "#0B5D4F",
          wrap: true,
        },
        {
          type: "text",
          text: tr("อย่าลืมตรวจสอบรายการที่จดด้วยนะ"),
          size: "xs",
          color: "#3F6B63",
          wrap: true,
        },
      ],
    },
  ];

  let altText = tr("จดแล้ว {0} รายการ: {1}", all.length, all.map((r) => r.title).join(", "));
  if (altText.length > ALT_MAX) altText = `${altText.slice(0, ALT_MAX - 1)}…`;

  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: header,
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.surface,
        paddingAll: "12px",
        contents: body,
      },
    },
  };
}
