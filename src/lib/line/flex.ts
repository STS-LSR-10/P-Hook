import { categoryLabel } from "@/lib/category-emoji";
import { money } from "@/lib/money";
import { bangkokParts, formatThaiDate } from "@/lib/thai-date";
import type { ConfirmStyle, LineMessage, TxType } from "@/lib/types";

// Design tokens (see docs/design-tokens.md)
export const COLOR = {
  primary: "#0F766E",
  primarySoft: "#CCFBF1",
  expense: "#E11D48",
  income: "#059669",
  text: "#0F172A",
  muted: "#64748B",
  surface: "#FFFFFF",
} as const;

export interface ConfirmCardInput {
  style: Exclude<ConfirmStyle, "off">;
  txId: string;
  type: TxType;
  title: string;
  categoryName: string | null;
  amountSatang: number;
  occurredAt: Date;
  /** #tags on the entry (without the #). */
  tags?: string[];
  /** Total of this category in the current budget cycle, including this entry. */
  cycleTotalSatang: number | null;
  /** e.g. "รายเดือน (วันที่ 1)"; shown under the category total. */
  cycleLabel?: string;
  /** Wallet the entry went to, e.g. "💳 บัตร KTC" (shown only when there is more than one wallet). */
  walletName?: string | null;
  /** Foreign-currency entry: "1,500 JPY @ 0.2335" (shown under the date). */
  fxNote?: string | null;
  /** Offer the "ย้ายกระเป๋า" button (the user has two or more wallets). */
  canMoveWallet?: boolean;
  /** LIFF page that edits this entry; the "แก้" chip opens it (falls back to a chat hint without it). */
  editUrl?: string;
  /** The card confirms an edit ("แก้ไขรายการสำเร็จ") rather than a new entry. */
  edited?: boolean;
  /** Where spending stands against the budget that applies to this entry (null/absent: no budget). */
  budget?: {
    /** The category the budget is for, or null for the overall budget. */
    scopeName: string | null;
    spentSatang: number;
    limitSatang: number;
    level: "ok" | "warn" | "over";
  } | null;
  /** Warnings the card carries itself (budget, daily limit, card limit), so none is sent apart. */
  notices?: { text: string; level: "warn" | "over" }[];
  /** Wallets / cards to pick as the way it was paid (two or more wallets); the chosen one is marked. */
  walletChoices?: { id: string; label: string; selected: boolean }[];
  /** There are more wallets than the row shows: add an "อื่น ๆ" chip that lists them all. */
  moreWallets?: boolean;
  /** The page where a wallet / card is added: shows a "＋ เพิ่มช่องทาง" pill (https only). */
  addWalletUrl?: string;
  /** Show the small "📎 แนบรูป" button at the bottom-left; a tap starts the photo step. */
  photoButton?: boolean;
  /** Public PNG of the mascot for the card header (omitted when the app URL is unknown). */
  logoUrl?: string;
}

const TYPE_LABEL: Record<TxType, string> = { expense: "รายจ่าย", income: "รายรับ" };

export function row(label: string, value: string) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: COLOR.muted, flex: 2 },
      {
        type: "text",
        text: value,
        size: "sm",
        color: COLOR.text,
        flex: 5,
        wrap: true,
        align: "end",
      },
    ],
  };
}

export function shareText(input: ConfirmCardInput): string {
  const sign = input.type === "income" ? "+" : "-";
  return `${input.title} ${sign}${money(input.amountSatang)} (${formatThaiDate(input.occurredAt)}) · จดด้วยพี่ฮูก`;
}

// colours below are the base palette's, so the chosen card theme still recolours them
const TINT_STRONG = "#14352E";

export const chip = (
  label: string,
  bg: string,
  color: string,
  action: unknown,
  width = "44px",
  height = "40px",
) => ({
  type: "box",
  layout: "vertical",
  width,
  height,
  cornerRadius: "12px",
  backgroundColor: bg,
  justifyContent: "center",
  alignItems: "center",
  flex: 0,
  action,
  contents: [{ type: "text", text: label, size: "md", weight: "bold", color, align: "center" }],
});

