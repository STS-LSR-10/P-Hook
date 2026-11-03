import { formatBaht } from "@/lib/money";
import { balanceOf, totalBalance, walletLabel, type Wallet } from "@/lib/wallet";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";

const money = (satang: number) => `${satang < 0 ? "-" : ""}฿${formatBaht(Math.abs(satang))}`;

/** "กระเป๋า": every wallet with its balance, the total, and a button to the web page. */
export function buildWalletsCard(input: {
  wallets: Wallet[];
  /** Whether more wallets can be added on this plan. */
  canAdd: boolean;
  manageUrl?: string;
}): LineMessage {
  const rows = input.wallets.map((w) => {
    const balance = balanceOf(w);
    return {
      type: "box",
      layout: "horizontal",
      margin: "md",
      contents: [
        {
          type: "text",
          text: `${walletLabel(w)}${w.isDefault && input.wallets.length > 1 ? " (หลัก)" : ""}${w.shared ? ` · ${w.memberCount ?? 1} คน` : ""}`,
          size: "sm",
          color: COLOR.text,
          wrap: true,
          flex: 5,
        },
        {
          type: "text",
          text: money(balance),
          size: "sm",
          weight: "bold",
          color: balance < 0 ? COLOR.expense : COLOR.income,
          align: "end",
          flex: 4,
        },
      ],
    };
  });

  const total = totalBalance(input.wallets);
  const body: unknown[] = [...rows];
  if (input.wallets.length > 1) {
    body.push(
      { type: "separator", margin: "lg" },
      {
        type: "box",
        layout: "horizontal",
        margin: "lg",
        contents: [
          { type: "text", text: "รวมทุกกระเป๋า", weight: "bold", size: "md", flex: 5 },
          {
            type: "text",
            text: money(total),
            weight: "bold",
            size: "md",
            color: total < 0 ? COLOR.expense : COLOR.income,
            align: "end",
            flex: 4,
          },
        ],
      },
    );
  }
  body.push({
    type: "text",
    text: input.canAdd
      ? 'จดลงกระเป๋าอื่นได้โดยใส่ @ชื่อ เช่น "กาแฟ 45 @บัตร"'
      : "แผนนี้เพิ่มกระเป๋าไม่ได้แล้ว อัปเกรดเพื่อเพิ่มกระเป๋าได้นะ",
    size: "xs",
    color: COLOR.muted,
    wrap: true,
    margin: "lg",
  });

  return {
    type: "flex",
    altText: `กระเป๋าเงิน รวม ${money(total)}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        contents: [
          { type: "text", text: "กระเป๋าเงิน", weight: "bold", size: "lg", color: "#0B5D4F" },
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
                  action: { type: "uri", label: "จัดการกระเป๋า", uri: input.manageUrl },
                },
              ],
            },
          }
        : {}),
    },
  };
}

/** Quick Reply with every wallet to move an entry to (a=wm taps are silent). */
export function buildWalletChooser(input: {
  txId: string;
  /** Moves every entry of this slip instead of the one entry `txId`. */
  slipId?: string;
  wallets: Wallet[];
  currentId: string | null;
  text: string;
}): LineMessage {
  return {
    type: "text",
    text: input.text,
    quickReply: {
      items: input.wallets
        .filter((w) => w.id !== input.currentId)
        .slice(0, 13)
        .map((w) => ({
          type: "action",
          action: {
            type: "postback",
            label: walletLabel(w).slice(0, 20),
            data: input.slipId
              ? `a=wms&s=${input.slipId}&w=${w.id}`
              : `a=wm&id=${input.txId}&w=${w.id}`,
            displayText: walletLabel(w).slice(0, 20),
          },
        })),
    },
  };
}

/** "โอนแล้ว" with the two balances now, and a Quick Reply to undo it. */
export function buildTransferDone(input: { transferId: string; text: string }): LineMessage {
  return {
    type: "text",
    text: input.text,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "↩ ยกเลิกการโอน",
            data: `a=tc&id=${input.transferId}`,
            displayText: "ยกเลิกการโอน",
          },
        },
      ],
    },
  };
}
