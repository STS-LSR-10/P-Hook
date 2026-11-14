import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupRow } from "@/lib/group";
import { inChaseWindow } from "@/lib/chase-schedule";
import { getChaseSchedule, memberNames } from "@/lib/group-repo";
import { formatBaht } from "@/lib/money";
import { resolveNames } from "@/lib/trip";
import {
  MAX_BILL_MEMBERS,
  billShares,
  totalOwed,
  unpaid,
  type BillCommand,
  type BillRow,
} from "@/lib/split-bill";
import {
  billMembers,
  cancelBill,
  closeBill,
  confirmBill,
  findBillByShortId,
  createBill,
  getBill,
  getPaymentByLine,
  joinBill,
  latestBillBy,
  listBills,
  claimPaid,
  markAnnounced,
  markReminded,
  markPaid,
  openSharesOf,
  unpay,
} from "@/lib/split-bill-repo";
import { bangkokDateKey } from "@/lib/points";
import { bangkokParts } from "@/lib/thai-date";
import { GROUP_REMINDS_PER_MONTH, type Plan } from "@/lib/plan";
import { log } from "@/lib/log";
import { monthKey, refundUsage, takeUsage } from "@/lib/usage";
import type { LineMessage } from "@/lib/types";
import {
  billQrBubble,
  buildBillCollectingCard,
  buildBillQrCard,
  buildBillQrCarousels,
  buildBillSetupCard,
  buildChaseCard,
} from "./split-bill-flex";
import { text } from "./messages";

type Reply = (messages: LineMessage[]) => Promise<void>;

export interface BillContext {
  db: SupabaseClient;
  group: GroupRow;
  /** The person who typed or tapped (absent when LINE did not say who). */
  userId: string | undefined;
  /** The ledger's owner is still on a plan with group ledgers (read-only otherwise). */
  writable: boolean;
  /** The owner's plan: it sets the group's limits. */
  ownerPlan: Plan;
  isOwner: boolean;
  /** The name to show for a member, fetching it from LINE when it is not known yet. */
  knownName: (userId: string) => Promise<string>;
  appUrl: string | undefined;
  reply: Reply;
}

const NAME_FALLBACK = "สมาชิกกลุ่ม";
const baht = (satang: number) => `฿${formatBaht(satang)}`;

export const BILL_USAGE_TEXT =
  'คนที่จ่ายก่อนพิมพ์ เช่น "หารบิล หมูกระทะ 1200" (ใส่ชื่อคนที่หารต่อท้ายได้ เช่น "หารบิล หมูกระทะ 1200 แอน บ๊อบ") เพื่อนที่ไปด้วยกดปุ่ม "ร่วมหาร" แล้วคนจ่ายกด "ปิดรายชื่อ" บอทจะหารเท่ากันให้';
const NO_USER_TEXT =
  "บอทยังไม่รู้ว่าใครพิมพ์ ให้เพิ่มบอทเป็นเพื่อน (และยอมรับข้อกำหนดของ LINE OA) ก่อน แล้วลองใหม่นะ";
const PAUSED_TEXT = "สมุดกลุ่มนี้หยุดจดชั่วคราว เพราะแผนของเจ้าของสมุดหมดอายุ ดูยอดค้างได้ตามปกติ";
const TOO_MANY_TEXT = "มีบิลที่ยังไม่เสร็จครบ 10 บิลแล้ว ปิดหรือยกเลิกบิลเก่าก่อนนะ";
const NO_BILL_TEXT = "ไม่เจอบิลของคุณที่รออยู่ ลองพิมพ์ “หารบิล ชื่อ ยอด” เพื่อเริ่มบิลใหม่นะ";
const NOT_PAYER_TEXT = "เฉพาะคนที่จ่ายบิลนี้ (หรือเจ้าของสมุด) ทำได้นะ";
const BILL_GONE_TEXT = "ไม่พบบิลนี้แล้ว";
const NONE_OWED_TEXT = "ตอนนี้ไม่มียอดค้างเลย 🎉";
const ALONE_TEXT = "ยังไม่มีใครร่วมหารนอกจากคนจ่าย ให้เพื่อนกด “ร่วมหาร” ก่อนนะ";

const joinedText = (who: string, title: string, count: number) =>
  `${who} ร่วมหาร "${title}" แล้ว (ตอนนี้ ${count} คน)`;

