import { formatBaht } from "@/lib/money";
import { maskPromptPayId } from "@/lib/promptpay";
import {
  MAX_PAID_BUTTONS,
  totalOwed,
  unpaid,
  type BillMemberRow,
  type BillRow,
} from "@/lib/split-bill";
import type { PaymentAccount } from "@/lib/split-bill-repo";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";
import { topicBubble } from "./help-flex";

const PAID_BG = "#E8F8EF";
const OWED_BG = "#FFF1E5";
const CLAIMED_BG = "#FFF8DB";

const baht = (satang: number) => `฿${formatBaht(satang)}`;

const postback = (label: string, data: string, displayText: string) => ({
  type: "postback",
  label: label.slice(0, 20),
  data,
  displayText,
});

const button = (style: "primary" | "secondary" | "link", action: unknown) => ({
  type: "button",
  style,
  height: "sm",
  ...(style === "primary" ? { color: COLOR.primary } : {}),
  action,
});

const tile = (bg: string, left: string, right: string, sub?: string) => ({
  type: "box",
  layout: "horizontal",
  alignItems: "center",
  spacing: "md",
  margin: "sm",
  paddingAll: "10px",
  cornerRadius: "12px",
  backgroundColor: bg,
  contents: [
    {
      type: "box",
      layout: "vertical",
      flex: 1,
      spacing: "xs",
      contents: [
        { type: "text", text: left, size: "sm", weight: "bold", color: "#14352E", wrap: true },
        ...(sub ? [{ type: "text", text: sub, size: "xs", color: COLOR.muted, wrap: true }] : []),
      ],
    },
    {
      type: "text",
      text: right,
      size: "sm",
      weight: "bold",
      color: "#14352E",
      flex: 0,
      align: "end",
    },
  ],
});

/** The line under a name on the collecting card: how this share stands. */
function statusOf(m: BillMemberRow, payer: string): string {
  if (m.lineUserId === payer) return "คนจ่าย";
  if (m.paid) return "✅ จ่ายแล้ว (คนจ่ายยืนยัน)";
  if (m.claimed) {
    return m.claimVia === "slip"
      ? "🕒 ส่งสลิปแล้ว (ตรวจแล้ว) รอคนจ่ายยืนยัน"
      : m.claimVia === "slip_unverified"
        ? "🕒 ส่งสลิปแล้ว (ตรวจผู้รับไม่ได้) รอคนจ่ายยืนยัน"
        : "🕒 แจ้งโอนแล้ว รอคนจ่ายยืนยัน";
  }
  return "⏳ ยังไม่จ่าย";
}

/** The bill after the list is closed: everyone's share and whether it is paid, with the pay buttons. */
export function buildBillCollectingCard(input: {
  bill: BillRow;
  payerName: string;
  members: BillMemberRow[];
  nameOf: (lineUserId: string) => string;
  appUrl?: string;
}): LineMessage {
  const { bill, members } = input;
  const left = unpaid(members, bill.payerLineUserId);
  const settled = left.length === 0;
  const tiles = members.map((m) =>
    tile(
      m.paid ? PAID_BG : m.claimed ? CLAIMED_BG : OWED_BG,
      input.nameOf(m.lineUserId),
      baht(m.shareSatang ?? 0),
      statusOf(m, bill.payerLineUserId),
    ),
  );
  // people who said "โอนแล้ว" come first: those are the ones the payer should look at
  const toTick = [...left].sort((a, b) => Number(b.claimed ?? false) - Number(a.claimed ?? false));
  return {
    type: "flex",
    altText: settled
      ? `${bill.title}: เก็บครบแล้ว 🎉`
      : `${bill.title}: ค้าง ${left.length} คน ${baht(totalOwed(members, bill.payerLineUserId))}`,
    contents: topicBubble({
      icon: settled ? "🎉" : "💸",
      title: settled ? `${bill.title} เก็บครบแล้ว` : bill.title,
      subtitle: `${baht(bill.amountSatang)} · หาร ${members.length} คน · จ่ายโดย ${input.payerName}`,
      appUrl: input.appUrl,
      body: [
        ...tiles,
        ...(settled
          ? []
          : [
              {
                type: "text",
                text: `ยังค้าง ${left.length} คน รวม ${baht(totalOwed(members, bill.payerLineUserId))}`,
                size: "xs",
                color: COLOR.muted,
                margin: "lg",
                wrap: true,
              },
            ]),
      ],
      footer: settled
        ? [
            {
              type: "text",
              text: "ทุกคนจ่ายครบแล้ว ขอบคุณที่ช่วยกันนะ",
              size: "xs",
              color: COLOR.muted,
              wrap: true,
            },
          ]
        : [
            button(
              "primary",
              postback("💸 จ่ายส่วนของฉัน", `a=gbq&b=${bill.id}`, "จ่ายส่วนของฉัน"),
            ),
            button("secondary", postback("📨 โอนแล้ว", `a=gbm&b=${bill.id}`, "โอนแล้ว")),
            ...toTick
              .slice(0, MAX_PAID_BUTTONS)
              .map((m) =>
                button(
                  "secondary",
                  postback(
                    `✅ ได้รับจาก ${input.nameOf(m.lineUserId)}`,
                    `a=gbp&b=${bill.id}&u=${m.lineUserId}`,
                    `ได้รับเงินจาก ${input.nameOf(m.lineUserId)}`,
                  ),
                ),
              ),
            {
              type: "text",
              text:
                "โอนแล้วส่งรูปสลิปเข้ากลุ่มได้เลย บอทตรวจยอดให้ แต่ต้องรอคนจ่ายกด ✅ ยืนยันว่าเงินเข้าจริง (กดได้เฉพาะคนจ่าย)" +
                (left.length > MAX_PAID_BUTTONS ? " (คนที่เหลือพิมพ์ ได้รับแล้ว ชื่อ)" : ""),
              size: "xs",
              color: COLOR.muted,
              wrap: true,
              margin: "sm",
            },
          ],
    }),
  };
}

