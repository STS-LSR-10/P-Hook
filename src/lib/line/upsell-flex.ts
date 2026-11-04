import { OWL_LIMIT, PDF_LIMIT, SLIP_LIMIT, VOICE_LIMIT } from "@/lib/plan";
import { LAUNCH_ENDS_TEXT, launchActive, priceFor, TRIAL_DAYS } from "@/lib/pricing";
import type { LineMessage } from "@/lib/types";
import { COLOR } from "./flex";
import { t } from "@/lib/i18n";

/** "a=bdt&t=…" must fit LINE's 300-character postback limit. */
const MAX_POSTBACK = 300;

export interface UpsellCardInput {
  feature: "backdate" | "slip" | "voice" | "pdf" | "owl";
  /** The Pro trial can still be started from the chat. */
  trialAvailable: boolean;
  /** Public /upgrade page; the button is left out when the app URL is unknown. */
  upgradeUrl?: string;
  /** For the backdated entry: its original text, so "record as today instead" can redo it. */
  retryText?: string;
  /** For the launch price check (defaults to now). */
  now?: Date;
}

const SLIP_PRO = SLIP_LIMIT.plus;

const COPY = {
  backdate: {
    title: t("จดย้อนหลังสำหรับสมาชิก Pro"),
    body: t(
      "ระบบตรวจพบการระบุวันที่ย้อนหลัง (เช่น “เมื่อวาน”) ฟังก์ชันนี้สำหรับสมาชิกแพ็กเกจ Pro ขึ้นไป ยังไม่ได้จดรายการนี้นะ",
    ),
  },
  voice: {
    title: t("จดด้วยเสียงสำหรับสมาชิก Pro"),
    body: t(
      "พูดสั้น ๆ เช่น “กาแฟสามสิบบาท” แล้วบอทจดให้ ไม่ต้องพิมพ์ ใช้สิทธิ์ลองจดด้วยเสียงฟรีครบแล้ว",
    ),
  },
  owl: {
    title: t("ถามพี่ฮูกได้มากขึ้น"),
    body: t(
      "ถามพี่ฮูก (AI) เรื่องรายรับรายจ่าย งบ เตือน และโน้ตของคุณได้เลย ใช้สิทธิ์ถามฟรีของเดือนนี้ครบแล้ว",
    ),
  },
  pdf: {
    title: t("จดจากไฟล์ PDF สำหรับสมาชิก Pro"),
    body: t(
      "ส่งไฟล์ PDF บิลหรือรายการเดินบัญชีมา ให้ AI แยกรายรับ/รายจ่ายแล้วจดให้ทีเดียว ไม่ต้องพิมพ์ทีละรายการ ยังไม่ได้จดไฟล์นี้นะ",
    ),
  },
  slip: {
    title: t("ให้บอทอ่านสลิปให้อัตโนมัติ"),
    body: t("อยากให้บอทช่วยอ่านสลิปให้อัตโนมัติโดยไม่ต้องพิมพ์เองไหม? ส่งรูปปุ๊บ บันทึกปั๊บ!"),
  },
} as const;

const button = (label: string, action: Record<string, unknown>, primary: boolean) => ({
  type: "button",
  style: primary ? "primary" : "secondary",
  height: "sm",
  margin: "sm",
  ...(primary ? { color: COLOR.primary } : {}),
  action: { label, ...action },
});

/** The card that offers an upgrade at the moment a Free user reaches for a paid feature. */
export function buildUpsellCard(input: UpsellCardInput): LineMessage {
  const copy = COPY[input.feature];
  const now = input.now ?? new Date();
  const plus = priceFor("plus", now).monthly;
  const ultimate = priceFor("ultimate", now).monthly;
  const launch = launchActive(now) ? t(" (ราคาเปิดตัวถึง {0})", LAUNCH_ENDS_TEXT) : "";
  const price =
    input.feature === "slip"
      ? t(
          "Pro ฿{0}/เดือน อ่านสลิปได้ {1} ใบ/เดือน · Elite ฿{2}/เดือน อ่านสลิปไม่จำกัด{3}",
          plus,
          SLIP_PRO,
          ultimate,
          launch,
        )
      : input.feature === "owl"
        ? t(
            "Pro ฿{0}/เดือน ถามพี่ฮูกได้ {1} ครั้ง/เดือน · Elite ฿{2}/เดือน {3} ครั้ง/เดือน{4}",
            plus,
            OWL_LIMIT.plus,
            ultimate,
            OWL_LIMIT.ultimate,
            launch,
          )
        : input.feature === "pdf"
          ? t(
              "Pro ฿{0}/เดือน อ่าน PDF ได้ {1} ไฟล์/เดือน · Elite ฿{2}/เดือน {3} ไฟล์/เดือน{4}",
              plus,
              PDF_LIMIT.plus,
              ultimate,
              PDF_LIMIT.ultimate,
              launch,
            )
          : input.feature === "voice"
            ? t(
                "Pro ฿{0}/เดือน จดด้วยเสียงได้ {1} ครั้ง/เดือน · Elite ฿{2}/เดือน ไม่จำกัด{3}",
                plus,
                VOICE_LIMIT.plus,
                ultimate,
                launch,
              )
            : `อัปเกรดวันนี้เพียง ฿${plus}/เดือน${launch}${input.trialAvailable ? ` หรือทดลองใช้ฟรี ${TRIAL_DAYS} วัน!` : ""}`;

  const buttons: unknown[] = [];
  if (input.trialAvailable) {
    buttons.push(
      button(
        t("ทดลองใช้ฟรี {0} วัน", TRIAL_DAYS),
        {
          type: "postback",
          data: "a=trial&p=plus",
          displayText: t("ทดลองใช้ Pro ฟรี {0} วัน", TRIAL_DAYS),
        },
        true,
      ),
    );
  }
  if (input.upgradeUrl) {
    buttons.push(
      button("ดูแผนและอัปเกรด", { type: "uri", uri: input.upgradeUrl }, !input.trialAvailable),
    );
  }
  if (input.feature === "backdate" && input.retryText) {
    const data = `a=bdt&t=${encodeURIComponent(input.retryText)}`;
    if (data.length <= MAX_POSTBACK) {
      buttons.push(
        button(
          t("จดเป็นวันนี้แทน"),
          { type: "postback", data, displayText: "จดเป็นวันนี้แทน" },
          false,
        ),
      );
    }
  }

  return {
    type: "flex",
    altText: copy.title,
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
            text: "⭐ " + copy.title,
            weight: "bold",
            size: "md",
            color: "#0B5D4F",
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "md",
        contents: [
          { type: "text", text: copy.body, size: "sm", color: COLOR.text, wrap: true },
          {
            type: "text",
            text: price,
            size: "sm",
            weight: "bold",
            color: COLOR.primary,
            wrap: true,
          },
        ],
      },
      ...(buttons.length > 0
        ? {
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "12px",
              contents: buttons,
            },
          }
        : {}),
    },
  };
}