async function names(db: SupabaseClient, groupId: string) {
  const map = await memberNames(db, groupId);
  return (id: string) => map.get(id)?.name ?? NAME_FALLBACK;
}

/** Everyone may open a bill; only who paid it (or the owner of the ledger) closes, cancels or ticks it. */
const mayManage = (ctx: BillContext, bill: BillRow) =>
  ctx.isOwner || (ctx.userId !== undefined && ctx.userId === bill.payerLineUserId);

/**
 * Whether money arrived is for the person who paid the bill to say, and nobody else (not the one who
 * reported it, not the ledger's owner): this guards the confirm / take-back buttons against false claims.
 */
const isPayer = (ctx: BillContext, bill: BillRow) =>
  ctx.userId !== undefined && ctx.userId === bill.payerLineUserId;

const ONLY_PAYER_CONFIRMS_TEXT =
  "ปุ่มนี้กดได้เฉพาะคนที่จ่ายบิลนี้ (คนสร้างบิล) เท่านั้นนะ เพราะมีแค่เขาที่เห็นว่าเงินเข้าบัญชีจริงไหม";

export async function collectingCardFor(ctx: BillContext, bill: BillRow): Promise<LineMessage> {
  const [members, nameOf] = await Promise.all([
    billMembers(ctx.db, bill.id),
    names(ctx.db, ctx.group.id),
  ]);
  return buildBillCollectingCard({
    bill,
    payerName: nameOf(bill.payerLineUserId),
    members,
    nameOf,
    appUrl: ctx.appUrl,
  });
}

async function closeFlow(ctx: BillContext, bill: BillRow): Promise<void> {
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  if (!mayManage(ctx, bill)) return ctx.reply([text(NOT_PAYER_TEXT)]);
  if (bill.status !== "joining") return ctx.reply([text("บิลนี้ปิดรายชื่อไปแล้วนะ")]);
  const members = await billMembers(ctx.db, bill.id);
  if (members.length < 2) return ctx.reply([text(ALONE_TEXT)]);
  const shares = billShares(
    bill.amountSatang,
    members.map((m) => m.lineUserId),
    bill.payerLineUserId,
  );
  const closed = await closeBill(ctx.db, bill.id, shares);
  if (!closed) return ctx.reply([text("บิลนี้ปิดรายชื่อไปแล้วนะ")]);
  const fresh = (await getBill(ctx.db, ctx.group.id, bill.id)) ?? bill;
  const messages: LineMessage[] = [await collectingCardFor(ctx, fresh)];
  const payment = await getPaymentByLine(ctx.db, bill.payerLineUserId);
  if (!payment || (!payment.promptpayId && !payment.bankAccount)) {
    const payerName = (await names(ctx.db, ctx.group.id))(bill.payerLineUserId);
    messages.push(
      text(
        `${payerName} ยังไม่ได้ตั้งพร้อมเพย์ ถ้าอยากให้เพื่อนสแกนจ่ายได้เลย พิมพ์ “พร้อมเพย์ 0812345678” ในแชทส่วนตัวกับบอทนะ`,
      ),
    );
  }
  return ctx.reply(messages);
}

async function cancelFlow(ctx: BillContext, bill: BillRow): Promise<void> {
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  if (!mayManage(ctx, bill)) return ctx.reply([text(NOT_PAYER_TEXT)]);
  const done = await cancelBill(ctx.db, bill.id);
  return ctx.reply([
    text(done ? `ยกเลิกบิล "${bill.title}" แล้ว` : "บิลนี้เสร็จหรือถูกยกเลิกไปแล้วนะ"),
  ]);
}

async function paidFlow(ctx: BillContext, bill: BillRow, targets: string[]): Promise<void> {
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  if (!isPayer(ctx, bill)) return ctx.reply([text(ONLY_PAYER_CONFIRMS_TEXT)]);
  const nameOf = await names(ctx.db, ctx.group.id);
  const lines: string[] = [];
  for (const id of targets) {
    const result = await markPaid(ctx.db, bill.id, id);
    lines.push(
      result === "ok"
        ? `✅ รับเงินจาก ${nameOf(id)} แล้ว`
        : result === "already"
          ? `${nameOf(id)} จ่ายแล้วก่อนหน้านี้`
          : `${nameOf(id)} ไม่ได้อยู่ในบิลนี้ หรือบิลยังไม่ปิดรายชื่อ`,
    );
  }
  const fresh = (await getBill(ctx.db, ctx.group.id, bill.id)) ?? bill;
  return ctx.reply([text(lines.join("\n")), await collectingCardFor(ctx, fresh)]);
}