const MAX_PILL_LABEL = 14;
/** A row of "จ่ายด้วย" holds this many pills (LINE cannot scroll a row inside a card). */
const PAY_ROW = 3;

/** One payment channel in the "จ่ายด้วย" row: tinted with a border and a tick when chosen, outlined otherwise. */
export function payPill(label: string, selected: boolean, action?: unknown) {
  const short = label.length > MAX_PILL_LABEL ? `${label.slice(0, MAX_PILL_LABEL - 1)}…` : label;
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    height: "34px",
    cornerRadius: "17px",
    paddingStart: "6px",
    paddingEnd: "6px",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: selected ? COLOR.primarySoft : "#FFFFFF",
    borderWidth: selected ? "2px" : "1px",
    borderColor: selected ? COLOR.primary : "#D8DCE3",
    ...(action ? { action } : {}),
    contents: [
      {
        type: "text",
        text: selected ? `✓ ${short}` : short,
        size: "xs",
        weight: selected ? "bold" : "regular",
        color: selected ? "#0B5D4F" : COLOR.text,
        align: "center",
        wrap: false,
      },
    ],
  };
}

/** Warning boxes (budget, daily limit, card limit): amber for a warning, red once over. */
export function noticeBoxes(notices: { text: string; level: "warn" | "over" }[]): unknown[] {
  return notices.map((notice) => {
    const over = notice.level === "over";
    return {
      type: "box",
      layout: "vertical",
      margin: "md",
      paddingAll: "10px",
      cornerRadius: "12px",
      backgroundColor: over ? "#FDECEC" : "#FFF4D6",
      contents: [
        {
          type: "text",
          text: `${over ? "🚨" : "⚠️"} ${notice.text}`,
          size: "sm",
          wrap: true,
          color: over ? "#9F1239" : "#7A5209",
        },
      ],
    };
  });
}

/**
 * The "จ่ายด้วย" row: one pill per wallet / card (the chosen one tinted with a tick and not tappable),
 * then "อื่น ๆ" when there are more places than shown, and "＋ เพิ่มช่องทาง" while the row has room.
 * Callers pass at most two choices with `more`, three without.
 */
export function paymentRow(
  choices: { label: string; selected: boolean; action: unknown }[],
  more?: unknown,
  add?: unknown,
): unknown[] {
  const pills: unknown[] = [
    ...choices.map((c) => payPill(c.label, c.selected, c.selected ? undefined : c.action)),
    ...(more ? [payPill("อื่น ๆ", false, more)] : []),
  ].slice(0, PAY_ROW);
  if (add && pills.length < PAY_ROW) pills.push(payPill("＋ เพิ่มช่องทาง", false, add));
  // a short row keeps its pills a third wide: empty boxes take the rest
  while (pills.length < PAY_ROW)
    pills.push({ type: "box", layout: "vertical", flex: 1, contents: [] });
  return [
    {
      type: "text",
      text: "จ่ายด้วย",
      size: "xs",
      weight: "bold",
      color: TINT_STRONG,
      margin: "md",
    },
    { type: "box", layout: "horizontal", spacing: "sm", margin: "sm", contents: pills },
  ];
}

/** The wide "📎 แนบรูป" pill along the foot of the card: a tap opens the camera / album step. */
function attachPhotoPill(txId: string) {
  return {
    type: "box",
    layout: "horizontal",
    height: "46px",
    cornerRadius: "16px",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLOR.primarySoft,
    borderWidth: "1px",
    borderColor: "#A7E8D8",
    action: {
      type: "postback",
      label: "แนบรูป",
      // no displayText: the tap is silent, only the camera / album buttons come back
      data: `a=ph&id=${txId}`,
    },
    contents: [
      {
        type: "text",
        text: "📎 แนบรูป",
        size: "md",
        weight: "bold",
        color: "#0B5D4F",
        align: "center",
      },
    ],
  };
}

const LEVEL_COLOR = { ok: COLOR.primary, warn: "#B45309", over: COLOR.expense } as const;
const LEVEL_BAR = { ok: COLOR.primary, warn: "#F59E0B", over: COLOR.expense } as const;

