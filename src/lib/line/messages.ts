import { noteTitle } from "@/lib/note";
import { formatThaiDate } from "@/lib/thai-date";
import { REFERRAL_BONUS_REFEREE, REFERRAL_WINDOW_DAYS } from "@/lib/config";
import type { LineMessage } from "@/lib/types";
import { currencySymbol } from "@/lib/money";
import { t } from "@/lib/i18n";
import {
  AI_CHAT_LIMIT,
  FREE_SLIPS_TOTAL,
  VOICE_LIMIT,
  goalCapacity,
  goalLimit,
  PLAN_LABEL,
  SLIP_LIMIT,
  nextPlanUp,
  type Plan,
} from "@/lib/plan";

export function text(message: string): LineMessage {
  return { type: "text", text: message };
}

export const NOT_UNDERSTOOD_TEXT = t(
  'ยังไม่เข้าใจข้อความนี้ ลองพิมพ์ชื่อรายการแล้วตามด้วยจำนวนเงิน เช่น "กาแฟ 30" หรือพิมพ์ "วิธีใช้งาน" ดูวิธีใช้นะ',
);

export const NOT_A_SLIP_TEXT = t(
  "ดูเหมือนรูปนี้ไม่ใช่สลิปหรือใบเสร็จ ลองส่งรูปสลิปที่เห็นจำนวนเงินชัด ๆ อีกครั้งนะ",
);
export const SLIP_UNREADABLE_TEXT = t(
  'อ่านสลิปนี้ไม่ได้ ลองถ่ายใหม่ให้เห็นตัวเลขชัด ๆ ไม่เบลอ ไม่มีแสงสะท้อน หรือพิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200"',
);
export const IMAGE_ERROR_TEXT = t("โหลดรูปไม่สำเร็จ ลองส่งรูปอีกครั้งนะ");
export const IMAGE_TOO_LARGE_TEXT = t("รูปใหญ่เกินไป (เกิน 10 MB) ลองลดขนาดแล้วส่งใหม่นะ");
export const ALREADY_RECORDED_TEXT = t("สลิปนี้เคยจดไว้แล้วนะ ไม่ได้จดซ้ำ");
export const SLIP_LOCKED_TEXT = t(
  'อ่านสลิปฟรีครบ {0} ใบแล้ว การอ่านสลิปต่อเดือนเป็นของแผน Starter ขึ้นไป (Starter {1} ใบ/เดือน, Pro {2}, Elite {3}) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ตอนนี้พิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200" นะ',
  FREE_SLIPS_TOTAL,
  SLIP_LIMIT.starter,
  SLIP_LIMIT.plus,
  SLIP_LIMIT.ultimate,
);
export const SLIP_FREE_LEFT_TEXT = (left: number) =>
  left > 0
    ? t(
        'อ่านสลิปฟรีได้อีก {0} ใบ (ลองฟรี {1} ใบแรก) อยากอ่านได้ทุกเดือน ลองทดลองใช้แผนฟรี 7 วันที่เมนู "อัปเกรด" นะ',
        left,
        FREE_SLIPS_TOTAL,
      )
    : t(
        'นี่คือสลิปฟรีใบสุดท้ายของ {0} ใบแรกแล้ว อยากอ่านได้ทุกเดือน ลองทดลองใช้แผนฟรี 7 วันที่เมนู "อัปเกรด" นะ',
        FREE_SLIPS_TOTAL,
      );
/** The month's slips are used up. */
export const slipQuotaText = (plan: Plan, limit: number) => {
  const next = nextPlanUp(plan);
  return next
    ? t(
        'เดือนนี้อ่านสลิปครบ {0} ใบแล้ว (แผน {1}) พิมพ์จดเองได้ไม่จำกัด เช่น "ค่าไฟ 1200" อัปเกรดเป็น {2} เพื่ออ่านได้ {3} ใบ/เดือน หรือรอโควตารีเซ็ตต้นเดือนหน้านะ',
        limit,
        PLAN_LABEL[plan],
        PLAN_LABEL[next],
        SLIP_LIMIT[next],
      )
    : t(
        'เดือนนี้อ่านสลิปครบ {0} ใบแล้ว (แผน {1}) พิมพ์จดเองได้ไม่จำกัด เช่น "ค่าไฟ 1200" และอ่านสลิปได้ใหม่ต้นเดือนหน้านะ',
        limit,
        PLAN_LABEL[plan],
      );
};
export const SLIP_CANCELLED_TEXT = t("ยกเลิกแล้ว ไม่ได้จดสลิปนี้");
export const PICK_CATEGORY_TEXT = t("เลือกหมวดที่ถูกต้องนะ");
export const REFERRAL_BONUS_TEXT = t(
  "ได้โบนัสชวนเพื่อน +{0} ฮูกคอยน์แล้ว! ตรวจดูได้ที่หน้าตั้งค่า",
  REFERRAL_BONUS_REFEREE,
);
/** A streak reached a week or a month: how long, and what it paid. */
export const STREAK_BONUS_TEXT = (days: number, bonus: number) =>
  t("🔥 จดต่อเนื่องครบ {0} วันแล้ว! ได้โบนัส +{1} ฮูกคอยน์", days, bonus);
export const FIRST_SLIP_BONUS_TEXT = (bonus: number) =>
  t("🎉 สแกนสลิปครั้งแรกสำเร็จ! ได้โบนัส +{0} ฮูกคอยน์", bonus);
export const USE_CODE_USAGE_TEXT = t(
  'พิมพ์ "ใช้รหัส" ตามด้วยรหัสของเพื่อน เช่น "ใช้รหัส ABCD1234" เพื่อรับโบนัสทั้งสองฝ่ายนะ',
);
export const REFERRAL_OK_TEXT = t(
  "ใช้รหัสแล้ว! พอจดรายการแรกจะได้โบนัส {0} ฮูกคอยน์ และเพื่อนก็ได้ด้วยนะ",
  REFERRAL_BONUS_REFEREE,
);
export const REFERRAL_FAIL_TEXT = {
  invalid: t("ไม่พบรหัสชวนเพื่อนนี้ ตรวจตัวอักษรอีกครั้งนะ"),
  self: t("ใช้รหัสของตัวเองไม่ได้นะ"),
  already: t("คุณใช้รหัสชวนเพื่อนไปแล้ว"),
  expired: t("ใช้รหัสได้ภายใน {0} วันแรกหลังเริ่มใช้งานเท่านั้นนะ", REFERRAL_WINDOW_DAYS),
} as const;

export function referralShareText(code: string): string {
  return [
    t("รหัสชวนเพื่อนของคุณ: {0}", code),
    t('ให้เพื่อนพิมพ์ "ใช้รหัส {0}" ในแชทนี้ พอเพื่อนจดรายการแรก ทั้งคู่ได้โบนัสฮูกคอยน์', code),
  ].join("\n");
}

export const MEMORY_PLUS_HINT_TEXT = t(
  "จดหมวดนี้ให้แล้วนะ การจำผู้รับ → หมวดอัตโนมัติเป็นฟีเจอร์ของแผน Starter ขึ้นไป (แลกวัน Pro ด้วยฮูกคอยน์ได้ที่หน้าตั้งค่า)",
);

export const SLIP_SOON_TEXT = t(
  'ฟีเจอร์อ่านสลิปกำลังจะมาเร็ว ๆ นี้ ตอนนี้พิมพ์จดได้เลย เช่น "ค่าไฟ 1200" นะ',
);

export const TOO_MANY_MESSAGES_TEXT = t(
  "ส่งมาเร็วไปนิดนะ รอสักครู่แล้วค่อยส่งต่อ ข้อความช่วงนี้อาจไม่ได้ถูกจด",
);

export const ERROR_TEXT = t("ขออภัย ระบบสะดุดชั่วคราว ลองส่งใหม่อีกครั้งในอีกสักครู่นะ");

export const NOTHING_TO_DELETE_TEXT = t("ยังไม่มีรายการให้ลบนะ");
export const NOT_FOUND_TEXT = t("ไม่พบรายการนี้แล้ว (อาจถูกลบหรือแก้ไขไปก่อนหน้า)");
export const EDIT_USAGE_TEXT = t(
  'พิมพ์ "แก้ล่าสุด" ตามด้วยจำนวนเงินใหม่ เช่น "แก้ล่าสุด 45" เพื่อแก้รายการล่าสุดนะ',
);
export const EDIT_LINK_TEXT = t("แตะลิงก์นี้เพื่อแก้ไขรายการ (ชื่อ ยอด วันที่ หมวด) ได้เลยนะ");
export const EDIT_HINT_TEXT = t(
  'ถ้าเป็นรายการล่าสุด พิมพ์ "แก้ล่าสุด 45" เพื่อเปลี่ยนจำนวนเงินได้เลย (การแก้รายการอื่นจะทำได้ในหน้ารายการเร็ว ๆ นี้)',
);