/** "โอนแล้ว": a friend says they paid; the payer is asked to confirm. */
async function claimFlow(ctx: BillContext, bill: BillRow): Promise<void> {
  if (!ctx.userId) return ctx.reply([text(NO_USER_TEXT)]);
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  if (bill.status === "joining")
    return ctx.reply([text("ยังไม่ปิดรายชื่อ รอให้คนจ่ายกด “ปิดรายชื่อ” ก่อนนะ")]);
  const result = await claimPaid(ctx.db, bill.id, ctx.userId);
  if (result === "none")
    return ctx.reply([text("คุณไม่ได้อยู่ในรายชื่อหารของบิลนี้ หรือบิลนี้เก็บเสร็จแล้วนะ")]);
  if (result === "already")
    return ctx.reply([text("แจ้งโอนไปแล้ว หรือส่วนของคุณจ่ายเรียบร้อยแล้วนะ")]);
  const [members, nameOf] = await Promise.all([
    billMembers(ctx.db, bill.id),
    names(ctx.db, ctx.group.id),
  ]);
  const mine = members.find((m) => m.lineUserId === ctx.userId);
  const who = nameOf(ctx.userId);
  return ctx.reply([
    {
      type: "text",
      text: `🕒 ${who} แจ้งว่าโอนส่วนของ "${bill.title}" ${baht(mine?.shareSatang ?? 0)} แล้ว ${nameOf(bill.payerLineUserId)} ช่วยตรวจว่าเงินเข้าจริงแล้วกดยืนยันด้วยนะ (ปุ่มนี้กดได้เฉพาะคนจ่ายเท่านั้น) หรือส่งรูปสลิปเข้ากลุ่ม บอทจะตรวจยอดให้ก่อน`,
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "postback",
              label: `✅ ได้รับจาก ${who}`.slice(0, 20),
              data: `a=gbp&b=${bill.id}&u=${ctx.userId}`,
              displayText: `ได้รับเงินจาก ${who}`,
            },
          },
        ],
      },
    },
  ]);
}

/** The payer takes a tick back. */
async function unpayFlow(ctx: BillContext, bill: BillRow, targets: string[]): Promise<void> {
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  if (!isPayer(ctx, bill)) return ctx.reply([text(ONLY_PAYER_CONFIRMS_TEXT)]);
  const nameOf = await names(ctx.db, ctx.group.id);
  const lines: string[] = [];
  for (const id of targets) {
    const result = await unpay(ctx.db, bill.id, id);
    lines.push(
      result === "ok"
        ? `↩ ยกเลิกการรับเงินจาก ${nameOf(id)} แล้ว (ยังค้างอยู่)`
        : `${nameOf(id)} ยังไม่ได้ถูกติ๊กว่าจ่าย หรือเป็นคนจ่ายบิลนี้`,
    );
  }
  const fresh = (await getBill(ctx.db, ctx.group.id, bill.id)) ?? bill;
  return ctx.reply([text(lines.join("\n")), await collectingCardFor(ctx, fresh)]);
}

/** "💸 จ่ายส่วนของฉัน": this person's QR with their own amount inside. */
async function qrFlow(ctx: BillContext, bill: BillRow): Promise<void> {
  if (!ctx.userId) return ctx.reply([text(NO_USER_TEXT)]);
  if (bill.status === "joining")
    return ctx.reply([text("ยังไม่ปิดรายชื่อ รอให้คนจ่ายกด “ปิดรายชื่อ” ก่อนนะ")]);
  if (bill.status === "cancelled") return ctx.reply([text("บิลนี้ถูกยกเลิกแล้ว")]);
  const members = await billMembers(ctx.db, bill.id);
  const mine = members.find((m) => m.lineUserId === ctx.userId);
  if (!mine || mine.shareSatang === null) {
    return ctx.reply([text("คุณไม่ได้อยู่ในรายชื่อหารของบิลนี้นะ")]);
  }
  if (mine.paid) return ctx.reply([text("ส่วนของคุณจ่ายเรียบร้อยแล้ว ขอบคุณค่ะ 🙏")]);
  const nameOf = await names(ctx.db, ctx.group.id);
  const payment = await getPaymentByLine(ctx.db, bill.payerLineUserId);
  const qrUrl =
    payment?.promptpayId && ctx.appUrl?.startsWith("https://")
      ? `${ctx.appUrl}/api/split-bill/qr/${mine.qrToken}.png`
      : undefined;
  return ctx.reply([
    buildBillQrCard({
      title: bill.title,
      who: await ctx.knownName(ctx.userId),
      payerName: nameOf(bill.payerLineUserId),
      shareSatang: mine.shareSatang,
      payment,
      qrUrl,
    }),
  ]);
}