/** The budget block: "ใช้ไป / งบ", a bar that turns amber near the end and red past it, what is left. */
export function budgetBlock(
  budget: NonNullable<ConfirmCardInput["budget"]>,
  cycleLabel: string | undefined,
) {
  const { spentSatang: spent, limitSatang: limit, level } = budget;
  const pct = Math.floor((spent * 100) / limit);
  const width = Math.min(100, Math.max(3, pct));
  const rest = limit - spent;
  return {
    type: "box",
    layout: "vertical",
    margin: "lg",
    spacing: "sm",
    paddingAll: "12px",
    cornerRadius: "16px",
    backgroundColor: "#F6F8F9",
    borderWidth: "1px",
    borderColor: "#E3E8EC",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        alignItems: "center",
        contents: [
          {
            type: "text",
            text: budget.scopeName ? `งบหมวด${budget.scopeName}` : "งบรวม",
            weight: "bold",
            size: "md",
            color: "#14352E",
            wrap: true,
            flex: 1,
          },
          ...(level === "ok"
            ? []
            : [
                {
                  type: "box",
                  layout: "vertical",
                  flex: 0,
                  cornerRadius: "10px",
                  paddingTop: "2px",
                  paddingBottom: "2px",
                  paddingStart: "8px",
                  paddingEnd: "8px",
                  backgroundColor: level === "over" ? "#FDECEC" : "#FFF4D6",
                  contents: [
                    {
                      type: "text",
                      text: level === "over" ? "เกินงบ" : "ใกล้เต็มงบ",
                      size: "xs",
                      weight: "bold",
                      color: LEVEL_COLOR[level],
                    },
                  ],
                },
              ]),
        ],
      },
      {
        type: "text",
        wrap: true,
        contents: [
          {
            type: "span",
            text: `${money(spent)}`,
            size: "lg",
            weight: "bold",
            color: LEVEL_COLOR[level],
          },
          { type: "span", text: ` / ${money(limit)}`, size: "md", color: COLOR.muted },
        ],
      },
      {
        type: "box",
        layout: "vertical",
        height: "10px",
        cornerRadius: "5px",
        backgroundColor: "#E5EAEE",
        contents: [
          {
            type: "box",
            layout: "vertical",
            width: `${width}%`,
            height: "10px",
            cornerRadius: "6px",
            backgroundColor: LEVEL_BAR[level],
            contents: [],
          },
        ],
      },
      {
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: `ใช้ไป ${pct}%`, size: "xs", color: COLOR.muted, flex: 1 },
          {
            type: "text",
            text: rest >= 0 ? `เหลือ ${money(rest)}` : `เกินงบ ${money(-rest)}`,
            size: "xs",
            weight: "bold",
            color: rest >= 0 ? COLOR.muted : COLOR.expense,
            align: "end",
            flex: 1,
          },
        ],
      },
      ...(cycleLabel
        ? [{ type: "text", text: `รอบงบ: ${cycleLabel}`, size: "xs", color: COLOR.muted }]
        : []),
    ],
  };
}