export const BACKDATE_LOCKED_TEXT = t(
  'การจดย้อนหลัง (เช่น "เมื่อวาน กาแฟ 60") เป็นฟีเจอร์ของแผน Starter ขึ้นไป ยังไม่ได้จดรายการนี้นะ ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" หรือพิมพ์จดเป็นวันนี้ได้เลย',
);

export const MULTI_ENTRY_LOCKED_TEXT = t(
  'การจดหลายรายการในข้อความเดียว (เช่น "ข้าวเช้า 50 / กาแฟ 45") เป็นฟีเจอร์ของแผน Starter ขึ้นไป ยังไม่ได้จดข้อความนี้นะ ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" หรือส่งทีละรายการได้เลย',
);

export const TAGS_LOCKED_TEXT = t(
  'การติดแท็ก (เช่น "หมูกระทะ 500 #ปาร์ตี้") เป็นฟีเจอร์ของแผน Starter ขึ้นไป ยังไม่ได้จดรายการนี้นะ ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" หรือพิมพ์จดโดยไม่ใส่แท็กได้เลย',
);

// ───── yearly summary and month-by-month comparison ─────
export const YEAR_LOCKED_TEXT = t(
  'การสรุปรายปีเป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์ "สรุปเดือนนี้" ได้เลย',
);
export const YEAR_BAD_TEXT = t(
  "ระบุปีไม่ถูกต้อง ใส่ปี พ.ศ. หรือ ค.ศ. ที่ไม่เกินปีนี้และย้อนหลังไม่เกิน 10 ปี เช่น สรุปปี 2568",
);
export const yearEmptyText = (yearBE: number) => t("สรุปรายปี {0}\nยังไม่มีรายการในปีนี้", yearBE);
export const COMPARE_LOCKED_TEXT = t(
  'การเทียบเดือนต่อเดือนรายหมวดเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const COMPARE_EMPTY_TEXT = t("ยังไม่มีรายจ่ายทั้งสองช่วงให้เทียบ ลองจดรายการเพิ่มก่อนนะ");

// ───── AI insight ─────
export const INSIGHT_LOCKED_TEXT = t(
  'AI Insight (วิเคราะห์การใช้จ่ายด้วย AI) เป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้ดูได้ด้วย "เทียบเดือน" หรือ "สรุปหมวด"',
);
export const INSIGHT_LIMIT_TEXT = t("วันนี้ขอวิเคราะห์ครบจำนวนแล้ว พรุ่งนี้ลองใหม่ได้นะ");
export const INSIGHT_EMPTY_TEXT = t(
  "ยังไม่มีรายจ่ายในรอบนี้ให้วิเคราะห์ ลองจดรายการสักพักแล้วถามใหม่นะ",
);

// ───── forecast ─────
export const FORECAST_LOCKED_TEXT = t(
  'การพยากรณ์เงินปลายเดือนเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้ดูสรุปได้ด้วย "สรุปเดือนนี้" หรือ "เทียบเดือน"',
);
export const FORECAST_EMPTY_TEXT = t(
  "ยังไม่มีข้อมูลในรอบนี้พอให้พยากรณ์ ลองจดรายการสักพักแล้วถามใหม่นะ",
);

// ───── recent entries ─────
export const RECENT_EMPTY_TEXT = t("ยังไม่มีรายการเลย ลองพิมพ์ เช่น กาแฟ 30 ดูนะ");

// ───── search with totals ─────
export const SEARCH_LOCKED_TEXT = t(
  'การค้นหาพร้อมยอดรวมเป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้ค้นหาในหน้ารายการของแอปได้เลย',
);
export const SEARCH_USAGE_TEXT = [
  t("พิมพ์คำที่ต้องการค้นหาต่อท้าย เช่น"),
  t("• ค้นหา กาแฟ"),
  t("• ค้นหา #ปาร์ตี้บริษัท"),
].join("\n");
export const searchEmptyText = (term: string) => t('ค้นหา "{0}"\nไม่พบรายการที่ตรงกันเลย', term);

// ───── custom date range summary ─────
export const SUMMARY_RANGE_LOCKED_TEXT = t(
  'การสรุปช่วงวันเองเป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์ "สรุปเดือนนี้" ได้เลย',
);
export const SUMMARY_RANGE_USAGE_TEXT = [
  t("ระบุช่วงวันที่ให้ครบทั้งวันเริ่มและวันสิ้นสุด เช่น"),
  t("• สรุป 1/10 ถึง 15/10"),
  t("• สรุป 20/10-30/10 หรือ 20oct-30oct"),
  t("• สรุป 1-15 ต.ค. หรือ 20 ต.ค. - 30 ต.ค."),
  t("• สรุป ตั้งแต่ 1/1/2569 ถึง วันนี้"),
  t('หรือกดปุ่ม "📆 ช่วงวันเอง" ใต้การ์ดสรุปแล้วเลือกจากปฏิทิน'),
].join("\n");
export const SUMMARY_RANGE_BAD_DATE_TEXT = t(
  "วันที่ไม่ถูกต้อง ลองใหม่ เช่น สรุป 1/10 ถึง 15/10 นะ",
);
export const SUMMARY_RANGE_ORDER_TEXT = t(
  "วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด ลองสลับวันที่แล้วส่งใหม่นะ",
);
export const SUMMARY_RANGE_TOO_LONG_TEXT = t(
  "เลือกช่วงได้ไม่เกิน 366 วัน ลองย่อช่วงวันที่ลงแล้วส่งใหม่นะ",
);

// ───── backdating with the date picker ─────
export const BACKDATE_PICKER_LOCKED_TEXT = t(
  'การจดย้อนหลังเป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์จดเป็นวันนี้ได้เลย',
);
export const BACKDATE_BAD_DATE_TEXT = t(
  'วันที่ที่เลือกใช้ไม่ได้ (ต้องไม่เกินวันนี้) ลองกด "จดย้อนหลัง" แล้วเลือกใหม่ได้เลยนะ',
);

// ───── AI-assisted reading of long sentences ─────
export const SMART_PREFACE_TEXT = t("ให้ AI ช่วยอ่านข้อความนี้แล้ว ตรวจก่อนจดนะ");
export const SMART_CANCELLED_TEXT = t("ยกเลิกแล้ว ไม่ได้จดรายการนี้ ลองพิมพ์ใหม่ได้เลย");

// ───── receipt split ─────
export const SPLIT_LOCKED_TEXT = t(
  'การแยกรายการจากใบเสร็จเป็นฟีเจอร์เฉพาะแผน Elite กด "ยืนยัน" เพื่อจดเป็นยอดรวมใบเดียวได้เลยนะ',
);
export const SPLIT_UNAVAILABLE_TEXT = t(
  'ใบนี้แยกรายการไม่ได้ (อ่านรายการได้ไม่พอ หรือยอดรายการเกินยอดรวม) กด "ยืนยัน" เพื่อจดเป็นยอดรวมใบเดียวนะ',
);
export const splitDoneText = (lines: { title: string; amountBaht: string }[], totalBaht: string) =>
  [
    t("แยกเป็น {0} รายการแล้ว (รวม {1}{2})", lines.length, currencySymbol(), totalBaht),
    ...lines.slice(0, 12).map((l) => `• ${l.title} ${currencySymbol()}${l.amountBaht}`),
    ...(lines.length > 12 ? [t("และอีก {0} รายการ", lines.length - 12)] : []),
  ].join("\n");

// ───── photos attached to entries ─────
export const PHOTO_LOCKED_TEXT = t(
  'การแนบรูปประกอบรายการเป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
// Short on purpose: the camera / album buttons ride on this one line.
export const PHOTO_ASK_TEXT = t("📎 เลือกรูปที่จะแนบ");
export const PHOTO_ASK_REPLACE_TEXT = t("📎 เลือกรูปใหม่ (แทนรูปเดิม)");
export const PHOTO_LIMIT_TEXT = t(
  "เดือนนี้แนบรูปครบจำนวนแล้ว ไว้เดือนหน้าแนบเพิ่มได้ใหม่นะ ตอนนี้จดรายการได้ตามปกติ",
);
export const PHOTO_ATTACHED_TEXT = (title: string) => t('แนบรูปกับ "{0}" แล้ว', title);
export const PHOTO_EXPIRED_TEXT = t(
  'หมดเวลารอรูปของรายการนี้แล้ว กดปุ่ม "แนบรูป" ที่การ์ดรายการอีกครั้งได้เลยนะ',
);

// ───── voice messages ─────
export const VOICE_LOCKED_TEXT = t(
  'ใช้สิทธิ์ลองจดด้วยเสียงฟรีครบ 10 ครั้งแล้ว จดด้วยเสียงเป็นฟีเจอร์ของแผน Starter ขึ้นไป (Starter 30 ครั้ง/เดือน, Pro 200, Elite 400) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ตอนนี้พิมพ์จดได้เลย เช่น "กาแฟ 30"',
);
export const VOICE_TASTE_TEXT = t(
  'นี่คือสิทธิ์ลองจดด้วยเสียงฟรี (ลองได้ 10 ครั้งแรก) ชอบไหม? ลองทดลองใช้ Pro ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
/** Monthly voice quota reached; Pro is pointed at Elite, Elite is told when it resets. */
export const voiceQuotaText = (plan: Plan, limit: number): string => {
  const next = nextPlanUp(plan);
  return next
    ? t(
        "เดือนนี้จดด้วยเสียงครบ {0} ครั้งแล้ว (แผน {1}) พิมพ์จดแทนได้เลย อัปเกรดเป็น {2} เพื่อจดด้วยเสียงได้ {3} ครั้ง/เดือน หรือรอรีเซ็ตต้นเดือนหน้านะ",
        limit,
        PLAN_LABEL[plan],
        PLAN_LABEL[next],
        VOICE_LIMIT[next],
      )
    : t(
        "เดือนนี้จดด้วยเสียงครบ {0} ครั้งแล้ว พิมพ์จดแทนได้เลย และจะใช้เสียงได้ใหม่ต้นเดือนหน้านะ",
        limit,
      );
};
export const VOICE_UNAVAILABLE_TEXT = t("ตอนนี้ยังไม่เปิดให้จดด้วยเสียง พิมพ์จดแทนได้เลยนะ");
export const VOICE_TOO_LONG_TEXT = t(
  "ข้อความเสียงยาวเกินไป (สูงสุด 30 วินาที) ลองพูดสั้น ๆ ครั้งละไม่กี่รายการนะ",
);
export const VOICE_DAY_LIMIT_TEXT = t(
  "วันนี้จดด้วยเสียงครบจำนวนแล้ว พิมพ์จดแทนได้เลย พรุ่งนี้ใช้ได้ใหม่นะ",
);
export const VOICE_FAILED_TEXT = t("ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง หรือพิมพ์จดแทนได้นะ");
export const VOICE_EMPTY_TEXT = t("ไม่ได้ยินเสียงพูดชัด ๆ ลองพูดใหม่ให้ใกล้ไมค์อีกนิดนะ");
export const VOICE_CANCELLED_TEXT = t("ยกเลิกแล้ว ไม่ได้จดรายการนี้ ลองพูดใหม่ได้เลย");
export const voiceHeardText = (heard: string) => t('ได้ยินว่า: "{0}"', heard);
export const voiceNoAmountText = (heard: string) =>
  t(
    'ได้ยินว่า "{0}" แต่ไม่เจอจำนวนเงิน ลองพูดใหม่ เช่น "กาแฟ สามสิบบาท" หรือพิมพ์จดแทนได้นะ',
    heard,
  );

export const WALLET_NOT_FOUND_TEXT = (hint: string, names: string[]) =>
  t(
    'ไม่พบกระเป๋า "{0}" เลยยังไม่ได้จดรายการนี้\nกระเป๋าที่มี: {1}\nพิมพ์ชื่อใหม่อีกครั้ง หรือไม่ใส่ @ เพื่อจดลงกระเป๋าหลักนะ',
    hint,
    names.join(" · "),
  );
export const WALLET_AMBIGUOUS_TEXT = (hint: string, names: string[]) =>
  t(
    '"{0}" ตรงกับหลายกระเป๋า ({1}) เลยยังไม่ได้จดรายการนี้\nพิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ',
    hint,
    names.join(" · "),
  );
export const WALLET_MOVED_TEXT = (title: string, wallet: string) =>
  t('ย้าย "{0}" ไปที่ {1} แล้ว', title, wallet);
export const WALLET_SLIP_MOVED_TEXT = (wallet: string, count: number) =>
  count > 1 ? `ย้ายทั้ง ${count} รายการไป ${wallet} แล้ว` : `ย้ายไป ${wallet} แล้ว`;
export const WALLET_SLIP_ASK_TEXT = t("ย้ายรายการของสลิปนี้ไปกระเป๋าไหนดี?");
export const WALLET_MOVE_ASK_TEXT = t("ย้ายรายการนี้ไปกระเป๋าไหนดี?");
export const TRANSFER_LOCKED_TEXT = t(
  'การโอนระหว่างกระเป๋าเป็นฟีเจอร์ของแผน Starter ขึ้นไป (มีกระเป๋าได้ถึง 5 ใบ) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const TRANSFER_SAME_TEXT = t("โอนไปกระเป๋าเดียวกันไม่ได้ ลองระบุสองกระเป๋าที่ต่างกันนะ");
export const TRANSFER_USAGE_TEXT = t(
  'โอนระหว่างกระเป๋าพิมพ์ เช่น "โอน 500 เงินสด>KTC" หรือ "โอน 500 จาก เงินสด ไป KTC" การโอนไม่นับเป็นรายรับหรือรายจ่ายนะ',
);
export const TRANSFER_CANCELLED_TEXT = t("ยกเลิกการโอนแล้ว ยอดสองกระเป๋ากลับเป็นเหมือนเดิม");
export const CARD_LOCKED_TEXT = t(
  'วงเงินและยอดตามรอบบิลของบัตรเครดิตเป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const CARD_NONE_TEXT = t(
  'ยังไม่มีกระเป๋าบัตรเครดิต เพิ่มได้ที่หน้ากระเป๋า (เลือกชนิด "บัตรเครดิต" แล้วใส่วงเงินกับวันตัดรอบ) แล้วจดด้วย "กาแฟ 45 @ชื่อบัตร" นะ',
);
export const CARD_NO_DETAIL_TEXT = t(
  "บัตรนี้ยังไม่ได้ตั้งวงเงินหรือวันตัดรอบ ตั้งได้ที่หน้ากระเป๋านะ",
);
export const DEBT_LOCKED_TEXT = t(
  'การจดหนี้สิน (ให้ยืม/ยืม) เป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const DEBT_EMPTY_TEXT = t(
  'ยังไม่มีหนี้ค้าง ลองพิมพ์ "ให้ยืม สมชาย 500" หรือ "ยืม แม่ 2000 คืน 25/10" (ใส่ @กระเป๋า ท้ายข้อความได้ เช่น "ให้ยืม สมชาย 500 @เงินสด") และ "สมชายคืน 200" เมื่อได้เงินคืนนะ',
);
export const DEBT_TOO_MANY_TEXT = t("คนเดียวกันมีหนี้ค้างได้ไม่เกิน 200 ก้อน");
export const DEBT_BAD_DUE_TEXT = t(
  "วันครบกำหนดไม่ถูกต้อง ลองใช้รูปแบบ 25/10 หรือ พรุ่งนี้ หรือ ภายใน 7 วัน นะ",
);
export const DEBT_CANCELLED_TEXT = t("ยกเลิกแล้ว ยอดกระเป๋ากลับเป็นเหมือนเดิม");
export const debtOverpayText = (person: string, leftBaht: string) =>
  t(
    "ชำระเกินยอดที่เหลือไม่ได้ {0} เหลือ {1}{2} ลองพิมพ์ยอดที่ไม่เกินนี้นะ",
    person,
    currencySymbol(),
    leftBaht,
  );
export const FX_LOCKED_TEXT = t(
  'การจดเงินต่างสกุล (เช่น 1500 JPY) แปลงเป็นสกุลเงินของคุณให้อัตโนมัติ เป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์ยอดเป็นสกุลเงินของคุณได้เลย',
);
export const fxUnsupportedText = (code: string) =>
  t("ยังไม่รองรับสกุล {0} (แหล่งอัตราแลกเปลี่ยนไม่มี) ลองพิมพ์ยอดเป็นสกุลเงินของคุณแทนนะ", code);
export const FX_FAILED_TEXT = t(
  "ดึงอัตราแลกเปลี่ยนไม่ได้ในตอนนี้ เลยยังไม่ได้จดรายการนี้ ลองใหม่อีกครั้งในสักครู่ หรือพิมพ์ยอดเป็นสกุลเงินของคุณได้เลยนะ",
);
export const FX_TOO_SMALL_TEXT = t("ยอดนี้แปลงแล้วน้อยกว่า 0.01 ลองตรวจจำนวนเงินอีกครั้งนะ");
export const DAILY_BUDGET_LOCKED_TEXT = t(
  'งบรายวัน (บอทเตือนทันทีเมื่อวันนี้ใช้เกิน) เป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const DAILY_BUDGET_USAGE_TEXT = t(
  'ตั้งงบรายวันพิมพ์ เช่น "งบวัน 500" ดูสถานะด้วย "งบวัน" และปิดด้วย "งบวัน ปิด" นะ',
);
export const DAILY_BUDGET_NONE_TEXT = t(
  'ยังไม่ได้ตั้งงบรายวัน พิมพ์ เช่น "งบวัน 500" เพื่อตั้งวงเงินที่วันหนึ่งไม่ควรใช้เกินนะ',
);
export const DAILY_BUDGET_CLEARED_TEXT = t("ปิดงบรายวันแล้ว");
export const dailyBudgetSetText = (baht: string) =>
  t("ตั้งงบรายวัน {0}{1} แล้ว ถ้าวันไหนใช้เกิน บอทจะเตือนทันทีนะ", currencySymbol(), baht);
export const GOAL_LOCKED_TEXT = t(
  'เป้าหมายการออม (กระปุก) เป็นฟีเจอร์ของแผน Starter ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const GOAL_EMPTY_TEXT = t(
  'ยังไม่มีเป้าหมายการออม ลองพิมพ์ "เป้าหมาย ใหม่ เที่ยวญี่ปุ่น 30000" (ใส่วันที่ได้ เช่น "ภายใน 31/3") แล้วหยอดกระปุกด้วย "ออม เที่ยวญี่ปุ่น 2000" นะ',
);
export const goalFullText = (plan: Plan) => {
  const limit = goalCapacity(plan);
  const next = nextPlanUp(plan);
  return t(
    "มีเป้าหมายได้ {0} ใบแล้ว ลบอันที่ไม่ใช้ในหน้าเป้าหมาย{1}นะ",
    limit,
    next && goalLimit(next) !== null
      ? t(" หรืออัปเกรดเป็น {0} เพื่อมีได้ {1} ใบ", PLAN_LABEL[next], goalLimit(next) ?? 0)
      : next
        ? t(" หรืออัปเกรดเป็น {0} เพื่อมีได้ไม่จำกัด", PLAN_LABEL[next])
        : "",
  );
};
export const GOAL_EXISTS_TEXT = t(
  "มีเป้าหมายชื่อนี้อยู่แล้ว ใช้ชื่ออื่นหรือหยอดกระปุกเดิมได้เลยนะ",
);
export const GOAL_BAD_DUE_TEXT = t("วันที่ไม่ถูกต้อง ลองใช้รูปแบบ 31/3 หรือ ภายใน 90 วัน นะ");
export const goalAmbiguousText = (name: string, names: string[]) =>
  t('"{0}" ตรงกับหลายเป้าหมาย ({1}) พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ', name, names.join(" · "));
export const goalOverdrawText = (name: string, savedBaht: string) =>
  t(
    "ถอนเกินยอดที่ออมไว้ไม่ได้ {0} มี {1}{2} ลองพิมพ์ยอดที่ไม่เกินนี้นะ",
    name,
    currencySymbol(),
    savedBaht,
  );
export const GOAL_UNDONE_TEXT = t("ยกเลิกรายการหยอดกระปุกแล้ว");
export const GOAL_UNDO_BLOCKED_TEXT = t("ยกเลิกรายการนี้ไม่ได้ เพราะมีการถอนที่ตามมา");
export const BILL_LOCKED_TEXT = t(
  'การเตือนวันครบกำหนดจ่ายบิลเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ',
);
export const BILL_EMPTY_TEXT = t(
  'ยังไม่มีบิลที่ตั้งเตือนไว้ ลองพิมพ์ "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15 เตือนก่อน 2 วัน" (ระบุเวลาได้ เช่น "เวลา 20:00") นะ',
);
export const BILL_USAGE_TEXT = t(
  'ตั้งบิลพิมพ์ เช่น "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15" · "บิล ใหม่ ประกันรถ 12000 ทุกปี 1/3" · "บิล ใหม่ ค่าส่วนกลาง 800 วันที่ 25/12" ต่อท้ายด้วย "เตือนก่อน 2 วัน" (หรือ "เตือนก่อน 3,1 วัน") และ "เวลา 20:00" ได้ ไม่ใส่ = เตือนก่อน 1 วัน เวลา 09:00',
);
export const billFullText = (limit: number) =>
  t("มีบิลได้ {0} รายการแล้ว ลบอันที่ไม่ใช้ในหน้าบิลก่อนนะ", limit);
export const BILL_EXISTS_TEXT = t("มีบิลชื่อนี้อยู่แล้ว ใช้ชื่ออื่น หรือแก้ของเดิมในหน้าบิลนะ");
export const billAmbiguousText = (name: string, names: string[]) =>
  t('"{0}" ตรงกับหลายบิล ({1}) พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ', name, names.join(" · "));
export const BILL_GONE_TEXT = t(
  'บิลนี้ถูกจัดการไปแล้ว (หรือไม่พบแล้ว) ดูรายการล่าสุดด้วยคำสั่ง "บิล" นะ',
);
export const BILL_SNOOZED_TEXT = t("ได้เลย พรุ่งนี้จะเตือนอีกครั้ง");
export const BILL_RECORDED_ALREADY_TEXT = t("จดรายจ่ายของบิลรอบนี้ไปแล้วนะ");
export const GROUP_LOCKED_TEXT = t(
  'สมุดกลุ่มเป็นฟีเจอร์ของแผน Starter ขึ้นไป เฉพาะคนที่เปิดสมุดต้องเป็น Starter ขึ้นไป เพื่อน ๆ ในกลุ่มใช้ได้ฟรี ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ของบอทในแชทส่วนตัวนะ',
);
export const GROUP_OPENED_TEXT = t(
  'เปิดสมุดกลุ่มแล้ว 🎉 ใครในกลุ่มก็จดได้ เช่น "จด ข้าวเที่ยง 350" แล้วพิมพ์ "สรุป" ดูว่าใครจ่ายไปเท่าไร (พิมพ์ "วิธีใช้งาน" ดูวิธีใช้ทั้งหมด)',
);
export const GROUP_ALREADY_OPEN_TEXT = t("สมุดกลุ่มนี้เปิดอยู่แล้วนะ");
export const GROUP_OTHER_OWNER_TEXT = t(
  'สมุดกลุ่มนี้มีเจ้าของสมุดอยู่แล้ว ถ้าอยากเปลี่ยน ให้เจ้าของเดิมพิมพ์ "ปิดสมุดกลุ่ม" ก่อนแล้วเปิดใหม่นะ',
);
export const groupTooManyText = (limit: number, plan: Plan) =>
  t(
    "คุณเป็นเจ้าของสมุดกลุ่มครบ {0} กลุ่มแล้ว (แผน {1}) ปิดกลุ่มที่ไม่ใช้ หรืออัปเกรดแผนก่อนนะ",
    limit,
    PLAN_LABEL[plan],
  );
/** A ledger already has as many people using it as the owner's plan allows. */
export const groupFullText = (limit: number) =>
  t(
    "สมุดกลุ่มนี้มีคนใช้ครบ {0} คนแล้วตามแผนของเจ้าของสมุด เจ้าของอัปเกรดแผนเพื่อเพิ่มคนได้นะ",
    limit,
  );
export const GROUP_NOT_OPEN_TEXT = t(
  'กลุ่มนี้ยังไม่ได้เปิดสมุด สมาชิกที่เป็นแผน Starter ขึ้นไปพิมพ์ "เปิดสมุดกลุ่ม" ได้เลย',
);
export const GROUP_PAUSED_TEXT = t(
  "สมุดกลุ่มนี้หยุดจดชั่วคราว เพราะแผนของเจ้าของสมุดหมดอายุ ดูสรุปได้ตามปกติ ต่ออายุแผนแล้วจดต่อได้เลยนะ",
);
export const GROUP_CLOSED_TEXT = t(
  'ปิดสมุดกลุ่มแล้ว ข้อมูลยังเก็บไว้ เปิดใหม่ได้ด้วย "เปิดสมุดกลุ่ม"',
);
export const GROUP_OWNER_ONLY_TEXT = t("เฉพาะเจ้าของสมุดเท่านั้นที่ทำอย่างนี้ได้นะ");
export const GROUP_NO_USER_TEXT = t(
  "บอทยังไม่รู้ว่าใครพิมพ์ ให้เพิ่มบอทเป็นเพื่อน (และยอมรับข้อกำหนดของ LINE OA) ก่อน แล้วลองพิมพ์ใหม่นะ",
);
export const GROUP_RECORD_USAGE_TEXT = t(
  'พิมพ์ชื่อรายการแล้วตามด้วยจำนวนเงิน เช่น "จด ข้าวเที่ยง 350" นะ',
);
export const GROUP_EXPENSE_ONLY_TEXT = t(
  "สมุดกลุ่มจดรายจ่ายเท่านั้นนะ ลองพิมพ์ยอดโดยไม่ใส่ + นำหน้า",
);
export const GROUP_TOO_MANY_ENTRIES_TEXT = t("จดได้ครั้งละไม่เกิน 5 รายการนะ");
export const GROUP_DAY_FULL_TEXT = t("วันนี้กลุ่มนี้จดครบ 300 รายการแล้ว พรุ่งนี้มาจดต่อนะ");
export const GROUP_RECENT_EMPTY_TEXT = t("ยังไม่มีรายการในสมุดกลุ่ม");
export const GROUP_NOTHING_TO_DELETE_TEXT = t("ไม่มีรายการของคุณให้ลบ");
export const GROUP_DELETED_TEXT = t("ลบแล้ว");
export const GROUP_CANNOT_DELETE_TEXT = t(
  "ลบได้เฉพาะรายการของตัวเอง (หรือเจ้าของสมุดลบได้ทุกรายการ)",
);
export const GROUP_ENTRY_GONE_TEXT = t("ไม่พบรายการนี้แล้ว");
export const GROUP_TRIP_EXISTS_TEXT = t(
  'มีทริปที่เปิดอยู่แล้ว พิมพ์ "จบทริป" ก่อนแล้วค่อยเริ่มทริปใหม่นะ',
);
export const GROUP_NO_TRIP_TEXT = t(
  'ยังไม่มีทริปที่เปิดอยู่ พิมพ์ "เริ่มทริป ชื่อทริป" เพื่อเริ่มหารค่าใช้จ่ายนะ',
);
export const GROUP_TRIP_NO_EXIST_TEXT = t(
  'ยังไม่เคยมีทริปในกลุ่มนี้ พิมพ์ "เริ่มทริป ชื่อทริป" ได้เลย',
);
export const GROUP_TRIP_CLOSE_DENIED_TEXT = t("จบทริปได้เฉพาะคนที่เริ่มทริปหรือเจ้าของสมุดนะ");
export const GROUP_SPLIT_NEEDS_TRIP_TEXT = t(
  'ใช้ "หาร" / "ไม่หาร" ได้เฉพาะตอนมีทริปที่เปิดอยู่ พิมพ์ "เริ่มทริป ชื่อทริป" ก่อนนะ',
);
export const groupTripStartedText = (name: string) =>
  t(
    'เริ่มทริป "{0}" แล้ว 🧳 ต่อไปทุกรายการที่ "จด" จะหารเท่ากันทุกคนที่ร่วมทริป\nกดปุ่มด้านล่างเพื่อร่วมทริป (หรือพิมพ์ "ร่วมทริป") ถ้าจะหารไม่เท่ากันพิมพ์เช่น "จด ไวน์ 900 หาร แอน บ๊อบ" หรือ "จด ค่าห้อง 3000 ไม่หาร บ๊อบ" จบแล้วพิมพ์ "สรุปทริป"',
    name,
  );
export const groupTripJoinedText = (who: string, trip: string, count: number) =>
  t('{0} ร่วมทริป "{1}" แล้ว (ตอนนี้ {2} คน)', who, trip, count);
export const groupSplitUnknownText = (names: string[]) =>
  t(
    'ไม่รู้จัก {0} ในทริปนี้ ให้เขาพิมพ์ "ร่วมทริป" ก่อน (หรือพิมพ์ชื่อให้ตรงกับชื่อใน LINE) เลยยังไม่ได้จดรายการนี้นะ',
    names.join(", "),
  );
export const groupSplitAmbiguousText = (names: string[]) =>
  t("{0} ตรงกับหลายคน พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ เลยยังไม่ได้จดรายการนี้", names.join(", "));
export const GROUP_TRIP_OLD_EMPTY_TEXT = t("ยังไม่มีทริปที่จบแล้ว");
export const SHARED_WALLET_ONLY_ENTRIES_TEXT = t(
  "กระเป๋าร่วมใช้ได้เฉพาะรายรับ/รายจ่ายตอนนี้ โอน หนี้ และบัตรเครดิตยังใช้ได้กับกระเป๋าส่วนตัวเท่านั้นนะ",
);
export const SHARED_WALLET_LOCKED_TEXT = t(
  'กระเป๋าร่วมกับคนอื่นเป็นฟีเจอร์ของแผน Starter ขึ้นไป (Starter 2 คน, Pro 5 คน, Elite สูงสุด 10 คน) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ส่วนการถูกชวนเข้ากระเป๋าร่วม ใช้แผนไหนก็ร่วมได้ฟรี',
);
export const sharedInviteText = (wallet: string, code: string) =>
  t(
    'ชวนเข้ากระเป๋า "{0}" 💑\nรหัส: {1}\nให้เขาพิมพ์ในแชทกับบอทว่า\nร่วมกระเป๋า {2}\n(ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง)',
    wallet,
    code,
    code,
  );
export const sharedJoinedText = (wallet: string) =>
  t(
    'ร่วมกระเป๋า "{0}" แล้ว 🎉 จดลงกระเป๋านี้ได้ด้วย @{1} เช่น "ข้าวเย็น 300 @{2}" ส่วนกระเป๋าและรายการส่วนตัวของคุณยังเป็นส่วนตัวเหมือนเดิม คนที่ร่วมเห็นเฉพาะรายการที่ลงกระเป๋านี้',
    wallet,
    wallet,
    wallet,
  );
export const sharedLeftText = (wallet: string) =>
  t('ออกจากกระเป๋า "{0}" แล้ว รายการที่เคยจดไว้ยังอยู่ในกระเป๋านั้น', wallet);
export const SHARED_INVITE_OWNER_ONLY_TEXT = t("เฉพาะเจ้าของกระเป๋าที่ชวนคนอื่นได้นะ");
export const SHARED_OWNER_CANNOT_LEAVE_TEXT = t(
  "เจ้าของออกจากกระเป๋าร่วมไม่ได้ ถ้าไม่ใช้แล้วให้ลบกระเป๋าที่หน้ากระเป๋าเงินนะ",
);
export const SHARED_JOIN_USAGE_TEXT = t(
  'พิมพ์ "ร่วมกระเป๋า" ตามด้วยรหัส 6 หลัก เช่น "ร่วมกระเป๋า 482913" นะ',
);

// ── PDF (statements, bills, lists) ──
export const PDF_UNAVAILABLE_TEXT = t("ตอนนี้ยังไม่เปิดให้จดจากไฟล์ PDF ลองพิมพ์จดเองไปก่อนนะ");
export const PDF_ONLY_TEXT = t(
  "รับเฉพาะไฟล์ PDF นะ (บิล ใบเสร็จ หรือรายการเดินบัญชี) ไฟล์อื่นยังอ่านไม่ได้",
);
export const PDF_LOCKED_TEXT = t(
  'จดจากไฟล์ PDF เป็นฟีเจอร์ของแผน Pro ขึ้นไป (Pro 10 ไฟล์/เดือน, Elite 30 ไฟล์/เดือน) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ตอนนี้พิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200" นะ',
);
export const PDF_TOO_LARGE_TEXT = t(
  "ไฟล์ใหญ่เกิน 5 MB ลองแยกเป็นไฟล์เล็กลง (เช่น ทีละเดือน) แล้วส่งใหม่นะ",
);
export const PDF_TOO_MANY_PAGES_TEXT = t(
  "ไฟล์ยาวเกิน 10 หน้า ลองแยกเป็นไฟล์สั้นลง (เช่น ทีละเดือน) แล้วส่งใหม่นะ",
);
export const PDF_PASSWORD_TEXT = t(
  "ไฟล์นี้ตั้งรหัสผ่านไว้ บอทเปิดอ่านไม่ได้ ปลดรหัสผ่านก่อน (หรือบันทึกเป็น PDF ใหม่แบบไม่มีรหัส) แล้วส่งมาอีกครั้งนะ",
);
export const PDF_NOT_PDF_TEXT = t("ไฟล์นี้เปิดไม่ได้หรือไม่ใช่ PDF ลองส่งใหม่อีกครั้งนะ");
export const PDF_FAILED_TEXT = t(
  "อ่านไฟล์ PDF ไม่สำเร็จ ลองส่งอีกครั้ง หรือพิมพ์จดเองได้เลยนะ (ไฟล์นี้ยังไม่ถูกนับโควตา)",
);
export const PDF_NO_ENTRIES_TEXT = t(
  "ไม่เจอรายการรายรับ/รายจ่ายในไฟล์นี้ ถ้าเป็นไฟล์สแกนที่ภาพไม่ชัด ลองส่งใหม่ให้ชัดขึ้น หรือพิมพ์จดเองได้เลยนะ (ไฟล์นี้ยังไม่ถูกนับโควตา)",
);
export const PDF_ALL_DUPLICATE_TEXT = t(
  "ทุกรายการในไฟล์นี้มีอยู่ในสมุดของคุณแล้ว (วันที่ ยอด และประเภทตรงกัน) เลยไม่ได้จดซ้ำ ไม่นับโควตา",
);
export const PDF_ALREADY_TEXT = t("ไฟล์นี้เคยส่งมาจดแล้วนะ ไม่ได้จดซ้ำ");
export const PDF_DAY_LIMIT_TEXT = t("วันนี้อ่านไฟล์ PDF เยอะแล้ว พรุ่งนี้ค่อยส่งใหม่ได้นะ");
export const pdfQuotaText = (plan: "plus" | "ultimate", limit: number) =>
  plan === "plus"
    ? t(
        "เดือนนี้อ่านไฟล์ PDF ครบ {0} ไฟล์แล้ว (แผน Pro) พิมพ์จดเองได้ไม่จำกัด หรืออัปเกรดเป็น Elite เพื่อให้อ่านได้ 30 ไฟล์/เดือน หรือรอโควตารีเซ็ตต้นเดือนหน้านะ",
        limit,
      )
    : t(
        "เดือนนี้อ่านไฟล์ PDF ครบ {0} ไฟล์แล้ว พิมพ์จดเองได้เลย และจะอ่านไฟล์ได้ใหม่ต้นเดือนหน้านะ",
        limit,
      );
export const PDF_CANCELLED_TEXT = t("ยกเลิกแล้ว ไม่ได้จดรายการจากไฟล์นี้ ส่งไฟล์ใหม่ได้เลย");
export const PDF_ALREADY_DONE_TEXT = t("ชุดรายการนี้จัดการไปแล้ว หรือหมดอายุแล้วนะ");
export const pdfRecordedText = (count: number) =>
  t('จดแล้ว {0} รายการ ดูได้ที่เมนู "รายการ" และแก้ไขภายหลังได้', count);

// ── plain messages sorted by the AI ──
export const SECRET_ASK_TEXT = t(
  "ข้อความนี้ดูเหมือนรหัสหรือเลขสำคัญ พี่ฮูกเลยไม่ส่งให้ AI อ่าน จะบันทึกเป็นโน้ตไหม?\n⚠️ โน้ตเก็บเป็นข้อความธรรมดา ไม่ควรเก็บรหัสผ่านสำคัญ",
);
export const INTENT_CONFIRM_TEXT = (label: string) => t("พี่ฮูกเข้าใจว่าให้{0} ใช่ไหม?", label);
export const INTENT_UNCLEAR_TEXT = t("พี่ฮูกไม่แน่ใจ อยากให้ทำอะไรกับข้อความนี้?");
export const INTENT_CANCELLED_TEXT = t("ยกเลิกแล้ว ไม่ได้บันทึกอะไร");
export const INTENT_EXPIRED_TEXT = t("รายการนี้หมดเวลาหรือทำไปแล้ว ลองพิมพ์ใหม่อีกครั้งนะ");
export const ROUTER_REMINDER_HINT_TEXT = t(
  'ถ้าจะตั้งเตือน พิมพ์ขึ้นต้นด้วย "เตือน" เช่น "เตือน กินยา 6 โมงเย็น"\nถ้าจะจดเงิน พิมพ์ชื่อกับจำนวน เช่น "กาแฟ 50"',
);
export const QUESTION_NOT_RECORDED_TEXT = t(
  'ข้อความนี้ดูเหมือนคำถาม ตอนนี้ AI ช่วยตอบไม่ได้ เลยยังไม่ได้จดอะไร ถ้าต้องการจดเป็นรายการ พิมพ์ชื่อกับจำนวน เช่น "กาแฟ 50"',
);
export const MONEY_HINT_TEXT = t('ลองพิมพ์ชื่อรายการกับจำนวนเงิน เช่น "ค่าหมอ 800" นะ');

/** "• 27 ธ.ค. 2569  ซื้อนม…" lines for a short list of notes, then where to see the rest. */
export function noteListText(
  title: string,
  items: { body: string; createdAt: string }[],
  url: string | undefined,
  more = false,
): string {
  const lines = items.map(
    (n) => `• ${formatThaiDate(new Date(n.createdAt))}  ${noteTitle(n.body, 50)}`,
  );
  const tail = url ? [`${more ? "ดูทั้งหมด" : "ดู แก้ไข หรือค้นหา"}: ${url}`] : [];
  return [`${title} 📝`, ...lines, ...tail].join("\n");
}

// ── files, reminders and พี่ฮูก in a group (they take the owner's space and limits) ──
export const GROUP_FILE_SEND_NOW_TEXT = t(
  "ส่งไฟล์หรือรูปมาในกลุ่มได้เลย พี่ฮูกรอ 5 นาที แล้วจะเก็บไว้ในคลังไฟล์ของกลุ่มนะ",
);
export const GROUP_FILE_EMPTY_TEXT = t(
  'กลุ่มนี้ยังไม่มีไฟล์ที่เก็บไว้ พิมพ์ "เก็บไฟล์" แล้วส่งไฟล์หรือรูปมาได้เลย',
);
export const groupFileNotFoundText = (term: string) => t('ไม่พบไฟล์ของกลุ่มที่มีคำว่า "{0}"', term);
export const groupFileFullText = (capacity: string) =>
  t("พื้นที่เก็บไฟล์ของเจ้าของสมุดเต็มแล้ว ({0} ใช้ร่วมกับไฟล์ส่วนตัว) ลบไฟล์เก่าก่อนนะ", capacity);
export const groupFileListText = (url?: string) =>
  `ไฟล์ล่าสุดของกลุ่ม${url ? `\nดูไฟล์ทั้งหมด: ${url}` : ""}`;
export const GROUP_REMIND_EMPTY_TEXT = t(
  'กลุ่มนี้ยังไม่มีเตือนที่รออยู่ ตั้งได้ เช่น "เตือน พรุ่งนี้ 9 โมง ประชุม"',
);
export const GROUP_REMIND_GONE_TEXT = t(
  'ไม่พบเตือนนี้แล้ว พิมพ์ "เตือนกลุ่ม" เพื่อดูรายการอีกครั้งนะ',
);
export const GROUP_REMIND_DENIED_TEXT = t("ยกเลิกได้เฉพาะคนที่ตั้งเตือนนี้ หรือเจ้าของสมุดนะ");
export const groupRemindCancelledText = (body: string) => t("ยกเลิกเตือนกลุ่มแล้ว: {0}", body);
export const groupReminderFullText = (limit: number, repeat: boolean) =>
  t(
    "{0}ของเจ้าของสมุดครบ {1} รายการแล้ว (ใช้ร่วมกับเตือนส่วนตัว) ยกเลิกอันที่ไม่ใช้ก่อนนะ",
    repeat ? t("เตือนประจำ") : t("เตือนครั้งเดียว"),
    limit,
  );
export const groupNoteSavedText = (preview: string, url?: string) =>
  `จดโน้ตกลุ่มแล้ว 📝\n"${preview}"${url ? `\nดู แก้ไข หรือค้นหาโน้ตของกลุ่ม: ${url}` : ""}`;
export const GROUP_NOTE_SECRET_TEXT = t(
  "⚠️ ทุกคนในกลุ่มเห็นโน้ตนี้ ไม่ควรจดรหัสผ่านสำคัญหรือเลขบัตรไว้ในกลุ่ม",
);
export const groupNoteFullText = (limit: number) =>
  t(
    "โน้ตของเจ้าของสมุดเต็ม {0} รายการแล้ว (ใช้ร่วมกับโน้ตส่วนตัว) ลบอันเก่าก่อนนะ",
    limit.toLocaleString("en-US"),
  );
export const GROUP_NOTE_EMPTY_TEXT = t(
  'กลุ่มนี้ยังไม่มีโน้ต พิมพ์ เช่น "โน้ต ซื้อน้ำแข็ง 2 ถุง" ได้เลย',
);
export const groupNoteNotFoundText = (term: string) =>
  t('ไม่เจอโน้ตของกลุ่มที่มีคำว่า "{0}"', term);
export const GROUP_NOTE_DENIED_TEXT = t("ลบได้เฉพาะคนที่จดโน้ตนี้ หรือเจ้าของสมุดนะ");
export const GROUP_NOTE_GONE_TEXT = t("ไม่พบโน้ตนี้แล้ว อาจถูกลบไปก่อนหน้า");
export const GROUP_OWL_USAGE_TEXT = t(
  '🦉 ถามพี่ฮูกในกลุ่ม พิมพ์ "ฮูก" ตามด้วยคำถาม เช่น "ฮูก เดือนนี้กลุ่มใช้ไปเท่าไร"\nพี่ฮูกเห็นแค่สมุดของกลุ่มนี้ ไม่เห็นข้อมูลส่วนตัวของใคร',
);
export const groupOwlQuotaText = (limit: number) =>
  t("สิทธิ์ถามพี่ฮูกของเจ้าของสมุดเดือนนี้ครบ {0} ครั้งแล้ว เดือนหน้าถามใหม่ได้นะ", limit);

// ── kept files ──
export const FILE_ASK_KEEP_TEXT = t("จะให้พี่ฮูกเก็บไฟล์นี้ไว้ไหม?");
export const FILE_ASK_PDF_TEXT = t("ไฟล์ PDF นี้ จะให้พี่ฮูกทำอะไร?");
export const FILE_BLOCKED_TEXT = t("พี่ฮูกไม่รับไฟล์ติดตั้งโปรแกรม เช่น .exe หรือ .apk นะ");
export const FILE_TOO_LARGE_TEXT = t("ไฟล์ใหญ่เกิน 20 MB ลองย่อขนาดแล้วส่งใหม่นะ");
export const fileFullText = (capacity: string) =>
  t("พื้นที่เก็บไฟล์เต็มแล้ว ({0}) ลบไฟล์เก่าในคลัง หรืออัปเกรดแผนเพื่อเพิ่มพื้นที่นะ", capacity);
export const FILE_GONE_TEXT = t(
  "ไฟล์นี้หมดอายุจาก LINE แล้ว ส่งไฟล์มาอีกครั้งได้เลย พี่ฮูกรออยู่ 5 นาที",
);
export const FILE_FAILED_TEXT = t("เก็บไฟล์ไม่สำเร็จ ลองส่งอีกครั้งนะ");
export const FILE_UNAVAILABLE_TEXT = t("ตอนนี้ระบบเก็บไฟล์ยังไม่พร้อม ลองใหม่อีกครั้งนะ");
export const FILE_EXPIRED_TEXT = t("ไฟล์นี้หมดเวลาหรือจัดการไปแล้ว ส่งใหม่ได้เลยนะ");
export const FILE_SEND_NOW_TEXT = t("ส่งไฟล์มาได้เลย พี่ฮูกรออยู่ 5 นาที");
export const FILE_NOT_FOUND_TEXT = t("ยังไม่มีไฟล์ที่เก็บไว้");
export const FILE_VIDEO_ELSEWHERE_TEXT = t("วิดีโอนี้อยู่นอก LINE พี่ฮูกเก็บให้ไม่ได้นะ");
export const FILE_NAME_ASK_TEXT = t(
  'อยากตั้งชื่อใหม่ให้หาง่ายไหม? กดปุ่มตั้งชื่อใหม่ หรือพิมพ์ เช่น "ชื่อไฟล์ รูปบัตร"',
);
export const FILE_NAME_MANY_TEXT = t("ตั้งชื่อแต่ละไฟล์ให้หาง่ายได้ที่คลัง");
export const fileNotFoundText = (term: string) => t('ไม่พบไฟล์หรือโน้ตที่มีคำว่า "{0}"', term);
export const fileSpaceText = (used: string, capacity: string, url?: string) =>
  `ใช้ไป ${used} จาก ${capacity}${url ? `\nดูไฟล์ทั้งหมด: ${url}` : ""}`;
export const fileRenamedText = (name: string) => t('เปลี่ยนชื่อเป็น "{0}" แล้ว', name);

// ── notes ──
export const NOTE_SAVED_TEXT = (preview: string, url?: string) =>
  `จดโน้ตแล้ว 📝\n"${preview}"${url ? `\nดู แก้ไข หรือค้นหาทั้งหมด: ${url}` : ""}`;
export const NOTE_SECRET_WARNING_TEXT = t(
  "⚠️ โน้ตเก็บเป็นข้อความธรรมดา ไม่ควรเก็บรหัสผ่านสำคัญหรือเลขบัตรไว้ที่นี่",
);
export const NOTE_UNDONE_TEXT = t("ยกเลิกโน้ตแล้ว");
export const NOTE_TOO_LONG_TEXT = (max: number) =>
  t("โน้ตยาวเกิน {0} ตัวอักษร ลองแบ่งเป็นหลายโน้ตนะ", max.toLocaleString("en-US"));
export const NOTE_FULL_TEXT = (limit: number) =>
  t(
    "โน้ตเต็ม {0} รายการแล้ว ลบอันเก่าในคลัง หรืออัปเกรดแผนเพื่อเก็บเพิ่มนะ",
    limit.toLocaleString("en-US"),
  );
export const NOTE_EMPTY_TEXT = t('ยังไม่มีโน้ต พิมพ์ เช่น "โน้ต ซื้อนม รหัสไวไฟ 1234" ได้เลย');
export const NOTE_SEARCH_USAGE_TEXT = t('พิมพ์คำที่ต้องการหาต่อท้าย เช่น "ค้นหาโน้ต ไวไฟ"');
export const noteNotFoundText = (term: string) => t('ไม่เจอโน้ตที่มีคำว่า "{0}"', term);

// ── a group the bot was taken out of ──
export const GROUP_LEFT_TEXT = (until: string) =>
  t(
    'พี่ฮูกถูกลบออกจากกลุ่มหนึ่งที่คุณเปิดสมุดไว้แล้ว ข้อมูลของกลุ่มนั้นเก็บไว้ให้ถึง {0} หลังจากนั้นจะถูกลบถาวร ถ้าจะใช้ต่อ เพิ่มพี่ฮูกกลับเข้ากลุ่ม แล้วพิมพ์ "เปิดสมุดกลุ่ม" ก่อนวันนั้นนะ',
    until,
  );

// ── feedback to the admin ──
export const FEEDBACK_THANKS_TEXT = t("ขอบคุณที่ช่วยพี่ฮูกพัฒนา 🦉");
export const FEEDBACK_USAGE_TEXT = t(
  'พิมพ์ข้อเสนอแนะต่อท้ายได้เลย เช่น "เสนอแนะ อยากให้มีโหมดมืด" พี่ฮูกจะส่งให้ทีมงานอ่านนะ',
);
export const FEEDBACK_TOO_LONG_TEXT = (max: number) =>
  t("ข้อเสนอแนะยาวเกิน {0} ตัวอักษร ช่วยย่อให้สั้นลงหน่อยนะ", max.toLocaleString("en-US"));
export const FEEDBACK_LIMIT_TEXT = t(
  "ส่งข้อเสนอแนะครบวันนี้แล้ว ไว้ค่อยส่งใหม่ทีหลังได้นะ ขอบคุณมาก 🦉",
);

// ── reminders ──
export const REMINDER_USAGE_TEXT = [
  t("ตั้งเตือน พิมพ์วันเวลาแล้วตามด้วยเรื่องที่ให้เตือน เช่น"),
  t("• เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ"),
  t("• เตือน 25/12 ซื้อของขวัญ"),
  t("• เตือน อีก 30 นาที พักสายตา"),
  t("• เตือน ทุกวัน 8 โมง กินยา"),
  t("• เตือน ทุกวันที่ 1 จ่ายค่าเช่า"),
].join("\n");
export const REMINDER_NO_TEXT_TEXT = t(
  'บอกด้วยว่าให้เตือนเรื่องอะไร เช่น "เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ"',
);
export const REMINDER_PAST_TEXT = t('เวลานั้นผ่านไปแล้ว ลองระบุใหม่ เช่น "เตือน พรุ่งนี้ 9 โมง …"');
export const REMINDER_TOO_FAR_TEXT = t("ตั้งเตือนล่วงหน้าได้ไม่เกิน 1 ปีนะ ลองเช็กวันที่อีกครั้ง");
export const REMINDER_FULL_TEXT = (limit: number, repeat = false) =>
  repeat
    ? t(
        "มีเตือนประจำ (เตือนซ้ำ) ครบ {0} รายการแล้ว ลบอันที่ไม่ใช้ที่หน้าเตือน หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ",
        limit,
      )
    : t(
        "มีเตือนที่รออยู่ครบ {0} รายการแล้ว ลบอันที่ไม่ใช้ที่หน้าเตือน หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ",
        limit,
      );
export const REMINDER_EMPTY_TEXT = [t("ยังไม่มีเตือนที่รออยู่"), "", REMINDER_USAGE_TEXT].join(
  "\n",
);
export const REMINDER_NOT_MATCHED_TEXT = t(
  'ไม่พบเตือนนี้ พิมพ์ "รายการเตือน" เพื่อดูเตือนทั้งหมดได้',
);
export const REMINDER_WHICH_TEXT = t("มีหลายเตือนที่ตรง อันไหนนะ?");
export const REMINDER_WHICH_MORE_TEXT = t(
  "มีหลายเตือนที่ตรง นี่คือ 4 อันแรก ถ้าไม่มีอันที่ต้องการ ลองพิมพ์ชื่อเตือนให้ชัดขึ้นนะ",
);
export const REMINDER_CANCELLED_TEXT = t("ยกเลิกเตือนแล้ว");
export const REMINDER_GONE_TEXT = t("ไม่พบเตือนนี้แล้ว (อาจส่งไปแล้วหรือถูกยกเลิก)");
export const REMINDER_HANDLED_TEXT = t("เตือนนี้จัดการไปแล้วนะ");
/** "✅ ทำแล้ว": a repeating one says when it comes next. */
export const reminderDoneText = (next: string | null) =>
  next ? t("เยี่ยมเลย ✅ รอบหน้าเตือนอีกที {0}", next) : t("เยี่ยมเลย ✅ ปิดเตือนนี้แล้ว");
export const reminderSnoozedText = (when: string, morning: boolean) =>
  t("ได้เลย เดี๋ยวเตือนอีกที{0} นะ {1}", when, morning ? "🌅" : "⏰");
/** The push that arrives at the time. */
export const reminderPushText = (body: string, repeatLabel: string | null, url?: string) =>
  [
    t("⏰ เตือน: {0}", body),
    ...(repeatLabel ? [`(${repeatLabel}${url ? ` · ยกเลิกได้ที่ ${url}` : ""})`] : []),
  ].join("\n");

/** A group's reminder: no link, which would open the owner's own page for everyone. */
/** A group's reminder sent straight to someone it tags. */
export const groupReminderDirectText = (
  groupName: string | null,
  body: string,
  repeatLabel: string | null,
) =>
  [
    `⏰ เตือนจากกลุ่ม${groupName ? ` “${groupName}”` : ""}: ${body}`,
    ...(repeatLabel ? [`(${repeatLabel})`] : []),
  ].join("\n");
export const groupReminderPushText = (body: string, repeatLabel: string | null) =>
  [
    t("⏰ เตือนกลุ่ม: {0}", body),
    ...(repeatLabel ? [t('({0} · พิมพ์ "เตือนกลุ่ม" เพื่อดูหรือยกเลิก)', repeatLabel)] : []),
  ].join("\n");

// ── พี่ฮูก (AI assistant) ──
export const OWL_UNAVAILABLE_TEXT = t("พี่ฮูกยังไม่เปิดให้ถามตอนนี้ ลองใหม่ภายหลังนะ");
export const OWL_PROMPT_TEXT = t(
  '🦉 พี่ฮูกมาแล้ว ถามเรื่องเงินหรือเรื่องทั่วไปได้เลย\nให้ตั้งเตือน จดโน้ต หรือหาไฟล์กับโน้ตก็ได้ เช่น "เตือนกินยา 2 ทุ่ม" หรือ "หาไฟล์สัญญาเช่า"\n(พิมพ์ "จบ" เมื่อคุยเสร็จ)',
);
/** Quick-reply questions (labels are 20 characters at most). None of them changes anything. */
export const OWL_EXAMPLES = [
  t("วิเคราะห์เดือนนี้"),
  t("เหลืองบเท่าไร"),
  t("ควรออมเดือนละเท่าไร"),
  t("ไฟล์ของฉัน"),
] as const;
export const OWL_END_TEXT = t("กลับมาจดรายการตามปกติแล้ว 🦉");
export const OWL_NOT_IN_MODE_TEXT = t('ตอนนี้ไม่ได้ถามพี่ฮูกอยู่นะ พิมพ์ "ถามพี่ฮูก" เมื่ออยากถาม');
export const OWL_TOO_LONG_TEXT = (max: number) => t("ถามสั้นลงหน่อยนะ (ไม่เกิน {0} ตัวอักษร)", max);
export const OWL_SECRET_TEXT = t(
  "ข้อความนี้ดูเหมือนมีรหัสหรือเลขสำคัญ พี่ฮูกเลยไม่ส่งให้ AI นะ ลองถามแบบไม่ใส่เลขดู",
);
export const OWL_FAILED_TEXT = t(
  "พี่ฮูกตอบไม่ได้ตอนนี้ ลองถามใหม่อีกครั้งนะ (ไม่นับโควตาครั้งนี้)",
);
export const OWL_DAY_LIMIT_TEXT = t("วันนี้ถามพี่ฮูกเยอะแล้ว พรุ่งนี้ค่อยมาถามใหม่นะ");
/** A search could not be done (the database did not answer): never said as "nothing found". */
export const FIND_FAILED_TEXT = t("ค้นหาไม่ได้ตอนนี้ ลองใหม่อีกครั้งในอีกสักครู่นะ");
/** Under the count of entries a Free search found. */
export const FIND_TRIAL_TEXT = t('ทดลอง Pro ฟรี 7 วัน ดูยอดรวมในแชทได้เลย ที่เมนู "อัปเกรด"');

/** "ค้นหา …" found nothing in the entries, the notes or the files. */
export const findNothingText = (term: string) =>
  t('ไม่พบรายการ โน้ต หรือไฟล์ที่มีคำว่า "{0}"', term);

/** "ถาม AI" of the month is used up: the chat still works with the ordinary commands. */
export const aiQuotaText = (plan: Plan, limit: number) => {
  const next = nextPlanUp(plan);
  return next
    ? t(
        "เดือนนี้ใช้ ถาม AI ครบ {0} ครั้งแล้ว (แผน {1}) พิมพ์จดแบบปกติได้เหมือนเดิม อัปเกรดเป็น {2} ได้ {3} ครั้ง/เดือน หรือรอต้นเดือนหน้านะ",
        limit,
        PLAN_LABEL[plan],
        PLAN_LABEL[next],
        AI_CHAT_LIMIT[next].toLocaleString("en-US"),
      )
    : t(
        "เดือนนี้ใช้ ถาม AI ครบ {0} ครั้งแล้ว พิมพ์จดแบบปกติได้เหมือนเดิม และใช้ได้ใหม่ต้นเดือนหน้านะ",
        limit,
      );
};

/** Once a day when the month's "ถาม AI" is out: the message was read by the ordinary rules. */
export const AI_OUT_NOTICE_TEXT = t(
  "โควตา ถาม AI เดือนนี้หมดแล้ว คำสั่งต่าง ๆ และการจดแบบ กาแฟ 30 ยังใช้ได้ตามปกติ",
);