/** "ตามเงิน": who still owes. `quiet`: say nothing when nobody does (a question maybe meant for the group). */
async function chaseFlow(ctx: BillContext, quiet = false): Promise<void> {
  const bills = await listBills(ctx.db, ctx.group.id, ["collecting"], 6);
  if (bills.length === 0) return quiet ? undefined : ctx.reply([text(NONE_OWED_TEXT)]);
  const nameOf = await names(ctx.db, ctx.group.id);
  const withMembers = await Promise.all(
    bills.map(async (bill) => ({
      bill,
      members: await billMembers(ctx.db, bill.id),
      payerName: nameOf(bill.payerLineUserId),
    })),
  );
  const owing = withMembers.filter((b) => unpaid(b.members, b.bill.payerLineUserId).length > 0);
  if (owing.length === 0) return quiet ? undefined : ctx.reply([text(NONE_OWED_TEXT)]);
  return ctx.reply([buildChaseCard({ bills: owing, nameOf, appUrl: ctx.appUrl })]);
}

/** "บิลค้าง": the bills someone still owes on, apart from those still being set up. */
async function openListFlow(ctx: BillContext): Promise<void> {
  // apart, so many forgotten bills being set up never push out the ones people owe on
  const [collecting, settingUp] = await Promise.all([
    listBills(ctx.db, ctx.group.id, ["collecting"], 10),
    listBills(ctx.db, ctx.group.id, ["setup", "joining"], 10),
  ]);
  const bills = [...collecting, ...settingUp];
  if (bills.length === 0) return ctx.reply([text("ตอนนี้ไม่มีบิลที่ค้างอยู่ 🎉")]);
  const nameOf = await names(ctx.db, ctx.group.id);
  const owing: string[] = [];
  const unfinished: string[] = [];
  for (const b of bills) {
    const members = await billMembers(ctx.db, b.id);
    const head = `• ${b.title} ฿${formatBaht(b.amountSatang)} · จ่ายโดย ${nameOf(b.payerLineUserId)}`;
    if (b.status === "collecting") {
      const left = unpaid(members, b.payerLineUserId).length;
      if (left > 0) {
        owing.push(
          `${head} · ค้าง ${left} คน ฿${formatBaht(totalOwed(members, b.payerLineUserId))}`,
        );
      }
    } else {
      unfinished.push(
        `${head} · ${b.status === "setup" ? "รอเลือกคนหาร" : `รอปิดรายชื่อ (${members.length} คน)`}`,
      );
    }
  }
  if (owing.length === 0 && unfinished.length === 0) {
    return ctx.reply([text("ตอนนี้ไม่มีบิลที่ค้างอยู่ 🎉")]);
  }
  const lines = [
    ...(owing.length
      ? ["ยังมีคนค้างจ่าย", ...owing, 'พิมพ์ "ตามเงิน" ดูว่าใครยังค้าง']
      : ["ตอนนี้ไม่มีใครค้างจ่าย 🎉"]),
    ...(unfinished.length
      ? [
          "",
          "บิลที่ตั้งไว้ยังไม่เสร็จ (ยังไม่มีใครติดเงิน)",
          ...unfinished,
          'คนจ่ายพิมพ์ "ยกเลิกบิลทั้งหมด" เพื่อยกเลิกบิลที่ตั้งไว้ยังไม่เสร็จของตัวเอง',
        ]
      : []),
  ];
  return ctx.reply([text(lines.join("\n"))]);
}