export function buildConfirmMessage(input: ConfirmCardInput): LineMessage {
  const amountText = `${money(input.amountSatang)}`;
  const category = input.categoryName ?? "ไม่ระบุหมวด";
  const tagsText = input.tags?.length ? ` ${input.tags.map((t) => `#${t}`).join(" ")}` : "";

  const walletText = input.walletName ? ` · ${input.walletName}` : "";
  const moveItem = input.canMoveWallet
    ? [
        {
          type: "action",
          action: {
            type: "postback",
            label: "💳 ย้ายกระเป๋า",
            data: `a=wl&id=${input.txId}`,
            displayText: "ย้ายกระเป๋า",
          },
        },
      ]
    : [];

  if (input.style === "short") {
    return {
      type: "text",
      text: `${input.edited ? "แก้ไขรายการสำเร็จ" : "จดแล้ว"}: ${input.title} ${amountText} · ${category}${tagsText}${walletText}${input.fxNote ? ` · ${input.fxNote}` : ""}`,
      // LINE refuses a quick reply with no buttons
      ...(moveItem.length > 0 ? { quickReply: { items: moveItem } } : {}),
    };
  }

  const income = input.type === "income";
  const accent = income ? COLOR.income : COLOR.expense;
  const accentSoft = income ? "#E6F7EF" : "#FDECEC";
  const total = input.cycleTotalSatang;
  // This entry's share of the category total in the cycle (a full bar for the first entry).
  const share =
    total !== null && total > 0
      ? Math.min(100, Math.max(4, (input.amountSatang * 100) / total))
      : 0;

  const header: unknown[] = [
    {
      type: "box",
      layout: "vertical",
      flex: 1,
      spacing: "xs",
      contents: [
        {
          type: "text",
          // the tick sits right after the words (it wraps along with them on a narrow phone)
          text: input.edited ? "แก้ไขรายการสำเร็จ ✅" : "จดสำเร็จ ✅",
          weight: "bold",
          // the longer edit title is a notch smaller
          size: input.edited ? "md" : "lg",
          color: "#0B5D4F",
          wrap: true,
        },
        {
          type: "text",
          text: input.edited
            ? "อัปเดตรายการเรียบร้อยแล้ว"
            : income
              ? "เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ"
              : "อย่าลืมตรวจสอบรายการที่จดด้วยนะ",
          size: "xs",
          color: "#3F6B63",
          wrap: true,
        },
      ],
    },
  ];
  // LINE only accepts https image URLs (a local http app URL would make the whole card invalid).
  if (input.logoUrl?.startsWith("https://")) {
    header.push({
      type: "image",
      url: input.logoUrl,
      size: "48px",
      aspectMode: "fit",
      flex: 0,
    });
  }

  const body: unknown[] = [
    {
      type: "box",
      layout: "horizontal",
      spacing: "md",
      alignItems: "center",
      contents: [
        {
          type: "box",
          layout: "vertical",
          backgroundColor: accent,
          cornerRadius: "12px",
          paddingTop: "2px",
          paddingBottom: "2px",
          paddingStart: "10px",
          paddingEnd: "10px",
          flex: 0,
          contents: [
            {
              type: "text",
              text: TYPE_LABEL[input.type],
              size: "xs",
              weight: "bold",
              color: "#FFFFFF",
            },
          ],
        },
        {
          type: "text",
          text: `- ${category}`,
          weight: "bold",
          size: "sm",
          color: "#14352E",
          flex: 1,
        },
        chip(
          "แชร์",
          accentSoft,
          accent,
          {
            type: "uri",
            label: "แชร์",
            uri: `https://line.me/R/share?text=${encodeURIComponent(shareText(input))}`,
          },
          "48px",
          "30px",
        ),
      ],
    },
    {
      type: "text",
      text: `${formatThaiDate(input.occurredAt, true)}${input.walletName ? ` · ${input.walletName}` : ""}`,
      size: "xs",
      color: COLOR.muted,
      margin: "sm",
      wrap: true,
    },
    ...(input.fxNote
      ? [
          {
            type: "text",
            text: input.fxNote,
            size: "sm",
            color: COLOR.muted,
            margin: "sm",
            wrap: true,
          },
        ]
      : []),
    ...(input.tags && input.tags.length > 0
      ? [
          {
            type: "text",
            text: input.tags.map((t) => `#${t}`).join(" "),
            size: "sm",
            color: COLOR.primary,
            wrap: true,
            margin: "sm",
          },
        ]
      : []),
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      alignItems: "center",
      margin: "md",
      contents: [
        {
          type: "text",
          text: input.title,
          weight: "bold",
          size: "md",
          color: "#1F2933",
          wrap: true,
          flex: 1,
        },
        {
          type: "text",
          text: `${income ? "+" : ""}${amountText}`,
          weight: "bold",
          size: "md",
          color: accent,
          flex: 0,
        },
        chip(
          "✏️",
          "#EAEEF0",
          "#334155",
          input.editUrl
            ? { type: "uri", label: "แก้ไข", uri: input.editUrl }
            : {
                type: "postback",
                label: "แก้ไข",
                data: `a=edit&id=${input.txId}`,
                displayText: "แก้ไข",
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
            label: "ลบ",
            data: `a=del&id=${input.txId}`,
            displayText: "ลบรายการ",
          },
          "36px",
          "32px",
        ),
      ],
    },
  ];

  if (input.budget) {
    body.push(budgetBlock(input.budget, input.cycleLabel));
  } else if (total !== null) {
    body.push(
      { type: "separator", margin: "md" },
      {
        type: "box",
        layout: "horizontal",
        spacing: "md",
        margin: "md",
        alignItems: "center",
        contents: [
          {
            type: "text",
            text: category,
            weight: "bold",
            size: "md",
            color: "#14352E",
            wrap: true,
            flex: 1,
          },
          {
            type: "box",
            layout: "vertical",
            flex: 1,
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: `${money(total)}`,
                weight: "bold",
                size: "md",
                color: accent,
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
                    width: `${Math.round(share)}%`,
                    height: "8px",
                    cornerRadius: "4px",
                    backgroundColor: accent,
                    contents: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
    if (input.cycleLabel) {
      body.push({
        type: "text",
        text: `รอบงบ: ${input.cycleLabel}`,
        size: "xs",
        color: COLOR.muted,
        align: "end",
        margin: "sm",
      });
    }
  }

  body.push(...noticeBoxes(input.notices ?? []));

  if (input.walletChoices && input.walletChoices.length > 0) {
    body.push(
      ...paymentRow(
        input.walletChoices.map((w) => ({
          label: w.label,
          selected: w.selected,
          action: {
            type: "postback",
            label: "จ่ายด้วย",
            data: `a=wm&id=${input.txId}&w=${w.id}`,
            displayText: `จ่ายด้วย ${w.label}`.slice(0, 40),
          },
        })),
        input.moreWallets
          ? {
              type: "postback",
              label: "อื่น ๆ",
              data: `a=wl&id=${input.txId}`,
              displayText: "เลือกช่องทางอื่น",
            }
          : undefined,
        input.addWalletUrl?.startsWith("https://")
          ? { type: "uri", label: "เพิ่มช่องทาง", uri: input.addWalletUrl }
          : undefined,
      ),
    );
  } else if (input.canMoveWallet) {
    body.push({
      type: "button",
      style: "link",
      height: "sm",
      action: {
        type: "postback",
        label: "💳 ย้ายกระเป๋า",
        data: `a=wl&id=${input.txId}`,
        displayText: "ย้ายกระเป๋า",
      },
    });
  }

  return {
    type: "flex",
    altText: `จดแล้ว: ${input.title} ${amountText}`,
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
      ...(input.photoButton
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              backgroundColor: COLOR.surface,
              paddingTop: "0px",
              paddingBottom: "12px",
              paddingStart: "12px",
              paddingEnd: "12px",
              contents: [attachPhotoPill(input.txId)],
            },
          }
        : {}),
    },
  };
}
/** Ask whether an ambiguous entry is income or expense (Quick Reply). */
export function buildTypeQuestion(input: {
  txId: string;
  title: string;
  amountSatang: number;
}): LineMessage {
  const action = (label: string, t: string) => ({
    type: "action",
    action: {
      type: "postback",
      label,
      data: `a=pt&id=${input.txId}&t=${t}`,
      displayText: label,
    },
  });
  return {
    type: "text",
    text: `${input.title} ${money(input.amountSatang)} เป็นรายรับหรือรายจ่ายนะ?`,
    quickReply: {
      items: [action("รายจ่าย", "expense"), action("รายรับ", "income"), action("ยกเลิก", "cancel")],
    },
  };
}