/** One person's QR: the amount is inside the code, so the banking app fills it in. */
export function billQrBubble(input: {
  title: string;
  who: string;
  payerName: string;
  shareSatang: number;
  payment: PaymentAccount | null;
  qrUrl?: string;
}) {
  const { payment } = input;
  const hasPromptPay = Boolean(payment?.promptpayId) && Boolean(input.qrUrl);
  const hasBank = Boolean(payment?.bankAccount);
  const lines: unknown[] = [];
  if (payment?.promptpayId) {
    lines.push({
      type: "text",
      text: `พร้อมเพย์ ${maskPromptPayId(payment.promptpayId)}`,
      size: "sm",
      color: "#14352E",
      align: "center",
    });
  }
  if (hasBank && payment) {
    lines.push({
      type: "text",
      text: `${payment.bankName ?? "ธนาคาร"} ${payment.bankAccount}`,
      size: "md",
      weight: "bold",
      color: "#14352E",
      align: "center",
      wrap: true,
      margin: "sm",
    });
    if (payment.accountName) {
      lines.push({
        type: "text",
        text: payment.accountName,
        size: "xs",
        color: COLOR.muted,
        align: "center",
        wrap: true,
      });
    }
    lines.push({
      type: "text",
      text: "กดค้างที่เลขบัญชีเพื่อคัดลอก",
      size: "xs",
      color: COLOR.muted,
      align: "center",
    });
  }
  const missing = !hasPromptPay && !hasBank;
  return topicBubble({
    icon: "💸",
    title: `ส่วนของ ${input.who}`,
    subtitle: `${input.title} · โอนให้ ${input.payerName}`,
    tagline: "สแกนในแอปธนาคาร ยอดเงินจะขึ้นให้เอง",
    body: [
      {
        type: "text",
        text: baht(input.shareSatang),
        size: "lg",
        weight: "bold",
        color: COLOR.primary,
        align: "center",
        margin: "md",
      },
      ...(hasPromptPay && input.qrUrl
        ? [
            {
              type: "image",
              url: input.qrUrl,
              size: "full",
              aspectMode: "fit",
              aspectRatio: "1:1",
              margin: "md",
            },
          ]
        : []),
      ...lines,
      ...(missing
        ? [
            {
              type: "text",
              text: `${input.payerName} ยังไม่ได้ตั้งพร้อมเพย์หรือบัญชี ให้พิมพ์ “พร้อมเพย์ 0812345678” ในแชทส่วนตัวกับบอทก่อน แล้วกด “จ่ายส่วนของฉัน” อีกครั้ง`,
              size: "xs",
              color: COLOR.muted,
              wrap: true,
              margin: "md",
            },
          ]
        : []),
      ...(hasPromptPay
        ? [
            {
              type: "text",
              text: "กดรูป QR ค้างเพื่อบันทึก แล้วในแอปธนาคารเลือก “สแกนจากรูป/อัลบั้ม”",
              size: "xs",
              color: COLOR.muted,
              wrap: true,
              align: "center",
              margin: "md",
            },
          ]
        : []),
    ],
    ...(hasPromptPay && input.qrUrl
      ? {
          footer: [
            button("secondary", {
              type: "uri",
              label: "🔍 เปิดรูป QR ขนาดใหญ่",
              uri: input.qrUrl,
            }),
          ],
        }
      : {}),
  });
}

/** One person's QR as a message of its own. */
export function buildBillQrCard(input: Parameters<typeof billQrBubble>[0]): LineMessage {
  return {
    type: "flex",
    altText: `${input.who} โอน ${baht(input.shareSatang)} ให้ ${input.payerName} (${input.title})`,
    contents: billQrBubble(input),
  };
}