/** "ยกเลิกบิลทั้งหมด": the bills this person is still setting up; those collecting money stay. */
async function cancelAllFlow(ctx: BillContext, userId: string): Promise<void> {
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  const mine = await listBills(
    ctx.db,
    ctx.group.id,
    ["setup", "joining", "collecting"],
    50,
    userId,
  );
  const cancelled: string[] = [];
  for (const b of mine.filter((x) => x.status !== "collecting")) {
    // one that started collecting since it was read stays
    if (await cancelBill(ctx.db, b.id, ["setup", "joining"])) cancelled.push(b.title);
  }
  const collecting = mine.filter((b) => b.status === "collecting").map((b) => b.title);
  const lines = [
    cancelled.length
      ? `ยกเลิกบิลที่ตั้งไว้ยังไม่เสร็จ ${cancelled.length} บิลแล้ว: ${cancelled.join(", ")}`
      : "ไม่มีบิลที่ตั้งไว้ยังไม่เสร็จของคุณ",
    ...(collecting.length
      ? [
          `บิลที่กำลังเก็บเงิน (${collecting.join(", ")}) ไม่ได้ยกเลิก เพราะมีคนติดเงินอยู่ พิมพ์ "ได้รับแล้ว ชื่อ" เมื่อได้เงิน หรือ "ยกเลิกบิล" ทีละบิล`,
        ]
      : []),
  ];
  return ctx.reply([text(lines.join("\n"))]);
}