/**
 * Card shown when the Rich Menu "พี่ฮูก" tile is tapped: how to type an entry, plus a button that
 * opens the keyboard (no text is prefilled, so nothing can be sent by accident).
 */
export function buildComposeCard(): LineMessage {
  const bullet = (t: string) => ({
    type: "box",
    layout: "baseline",
    spacing: "md",
    contents: [
      { type: "text", text: "●", size: "xs", color: "#1ABC9C", flex: 0 },
      { type: "text", text: t, size: "md", weight: "bold", color: "#334155", flex: 1 },
    ],
  });
  return {
    type: "flex",
    altText: "พิมพ์บอกพี่ฮูกได้เลย เช่น กระเพราหมูกรอบ 65 · เงินเดือน 25000",
    // pick a category first, then only the amount is left to type (see buildCategoryKeyboardList);
    // or pick a past day first (see buildDatePicker)
    quickReply: {
      items: [
        ...(
          [
            ["หมวดรายจ่าย", "expense"],
            ["หมวดรายรับ", "income"],
          ] as const
        ).map(([label, t]) => ({
          type: "action",
          action: { type: "postback", label, data: `a=cp&t=${t}`, displayText: label },
        })),
        {
          type: "action",
          action: {
            type: "postback",
            label: "📅 จดย้อนหลัง",
            data: "a=bd",
            displayText: "จดย้อนหลัง",
          },
        },
      ],
    },
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        paddingAll: "12px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            alignItems: "center",
            contents: [
              {
                type: "box",
                layout: "vertical",
                width: "44px",
                height: "44px",
                cornerRadius: "22px",
                backgroundColor: COLOR.primarySoft,
                justifyContent: "center",
                alignItems: "center",
                flex: 0,
                contents: [{ type: "text", text: "✒️", size: "lg", align: "center" }],
              },
              {
                type: "text",
                text: "พิมพ์บอกพี่ฮูกได้เลย เช่น",
                weight: "bold",
                size: "md",
                color: "#334155",
                wrap: true,
                flex: 1,
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "md",
            backgroundColor: "#F6F9F8",
            cornerRadius: "14px",
            paddingAll: "12px",
            contents: [bullet("กระเพราหมูกรอบ 65"), bullet("เงินเดือน 25000")],
          },
          {
            type: "text",
            text: "ระบบจะช่วยจดและแยกหมวดหมู่อัตโนมัติทันทีครับ ✨",
            size: "sm",
            color: COLOR.primary,
            wrap: true,
          },
          {
            type: "button",
            style: "primary",
            color: "#1ABC9C",
            height: "sm",
            action: {
              type: "postback",
              label: "จดเลย",
              data: "a=compose-go",
              inputOption: "openKeyboard",
            },
          },
        ],
      },
    },
  };
}