/**
 * Everyone's QR at once, as swipeable cards (LINE shows up to 12 bubbles in one carousel, so a long list
 * is cut into several messages).
 */
export function buildBillQrCarousels(
  bubbles: { who: string; shareSatang: number; bubble: ReturnType<typeof billQrBubble> }[],
  title: string,
  payerName: string,
): LineMessage[] {
  const out: LineMessage[] = [];
  for (let i = 0; i < bubbles.length; i += 12) {
    const part = bubbles.slice(i, i + 12);
    out.push({
      type: "flex",
      altText: `QR จ่ายบิล ${title} ให้ ${payerName}: ${part.map((b) => `${b.who} ${baht(b.shareSatang)}`).join(", ")}`,
      contents: { type: "carousel", contents: part.map((b) => b.bubble) },
    });
  }
  return out;
}

/** The card a new bill starts with: pick who shares it (on the LIFF page), or everyone at once. */
export function buildBillSetupCard(input: {
  bill: BillRow;
  payerName: string;
  /** The LIFF page that lets the payer tick the people; absent when LIFF is not set up. */
  pickUrl?: string;
  appUrl?: string;
}): LineMessage {
  const { bill } = input;
  return {
    type: "flex",
    altText: `หารบิล ${bill.title} ${baht(bill.amountSatang)} · เลือกคนหาร`,
    contents: topicBubble({
      icon: "🍽️",
      title: bill.title,
      subtitle: `${baht(bill.amountSatang)} · จ่ายโดย ${input.payerName}`,
      appUrl: input.appUrl,
      body: [
        {
          type: "text",
          text: "ขั้นต่อไป: เลือกคนที่หารบิลนี้",
          size: "sm",
          weight: "bold",
          color: "#14352E",
          margin: "sm",
          wrap: true,
        },
        {
          type: "text",
          text: "เพื่อนกด “ร่วมหารด้วย” เองได้ คนจ่ายเลือก/เพิ่ม/เอาออกได้ เลือกเสร็จ บอทจะหารเท่ากัน แล้วส่ง QR พร้อมเพย์ของแต่ละคนเข้ากลุ่มให้สแกนจ่ายได้เลย (เฉพาะคนจ่ายกดเลือกคน)",
          size: "xs",
          color: COLOR.muted,
          wrap: true,
          margin: "md",
        },
      ],
      footer: [
        ...(input.pickUrl
          ? [button("primary", { type: "uri", label: "👥 เลือกคนหาร", uri: input.pickUrl })]
          : []),
        button(
          input.pickUrl ? "secondary" : "primary",
          postback("ทั้งหมดเลย", `a=gba&b=${bill.id}`, "ทั้งหมดเลย"),
        ),
        // anyone in the group can add themselves while the payer is choosing
        button("secondary", postback("🙋 ร่วมหารด้วย", `a=gbj&b=${bill.id}`, "ร่วมหาร")),
        button(
          "secondary",
          postback("📣 ส่ง QR เข้ากลุ่ม", `a=gbn&b=${bill.id}`, "ส่ง QR เข้ากลุ่ม"),
        ),
        button("link", postback("✖ ยกเลิกบิล", `a=gbx&b=${bill.id}`, "ยกเลิกบิล")),
      ],
    }),
  };
}

/** "ตามเงิน": who still owes, bill by bill. */
export function buildChaseCard(input: {
  bills: { bill: BillRow; members: BillMemberRow[]; payerName: string }[];
  nameOf: (lineUserId: string) => string;
  appUrl?: string;
}): LineMessage {
  const total = input.bills.reduce((s, b) => s + totalOwed(b.members, b.bill.payerLineUserId), 0);
  const blocks = input.bills.slice(0, 6).flatMap(({ bill, members, payerName }) => {
    const left = unpaid(members, bill.payerLineUserId);
    return [
      {
        type: "text",
        text: `🍽️ ${bill.title} · จ่ายโดย ${payerName}`,
        size: "xs",
        weight: "bold",
        color: COLOR.muted,
        wrap: true,
        margin: "lg",
      },
      ...left
        .slice(0, 12)
        .map((m) => tile(OWED_BG, input.nameOf(m.lineUserId), baht(m.shareSatang ?? 0))),
      ...(left.length > 12
        ? [{ type: "text", text: `…และอีก ${left.length - 12} คน`, size: "xs", color: COLOR.muted }]
        : []),
    ];
  });
  return {
    type: "flex",
    altText: `ตามเงิน: ค้างรวม ${baht(total)}`,
    contents: topicBubble({
      icon: "📣",
      title: "ตามเงิน",
      subtitle: `ยอดที่ยังค้างรวม ${baht(total)}`,
      tagline: "กด “จ่ายส่วนของฉัน” ที่การ์ดบิลเพื่อรับ QR ยอดของตัวเอง",
      appUrl: input.appUrl,
      body: blocks,
    }),
  };
}
