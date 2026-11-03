import { categoryLabel } from "@/lib/category-emoji";
import { money } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import type { LineMessage, TxType } from "@/lib/types";
import { budgetBlock, chip, COLOR, noticeBoxes, paymentRow } from "./flex";

export interface ReceiptCardEntry {
  txId: string;
  type: TxType;
  title: string;
  amountSatang: number;
  occurredAt: Date;
  categoryName: string | null;
  categoryIcon: string | null;
}

export interface ReceiptCardInput {
  slipId: string;
  entries: ReceiptCardEntry[];
  /** false when the slip had no readable date and the time it was sent was used. */
  dateKnown: boolean;
  /** Opens the editor of one entry (undefined: no ✏️ button). */
  editUrl?: (txId: string) => string | undefined;
  /** Public https picture for the header (the mascot). */
  logoUrl?: string;
  /** Where spending stands against the budget(s) these entries count against. */
  budgets?: {
    scopeName: string | null;
    spentSatang: number;
    limitSatang: number;
    level: "ok" | "warn" | "over";
  }[];
  /** "รายเดือน (วันที่ 1)": the budget cycle, shown under the budget. */
  cycleLabel?: string;
  /** Warnings the card carries itself (budget, daily limit, card limit). */
  notices?: { text: string; level: "warn" | "over" }[];
  /** Wallets / cards to pick as the way the whole slip was paid (two or more wallets). */
  payment?: {
    choices: { id: string; label: string; selected: boolean }[];
    more: boolean;
    /** The page where a wallet / card is added ("＋ เพิ่มช่องทาง"; https only). */
    addUrl?: string;
  };
}

/** Rows drawn on the card; the rest are recorded all the same and are named in a line. */
const MAX_ROWS = 25;

/**
 * "Recorded" card for a slip or a receipt photo: every entry grouped by category, each with
 * ✏️ (edit in the app) and ❌ (delete that one), and "cancel the whole slip" when there are several.
 */