export interface ComposeCategory {
  name: string;
  /** `categories.icon`: an emoji is shown in front of the name on the button. */
  icon?: string | null;
  type: TxType;
  sort_order: number;
  is_hidden: boolean;
}

const MAX_COMPOSE_CATEGORIES = 13; // LINE allows 13 quick-reply buttons
const MAX_COMPOSE_LABEL = 20; // LINE label limit
const CATCH_ALL_NAME = "อื่นๆ"; // exists for both types, so a typed name could not tell them apart

/**
 * Quick Reply list of one type's categories. Tapping one opens the keyboard with the category
 * name already in the box, so the person only types the amount ("อาหาร " + "50"); the text
 * handler then reads the leading category name. Nothing is stored between the two taps.
 */
export function buildCategoryKeyboardList(
  type: TxType,
  categories: ComposeCategory[],
): LineMessage {
  const shown = categories
    .filter((c) => c.type === type && !c.is_hidden && c.name !== CATCH_ALL_NAME)
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, MAX_COMPOSE_CATEGORIES);
  if (shown.length === 0) {
    return {
      type: "text",
      text: 'ยังไม่มีหมวดให้เลือก พิมพ์จดได้เลย เช่น "กาแฟ 30" นะ',
    };
  }
  return {
    type: "text",
    text: "เลือกหมวด แล้วพิมพ์แค่ตัวเลขจำนวนเงินได้เลย เช่น 50",
    quickReply: {
      items: shown.map((c) => ({
        type: "action",
        action: {
          type: "postback",
          label: categoryLabel(c.name, c.icon).slice(0, MAX_COMPOSE_LABEL),
          data: "a=cc",
          inputOption: "openKeyboard",
          fillInText: `${c.name} `,
        },
      })),
    },
  };
}