/** The page where the payer ticks the people (opens in LINE; needs the LIFF id). */
function pickUrlFor(bill: BillRow): string | undefined {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}/split-bill/${bill.id}` : undefined;
}

/**
 * The people are chosen: fix the shares (equal, to the satang), start collecting and put everybody's QR
 * into the group. Used when names or "ทั้งหมด" were typed and by the "ทั้งหมดเลย" button; the LIFF page
 * does the first half itself and then asks for the second with a short message in the chat.
 */
async function confirmFlow(ctx: BillContext, bill: BillRow, people: string[]): Promise<void> {
  if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
  if (!mayManage(ctx, bill)) return ctx.reply([text(NOT_PAYER_TEXT)]);
  if (bill.status !== "setup" && bill.status !== "joining") {
    return ctx.reply([text("บิลนี้เลือกคนหารไปแล้วนะ")]);
  }
  const ids = [...new Set([bill.payerLineUserId, ...people])];
  if (ids.length < 2) {
    return ctx.reply([
      text(
        "บอทรู้จักสมาชิกในกลุ่มนี้แค่คุณคนเดียวตอนนี้ ให้เพื่อนพิมพ์อะไรสักอย่างในกลุ่มก่อน แล้วลองใหม่ (หรือพิมพ์ชื่อเพื่อนต่อท้าย เช่น หารบิล 1200 แอน บ๊อบ)",
      ),
    ]);
  }
  if (ids.length > MAX_BILL_MEMBERS) return ctx.reply([text("หารได้ไม่เกิน 30 คนต่อบิลนะ")]);
  const shares = billShares(bill.amountSatang, ids, bill.payerLineUserId);
  if (!(await confirmBill(ctx.db, bill.id, shares))) {
    return ctx.reply([text("บิลนี้เลือกคนหารไปแล้วนะ")]);
  }
  const fresh = (await getBill(ctx.db, ctx.group.id, bill.id)) ?? bill;
  return announceFlow(ctx, fresh, {});
}

/** The QR codes (and the card of who owes what) into the group, once. */
async function announceFlow(
  ctx: BillContext,
  bill: BillRow,
  options: { quietIfDone?: boolean },
): Promise<void> {
  if (!mayManage(ctx, bill)) {
    return options.quietIfDone ? undefined : ctx.reply([text(NOT_PAYER_TEXT)]);
  }
  if (bill.status !== "collecting" && bill.status !== "settled") {
    return options.quietIfDone
      ? undefined
      : ctx.reply([text("ยังไม่ได้เลือกคนหาร กด “👥 เลือกคนหาร” ก่อนนะ")]);
  }
  if (!(await markAnnounced(ctx.db, bill.id))) {
    return options.quietIfDone ? undefined : ctx.reply([text("ส่ง QR เข้ากลุ่มไปแล้วนะ")]);
  }
  const [members, nameOf, payment] = await Promise.all([
    billMembers(ctx.db, bill.id),
    names(ctx.db, ctx.group.id),
    getPaymentByLine(ctx.db, bill.payerLineUserId),
  ]);
  const payerName = nameOf(bill.payerLineUserId);
  const card = await collectingCardFor(ctx, bill);
  const owing = unpaid(members, bill.payerLineUserId);
  const header = text(
    `📣 หารบิล "${bill.title}" ${baht(bill.amountSatang)} · หาร ${members.length} คน คนจ่าย ${payerName}\n${owing.length > 0 ? "สแกน QR ของตัวเองด้านล่างจ่ายได้เลย (ยอดอยู่ใน QR แล้ว) โอนเสร็จส่งรูปสลิปเข้ากลุ่ม บอทตรวจให้" : "ทุกคนจ่ายครบแล้ว"}`,
  );
  const hasPayment = Boolean(payment?.promptpayId || payment?.bankAccount);
  if (owing.length === 0) return ctx.reply([header, card]);
  if (!hasPayment) {
    return ctx.reply([
      header,
      text(
        `${payerName} ยังไม่ได้ตั้งพร้อมเพย์หรือบัญชี ให้พิมพ์ “พร้อมเพย์ 0812345678” ในแชทส่วนตัวกับบอท แล้วทุกคนกด “💸 จ่ายส่วนของฉัน” ที่การ์ดด้านล่างเพื่อรับ QR`,
      ),
      card,
    ]);
  }
  const bubbles = owing.map((m) => ({
    who: nameOf(m.lineUserId),
    shareSatang: m.shareSatang ?? 0,
    bubble: billQrBubble({
      title: bill.title,
      who: nameOf(m.lineUserId),
      payerName,
      shareSatang: m.shareSatang ?? 0,
      payment,
      qrUrl:
        payment?.promptpayId && ctx.appUrl?.startsWith("https://")
          ? `${ctx.appUrl}/api/split-bill/qr/${m.qrToken}.png`
          : undefined,
    }),
  }));
  return ctx.reply([
    header,
    ...buildBillQrCarousels(bubbles, bill.title, payerName).slice(0, 3),
    card,
  ]);
}

/** The typed commands about bills. */
export async function runBillCommand(command: BillCommand, ctx: BillContext): Promise<void> {
  const { db, group, userId } = ctx;
  switch (command.kind) {
    case "bill-usage":
      return ctx.reply([text(BILL_USAGE_TEXT)]);

    case "bill-chase":
      return chaseFlow(ctx);

    case "bill-open":
      // "ใครค้างเงินบ้าง" may be a question to the group: answer only when someone owes
      return command.spoken ? chaseFlow(ctx, true) : openListFlow(ctx);

    case "bill-cancel-all":
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      return cancelAllFlow(ctx, userId);

    case "bill-new": {
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
      const known = await memberNames(db, group.id);
      const payerName = await ctx.knownName(userId);
      known.set(userId, { name: payerName, updatedAt: new Date().toISOString() });

      // people typed after the amount are the list; so is "ทั้งหมด" (everyone the bot knows here)
      let named: string[] = [];
      if (command.names.length > 0) {
        const people = [...known].map(([id, v]) => ({ id, name: v.name }));
        const found = resolveNames(command.names, people);
        if (!found.ok) {
          const bad = found.unknown.length > 0 ? found.unknown : found.ambiguous;
          return ctx.reply([
            text(
              found.unknown.length > 0
                ? `ไม่รู้จัก ${bad.join(", ")} ในกลุ่มนี้ ให้เขาพิมพ์อะไรสักอย่างในกลุ่มก่อน (หรือพิมพ์ชื่อให้ตรงกับชื่อใน LINE) เลยยังไม่ได้เปิดบิล`
                : `${bad.join(", ")} ตรงกับหลายคน พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ เลยยังไม่ได้เปิดบิล`,
            ),
          ]);
        }
        named = found.ids;
      }

      const bill = await createBill(db, {
        groupId: group.id,
        payerLineUserId: userId,
        title: command.title,
        amountSatang: command.amountSatang,
        status: "setup",
      });
      if (bill === "too_many") return ctx.reply([text(TOO_MANY_TEXT)]);

      if (command.all || named.length > 0) {
        const ids = command.all ? [...known.keys()] : named;
        return confirmFlow(ctx, bill, ids);
      }
      return ctx.reply([
        buildBillSetupCard({ bill, payerName, pickUrl: pickUrlFor(bill), appUrl: ctx.appUrl }),
      ]);
    }

    case "bill-announce": {
      const bill = await findBillByShortId(db, group.id, command.shortId);
      if (!bill) return;
      return announceFlow(ctx, bill, { quietIfDone: true });
    }

    case "bill-close": {
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      const bill = await latestBillBy(db, group.id, userId, ["joining"]);
      if (!bill) return ctx.reply([text(NO_BILL_TEXT)]);
      return closeFlow(ctx, bill);
    }

    case "bill-cancel": {
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      const bill = await latestBillBy(db, group.id, userId, ["setup", "joining", "collecting"]);
      if (!bill) return ctx.reply([text(NO_BILL_TEXT)]);
      return cancelFlow(ctx, bill);
    }

    case "bill-claim": {
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      const open = await openSharesOf(db, group.id, userId);
      if (open.length === 0) return ctx.reply([text("ตอนนี้คุณไม่มียอดค้างในกลุ่มนี้นะ")]);
      if (open.length > 1) {
        return ctx.reply([
          text("คุณมียอดค้างหลายบิล กดปุ่ม “📨 โอนแล้ว” ที่การ์ดของบิลที่โอนไปนะ"),
        ]);
      }
      return claimFlow(ctx, (open[0] as { bill: BillRow }).bill);
    }

    case "bill-unpaid": {
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      const bill = await latestBillBy(db, group.id, userId, ["collecting", "settled"]);
      if (!bill) return ctx.reply([text("ไม่เจอบิลของคุณที่กำลังเก็บเงินอยู่")]);
      const known = await memberNames(db, group.id);
      const members = await billMembers(db, bill.id);
      const people = members.map((m) => ({
        id: m.lineUserId,
        name: known.get(m.lineUserId)?.name ?? NAME_FALLBACK,
      }));
      const found = resolveNames(command.names, people);
      if (!found.ok) {
        const bad = found.unknown.length > 0 ? found.unknown : found.ambiguous;
        return ctx.reply([
          text(`ไม่เจอ ${bad.join(", ")} ในบิล "${bill.title}" พิมพ์ชื่อให้ตรงกับชื่อใน LINE นะ`),
        ]);
      }
      return unpayFlow(ctx, bill, found.ids);
    }

    case "bill-paid": {
      if (!userId) return ctx.reply([text(NO_USER_TEXT)]);
      const bill = await latestBillBy(db, group.id, userId, ["collecting"]);
      if (!bill) return ctx.reply([text("ไม่เจอบิลของคุณที่กำลังเก็บเงินอยู่")]);
      const known = await memberNames(db, group.id);
      const members = await billMembers(db, bill.id);
      const people = members.map((m) => ({
        id: m.lineUserId,
        name: known.get(m.lineUserId)?.name ?? NAME_FALLBACK,
      }));
      const found = resolveNames(command.names, people);
      if (!found.ok) {
        const bad = found.unknown.length > 0 ? found.unknown : found.ambiguous;
        return ctx.reply([
          text(`ไม่เจอ ${bad.join(", ")} ในบิล "${bill.title}" พิมพ์ชื่อให้ตรงกับชื่อใน LINE นะ`),
        ]);
      }
      return paidFlow(ctx, bill, found.ids);
    }
  }
}

/** The buttons on the bill cards (a=gbj / gbc / gbx / gbq / gbp). */
export async function handleBillPostback(
  action: string,
  params: URLSearchParams,
  ctx: BillContext,
): Promise<void> {
  const bill = await getBill(ctx.db, ctx.group.id, params.get("b") ?? "");
  if (!bill) return ctx.reply([text(BILL_GONE_TEXT)]);

  switch (action) {
    case "gbj": {
      if (!ctx.userId) return ctx.reply([text(NO_USER_TEXT)]);
      if (!ctx.writable) return ctx.reply([text(PAUSED_TEXT)]);
      const who = await ctx.knownName(ctx.userId);
      const result = await joinBill(ctx.db, bill.id, ctx.userId);
      if (result === "closed") {
        return ctx.reply([text("บิลนี้ล็อกรายชื่อแล้ว ถามคนจ่ายถ้าอยากร่วมหารนะ")]);
      }
      if (result === "full") return ctx.reply([text("บิลนี้มีคนร่วมครบ 30 คนแล้ว")]);
      // the payer is on every bill, even before the list is fixed
      const members = await billMembers(ctx.db, bill.id);
      const count =
        members.length + (members.some((m) => m.lineUserId === bill.payerLineUserId) ? 0 : 1);
      return ctx.reply([text(joinedText(who, bill.title, count))]);
    }
    case "gba": {
      // "ทั้งหมดเลย": everyone the bot knows in this group
      const known = await memberNames(ctx.db, ctx.group.id);
      return confirmFlow(ctx, bill, [...known.keys()]);
    }
    case "gbn":
      return announceFlow(ctx, bill, {});
    case "gbc":
      return closeFlow(ctx, bill);
    case "gbx":
      return cancelFlow(ctx, bill);
    case "gbq":
      return qrFlow(ctx, bill);
    case "gbm":
      return claimFlow(ctx, bill);
    case "gbu": {
      const target = params.get("u") ?? "";
      return unpayFlow(ctx, bill, target ? [target] : []);
    }
    case "gbp": {
      const target = params.get("u") ?? "";
      return paidFlow(ctx, bill, target ? [target] : []);
    }
    default:
      return;
  }
}

export const BILL_POSTBACKS = new Set([
  "gbj",
  "gbc",
  "gbx",
  "gbq",
  "gbp",
  "gbm",
  "gbu",
  "gba",
  "gbn",
]);

/** A bill nobody settles stops being reminded about after this many days. */
export const REMINDER_DAYS = 30;

/**
 * The once-a-day reminder, for free: it rides on the first ordinary message anybody writes in the group
 * that day (after 10:00), as a reply (replies cost nothing; a push to a group is billed per member). One
 * card for every bill that still has people who have not paid. Nothing is sent on days nobody writes.
 */
export async function runDailyReminder(ctx: BillContext, now: Date): Promise<void> {
  if (!ctx.writable) return;
  const schedule = await getChaseSchedule(ctx.db, ctx.group.id);
  if (schedule.everyDays === 0 || !inChaseWindow(bangkokParts(now).hour, schedule.window)) return;
  const day = bangkokDateKey(now);
  const bills = await listBills(ctx.db, ctx.group.id, ["collecting"], 10);
  const recent = bills.filter(
    (b) => now.getTime() - new Date(b.createdAt).getTime() < REMINDER_DAYS * 86_400_000,
  );
  if (recent.length === 0) return;
  const nameOf = await names(ctx.db, ctx.group.id);
  const due: {
    bill: BillRow;
    members: Awaited<ReturnType<typeof billMembers>>;
    payerName: string;
  }[] = [];
  for (const bill of recent) {
    const members = await billMembers(ctx.db, bill.id);
    if (unpaid(members, bill.payerLineUserId).length === 0) continue;
    // one reminder per bill per day, even when two messages arrive together
    if (!(await markReminded(ctx.db, bill.id, day, schedule.everyDays))) continue;
    due.push({ bill, members, payerName: nameOf(bill.payerLineUserId) });
  }
  if (due.length === 0) return;
  // counted against the owner's month over all their groups (a count that cannot be read lets it go);
  // 200 is above what 5 groups use in a month, so it only stops runaway posting
  const month = monthKey(now);
  const owner = ctx.group.ownerUserId;
  let counted = false;
  try {
    const cap = GROUP_REMINDS_PER_MONTH[ctx.ownerPlan];
    if (!(await takeUsage(ctx.db, owner, "group_remind", cap, month))) return;
    counted = true;
  } catch (error) {
    log.error("group_remind_quota_failed", error);
  }
  try {
    await ctx.reply([
      text("⏰ เตือนประจำวัน: ยังมีคนที่ยังไม่ได้จ่ายบิลนะ"),
      buildChaseCard({ bills: due, nameOf, appUrl: ctx.appUrl }),
    ]);
  } catch (error) {
    // nothing reached the group, so it does not count
    if (counted) await refundUsage(ctx.db, owner, "group_remind", month).catch(() => undefined);
    throw error;
  }
}