export function buildReceiptCard(input: ReceiptCardInput): LineMessage {
  const shown = input.entries.slice(0, MAX_ROWS);
  const more = input.entries.length - shown.length;

  // groups in the order they first appear
  const groups: { key: string; type: TxType; label: string; rows: ReceiptCardEntry[] }[] = [];
  for (const e of shown) {
    const name = e.categoryName ? categoryLabel(e.categoryName, e.categoryIcon) : "ไม่ระบุหมวด";
    const key = `${e.type}|${name}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        type: e.type,
        label: `${e.type === "income" ? "รายรับ" : "รายจ่าย"} - ${name}`,
        rows: [],
      };
      groups.push(group);
    }
    group.rows.push(e);
  }

  const body: unknown[] = [];
  groups.forEach((g, i) => {
    const income = g.type === "income";
    body.push({
      type: "box",
      layout: "horizontal",
      margin: i === 0 ? "none" : "lg",
      contents: [
        {
          type: "box",
          layout: "vertical",
          backgroundColor: income ? "#E6F7EF" : "#FDECEC",
          cornerRadius: "12px",
          paddingTop: "3px",
          paddingBottom: "3px",
          paddingStart: "10px",
          paddingEnd: "10px",
          flex: 0,
          contents: [
            {
              type: "text",
              text: g.label,
              size: "sm",
              weight: "bold",
              color: income ? COLOR.income : COLOR.expense,
            },
          ],
        },
      ],
    });
    for (const e of g.rows) {
      const url = input.editUrl?.(e.txId);
      body.push({
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        alignItems: "center",
        margin: "md",
        contents: [
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            contents: [
              {
                type: "text",
                text: `${formatThaiDate(e.occurredAt, input.dateKnown)}${input.dateKnown ? "" : " *"}`,
                size: "xs",
                color: COLOR.muted,
              },
              {
                type: "text",
                text: e.title,
                size: "md",
                weight: "bold",
                wrap: true,
                color: COLOR.text,
              },
            ],
          },
          {
            type: "text",
            text: `${e.type === "income" ? "+" : ""}${money(e.amountSatang)}`,
            size: "md",
            weight: "bold",
            align: "end",
            gravity: "center",
            color: income ? COLOR.income : COLOR.expense,
            flex: 0,
          },
          ...(url
            ? [chip("✏️", "#EEF2F1", COLOR.text, { type: "uri", label: "แก้ไข", uri: url }, "36px")]
            : []),
          chip(
            "✕",
            "#FDECEC",
            COLOR.expense,
            {
              type: "postback",
              label: "ลบ",
              data: `a=rdx&id=${e.txId}`,
              displayText: `ลบ ${e.title}`.slice(0, 40),
            },
            "36px",
          ),
        ],
      });
    }
  });

  const notes: unknown[] = [];
  if (more > 0) {
    notes.push({
      type: "text",
      text: `…และอีก ${more} รายการ (จดไว้แล้ว ดูและแก้ได้ที่หน้ารายการ)`,
      size: "xs",
      color: COLOR.muted,
      wrap: true,
      margin: "md",
    });
  }
  if (!input.dateKnown) {
    notes.push({
      type: "text",
      text: "* ไม่เห็นวันที่บนสลิป ใช้เวลาที่ส่งแทน แก้ได้ด้วยปุ่ม ✏️",
      size: "xs",
      color: COLOR.muted,
      wrap: true,
      margin: "md",
    });
  }

  const header: unknown[] = [
    {
      type: "box",
      layout: "vertical",
      flex: 1,
      spacing: "xs",
      contents: [
        {
          type: "text",
          text: "จดสำเร็จ ✅",
          weight: "bold",
          size: "lg",
          color: "#0B5D4F",
          wrap: true,
        },
        {
          type: "text",
          text: "อย่าลืมตรวจสอบรายการที่จดด้วยนะ",
          size: "xs",
          color: "#3F6B63",
          wrap: true,
        },
      ],
    },
  ];
  // LINE only accepts https image URLs (a local http app URL would make the whole card invalid).
  if (input.logoUrl?.startsWith("https://")) {
    header.push({ type: "image", url: input.logoUrl, size: "72px", aspectMode: "fit", flex: 0 });
  }

  // budget(s), warnings and "จ่ายด้วย", like the card of an entry typed in the chat
  const tail: unknown[] = [
    ...(input.budgets ?? []).map((b) => budgetBlock(b, input.cycleLabel)),
    ...noticeBoxes(input.notices ?? []),
    ...(input.payment && input.payment.choices.length > 0
      ? paymentRow(
          input.payment.choices.map((c) => ({
            label: c.label,
            selected: c.selected,
            action: {
              type: "postback",
              label: "จ่ายด้วย",
              data: `a=wms&s=${input.slipId}&w=${c.id}`,
              displayText: `จ่ายด้วย ${c.label}`.slice(0, 40),
            },
          })),
          input.payment.more
            ? {
                type: "postback",
                label: "อื่น ๆ",
                data: `a=wls&s=${input.slipId}`,
                displayText: "เลือกช่องทางอื่น",
              }
            : undefined,
          input.payment.addUrl?.startsWith("https://")
            ? { type: "uri", label: "เพิ่มช่องทาง", uri: input.payment.addUrl }
            : undefined,
        )
      : []),
  ];

  const total = input.entries.length;
  return {
    type: "flex",
    altText: `จดสำเร็จ ${total} รายการ`,
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
        contents: [...body, ...notes, ...tail],
      },
      ...(total > 1
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              backgroundColor: COLOR.surface,
              contents: [
                {
                  type: "button",
                  style: "secondary",
                  height: "sm",
                  action: {
                    type: "postback",
                    label: "ยกเลิกทั้งใบ",
                    data: `a=rcx&s=${input.slipId}`,
                    displayText: "ยกเลิกทั้งใบ",
                  },
                },
              ],
            },
          }
        : {}),
    },
  };
}