/** "Send the photo now": camera and gallery shortcuts under the question. */
export function buildPhotoAsk(message: string): LineMessage {
  return {
    type: "text",
    text: message,
    quickReply: {
      items: [
        { type: "action", action: { type: "camera", label: "ถ่ายรูป" } },
        { type: "action", action: { type: "cameraRoll", label: "เลือกจากอัลบั้ม" } },
      ],
    },
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => {
  const p = bangkokParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};
const DAY_MS = 86_400_000;
/** How far back the date picker goes. */
export const BACKDATE_MAX_DAYS = 366;

/**
 * Step 1 of "จดย้อนหลัง": the LINE calendar (a quick-reply date picker). It reaches back a year
 * and up to today; the chosen day comes back as a postback `a=bdp` with `params.date`.
 */
export function buildDatePicker(now: Date): LineMessage {
  return {
    type: "text",
    text: "เลือกวันที่ที่ต้องการจดย้อนหลังได้เลย",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "datetimepicker",
            label: "เลือกวันที่",
            data: "a=bdp",
            mode: "date",
            initial: ymd(new Date(now.getTime() - DAY_MS)),
            max: ymd(now),
            min: ymd(new Date(now.getTime() - BACKDATE_MAX_DAYS * DAY_MS)),
          },
        },
      ],
    },
  };
}

/** The text a backdated entry starts with: "12/10/2026 " (the parser reads it as that day). */
export function backdatePrefix(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year} `;
}

/**
 * Step 2: the day is chosen, so open the keyboard with it already typed. The person adds the item
 * and amount ("กาแฟ 60"); nothing is stored between the two steps.
 */
export function buildBackdatePrompt(isoDate: string, thaiDate: string): LineMessage {
  return {
    type: "text",
    text: `จดย้อนหลังวันที่ ${thaiDate} พิมพ์ชื่อรายการและจำนวนเงินต่อได้เลย เช่น กาแฟ 60`,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "พิมพ์รายการ",
            data: "a=bdk",
            inputOption: "openKeyboard",
            fillInText: backdatePrefix(isoDate),
          },
        },
      ],
    },
  };
}

/**
 * Shortcuts under a summary card: the calendar range (its plan is checked when tapped), the spend
 * by category and the latest entries (the last two just send the command as a message).
 */
export function withSummaryShortcuts(message: LineMessage): LineMessage {
  return {
    ...message,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "📆 ช่วงวันเอง",
            data: "a=sr",
            displayText: "ช่วงวันเอง",
          },
        },
        { type: "action", action: { type: "message", label: "📊 ตามหมวด", text: "สรุปหมวด" } },
        { type: "action", action: { type: "message", label: "🕘 ล่าสุด", text: "ล่าสุด" } },
        { type: "action", action: { type: "message", label: "📈 เทียบเดือน", text: "เทียบเดือน" } },
        { type: "action", action: { type: "message", label: "🗓️ ทั้งปี", text: "สรุปปี" } },
        { type: "action", action: { type: "message", label: "🔮 พยากรณ์", text: "พยากรณ์" } },
        { type: "action", action: { type: "message", label: "🧠 วิเคราะห์", text: "วิเคราะห์" } },
      ],
    },
  };
}

const RANGE_START_YEARS_BACK = 3;

/** Step 1 of a custom range: the first day. The pick comes back as `a=sr1` with params.date. */
export function buildRangeStartPicker(now: Date): LineMessage {
  return {
    type: "text",
    text: "เลือกวันเริ่มต้นของช่วงที่ต้องการสรุป",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "datetimepicker",
            label: "วันเริ่มต้น",
            data: "a=sr1",
            mode: "date",
            initial: ymd(new Date(now.getTime() - 30 * DAY_MS)),
            max: ymd(now),
            min: ymd(new Date(now.getTime() - RANGE_START_YEARS_BACK * 366 * DAY_MS)),
          },
        },
      ],
    },
  };
}

/** Step 2: the last day, from the chosen first day up to today. The first day rides in `data`. */
export function buildRangeEndPicker(startIso: string, thaiStart: string, now: Date): LineMessage {
  return {
    type: "text",
    text: `เริ่มวันที่ ${thaiStart} เลือกวันสิ้นสุดต่อได้เลย`,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "datetimepicker",
            label: "วันสิ้นสุด",
            data: `a=sr2&f=${startIso}`,
            mode: "date",
            initial: ymd(now),
            max: ymd(now),
            min: startIso,
          },
        },
      ],
    },
  };
}
