import type { Command } from "@/lib/commands";
import { maskPromptPayId } from "@/lib/promptpay";
import type { UserRow } from "@/lib/repo";
import { getPayment, savePayment } from "@/lib/split-bill-repo";
import type { LineMessage } from "@/lib/types";
import type { HandlerDeps } from "./handlers";
import { text } from "./messages";
import { t } from "@/lib/i18n";

export const PAYMENT_USAGE_TEXT = [
  t("ตั้งที่รับเงินตอนหารบิลในกลุ่ม (พิมพ์ในแชทนี้ ไม่ต้องพิมพ์ในกลุ่ม)"),
  t("• พร้อมเพย์ 0812345678 (เบอร์โทร 10 หลัก, เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก)"),
  t("• บัญชี กสิกร 123-4-56789-0 สมชาย ใจดี (ธนาคาร เลขบัญชี ชื่อบัญชี)"),
  t("• พร้อมเพย์ ลบ · บัญชี ลบ"),
].join("\n");

/** The commands that set where you want to be paid (PromptPay and / or a bank account). */
export async function runPaymentCommand(
  command: Extract<Command, { kind: `payment-${string}` }>,
  user: UserRow,
  deps: HandlerDeps,
): Promise<LineMessage[]> {
  const { db } = deps;
  switch (command.kind) {
    case "payment-usage":
      return [text(PAYMENT_USAGE_TEXT)];

    case "payment-show": {
      const p = await getPayment(db, user.id);
      const lines = [
        p?.promptpayId ? t("พร้อมเพย์: {0}", p.promptpayId) : t("พร้อมเพย์: ยังไม่ได้ตั้ง"),
        p?.bankAccount
          ? `บัญชี: ${p.bankName ?? ""} ${p.bankAccount}${p.accountName ? ` (${p.accountName})` : ""}`
          : t("บัญชี: ยังไม่ได้ตั้ง"),
        "",
        PAYMENT_USAGE_TEXT,
      ];
      return [text(lines.join("\n"))];
    }

    case "payment-promptpay":
      await savePayment(db, user.id, { promptpayId: command.id });
      return [
        text(
          t(
            "ตั้งพร้อมเพย์ {0} แล้ว ตอนคุณหารบิลในกลุ่ม เพื่อนจะได้ QR ที่ใส่ยอดของแต่ละคนให้เลย (เพื่อนในกลุ่มจะเห็นเลขแบบปิดบางส่วน)",
            maskPromptPayId(command.id),
          ),
        ),
      ];

    case "payment-bank":
      await savePayment(db, user.id, {
        bankName: command.bank,
        bankAccount: command.account,
        accountName: command.name,
      });
      return [
        text(
          `ตั้งบัญชี ${command.bank} ${command.account}${command.name ? ` (${command.name})` : ""} แล้ว บอทจะแสดงเลขบัญชีให้เพื่อนตอนกด “จ่ายส่วนของฉัน” (ไม่มี QR สำหรับเลขบัญชี ถ้าอยากได้ QR ให้ตั้งพร้อมเพย์ด้วย)`,
        ),
      ];

    case "payment-clear":
      if (command.what === "promptpay") await savePayment(db, user.id, { promptpayId: null });
      else await savePayment(db, user.id, { bankName: null, bankAccount: null, accountName: null });
      return [text(command.what === "promptpay" ? t("ลบพร้อมเพย์แล้ว") : t("ลบบัญชีแล้ว"))];
  }
}
