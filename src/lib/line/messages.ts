import { noteTitle } from "@/lib/note";
import { formatThaiDate } from "@/lib/thai-date";
import { REFERRAL_BONUS_REFEREE, REFERRAL_WINDOW_DAYS } from "@/lib/config";
import type { LineMessage } from "@/lib/types";

export function text(message: string): LineMessage {
  return { type: "text", text: message };
}

export const NOT_UNDERSTOOD_TEXT =
  'ยังไม่เข้าใจข้อความนี้ ลองพิมพ์ชื่อรายการแล้วตามด้วยจำนวนเงิน เช่น "กาแฟ 30" หรือพิมพ์ "วิธีใช้งาน" ดูวิธีใช้นะ';

export const NOT_A_SLIP_TEXT =
  "ดูเหมือนรูปนี้ไม่ใช่สลิปหรือใบเสร็จ ลองส่งรูปสลิปที่เห็นจำนวนเงินชัด ๆ อีกครั้งนะ";
export const SLIP_UNREADABLE_TEXT =
  'อ่านสลิปนี้ไม่ได้ ลองถ่ายใหม่ให้เห็นตัวเลขชัด ๆ ไม่เบลอ ไม่มีแสงสะท้อน หรือพิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200"';
export const IMAGE_ERROR_TEXT = "โหลดรูปไม่สำเร็จ ลองส่งรูปอีกครั้งนะ";
export const IMAGE_TOO_LARGE_TEXT = "รูปใหญ่เกินไป (เกิน 10 MB) ลองลดขนาดแล้วส่งใหม่นะ";
export const ALREADY_RECORDED_TEXT = "สลิปนี้เคยจดไว้แล้วนะ ไม่ได้จดซ้ำ";
export const SLIP_LOCKED_TEXT =
  'สัปดาห์นี้อ่านสลิปฟรีครบ 3 ใบแล้ว (รีเซ็ตทุกวันจันทร์) การอ่านสลิปไม่จำกัดสัปดาห์เป็นของแผน Pro ขึ้นไป (Pro 30 ใบ/เดือน, Elite ไม่จำกัด) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ตอนนี้พิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200" นะ';
export const SLIP_FREE_LEFT_TEXT = (left: number) =>
  left > 0
    ? `อ่านสลิปฟรีสัปดาห์นี้ได้อีก ${left} ใบ (สัปดาห์ละ 3 ใบ) อยากอ่านได้มากกว่านี้ ลองทดลองใช้ Pro ฟรี 7 วันที่เมนู "อัปเกรด" นะ`
    : 'นี่คือสลิปฟรีใบสุดท้ายของสัปดาห์นี้ (สัปดาห์ละ 3 ใบ) อยากอ่านได้มากกว่านี้ ลองทดลองใช้ Pro ฟรี 7 วันที่เมนู "อัปเกรด" นะ';
export const SLIP_QUOTA_TEXT =
  'เดือนนี้อ่านสลิปครบ 30 ใบแล้ว (แผน Pro) พิมพ์จดเองได้ไม่จำกัด เช่น "ค่าไฟ 1200" อัปเกรดเป็น Elite เพื่ออ่านสลิปได้ไม่จำกัด หรือรอโควตารีเซ็ตต้นเดือนหน้านะ';
export const SLIP_FAIR_USE_TEXT = (limit: number) =>
  `เดือนนี้อ่านสลิปครบ ${limit} ใบตามเกณฑ์ใช้งานปกติแล้ว พิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200" และจะอ่านสลิปได้ใหม่ต้นเดือนหน้านะ`;
export const SLIP_CANCELLED_TEXT = "ยกเลิกแล้ว ไม่ได้จดสลิปนี้";
export const PICK_CATEGORY_TEXT = "เลือกหมวดที่ถูกต้องนะ";
export const REFERRAL_BONUS_TEXT = `ได้โบนัสชวนเพื่อน +${REFERRAL_BONUS_REFEREE} เหรียญสะสมแล้ว! ตรวจดูได้ที่หน้าตั้งค่า`;
export const USE_CODE_USAGE_TEXT =
  'พิมพ์ "ใช้รหัส" ตามด้วยรหัสของเพื่อน เช่น "ใช้รหัส ABCD1234" เพื่อรับโบนัสทั้งสองฝ่ายนะ';
export const REFERRAL_OK_TEXT = `ใช้รหัสแล้ว! พอจดรายการแรกจะได้โบนัส ${REFERRAL_BONUS_REFEREE} เหรียญสะสม และเพื่อนก็ได้ด้วยนะ`;
export const REFERRAL_FAIL_TEXT = {
  invalid: "ไม่พบรหัสชวนเพื่อนนี้ ตรวจตัวอักษรอีกครั้งนะ",
  self: "ใช้รหัสของตัวเองไม่ได้นะ",
  already: "คุณใช้รหัสชวนเพื่อนไปแล้ว",
  expired: `ใช้รหัสได้ภายใน ${REFERRAL_WINDOW_DAYS} วันแรกหลังเริ่มใช้งานเท่านั้นนะ`,
} as const;

export function referralShareText(code: string): string {
  return [
    `รหัสชวนเพื่อนของคุณ: ${code}`,
    `ให้เพื่อนพิมพ์ "ใช้รหัส ${code}" ในแชทนี้ พอเพื่อนจดรายการแรก ทั้งคู่ได้โบนัสเหรียญสะสม`,
  ].join("\n");
}

export const MEMORY_PLUS_HINT_TEXT =
  "จดหมวดนี้ให้แล้วนะ การจำผู้รับ → หมวดอัตโนมัติเป็นฟีเจอร์ของแผน Pro (แลกวัน Pro ด้วยเหรียญสะสมได้ที่หน้าตั้งค่า)";

export const SLIP_SOON_TEXT =
  'ฟีเจอร์อ่านสลิปกำลังจะมาเร็ว ๆ นี้ ตอนนี้พิมพ์จดได้เลย เช่น "ค่าไฟ 1200" นะ';

export const TOO_MANY_MESSAGES_TEXT =
  "ส่งมาเร็วไปนิดนะ รอสักครู่แล้วค่อยส่งต่อ ข้อความช่วงนี้อาจไม่ได้ถูกจด";

export const ERROR_TEXT = "ขออภัย ระบบสะดุดชั่วคราว ลองส่งใหม่อีกครั้งในอีกสักครู่นะ";

export const NOTHING_TO_DELETE_TEXT = "ยังไม่มีรายการให้ลบนะ";
export const NOT_FOUND_TEXT = "ไม่พบรายการนี้แล้ว (อาจถูกลบหรือแก้ไขไปก่อนหน้า)";
export const EDIT_USAGE_TEXT =
  'พิมพ์ "แก้ล่าสุด" ตามด้วยจำนวนเงินใหม่ เช่น "แก้ล่าสุด 45" เพื่อแก้รายการล่าสุดนะ';
export const EDIT_LINK_TEXT = "แตะลิงก์นี้เพื่อแก้ไขรายการ (ชื่อ ยอด วันที่ หมวด) ได้เลยนะ";
export const EDIT_HINT_TEXT =
  'ถ้าเป็นรายการล่าสุด พิมพ์ "แก้ล่าสุด 45" เพื่อเปลี่ยนจำนวนเงินได้เลย (การแก้รายการอื่นจะทำได้ในหน้ารายการเร็ว ๆ นี้)';

export const BACKDATE_LOCKED_TEXT =
  'การจดย้อนหลัง (เช่น "เมื่อวาน กาแฟ 60") เป็นฟีเจอร์ของแผน Pro ขึ้นไป ยังไม่ได้จดรายการนี้นะ ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" หรือพิมพ์จดเป็นวันนี้ได้เลย';

export const MULTI_ENTRY_LOCKED_TEXT =
  'การจดหลายรายการในข้อความเดียว (เช่น "ข้าวเช้า 50 / กาแฟ 45") เป็นฟีเจอร์ของแผน Pro ขึ้นไป ยังไม่ได้จดข้อความนี้นะ ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" หรือส่งทีละรายการได้เลย';

export const TAGS_LOCKED_TEXT =
  'การติดแท็ก (เช่น "หมูกระทะ 500 #ปาร์ตี้") เป็นฟีเจอร์ของแผน Pro ขึ้นไป ยังไม่ได้จดรายการนี้นะ ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" หรือพิมพ์จดโดยไม่ใส่แท็กได้เลย';

// ───── yearly summary and month-by-month comparison ─────
export const YEAR_LOCKED_TEXT =
  'การสรุปรายปีเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์ "สรุปเดือนนี้" ได้เลย';
export const YEAR_BAD_TEXT =
  "ระบุปีไม่ถูกต้อง ใส่ปี พ.ศ. หรือ ค.ศ. ที่ไม่เกินปีนี้และย้อนหลังไม่เกิน 10 ปี เช่น สรุปปี 2568";
export const yearEmptyText = (yearBE: number) => `สรุปรายปี ${yearBE}\nยังไม่มีรายการในปีนี้`;
export const COMPARE_LOCKED_TEXT =
  'การเทียบเดือนต่อเดือนรายหมวดเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const COMPARE_EMPTY_TEXT = "ยังไม่มีรายจ่ายทั้งสองช่วงให้เทียบ ลองจดรายการเพิ่มก่อนนะ";

// ───── AI insight ─────
export const INSIGHT_LOCKED_TEXT =
  'AI Insight (วิเคราะห์การใช้จ่ายด้วย AI) เป็นฟีเจอร์เฉพาะแผน Elite ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้ดูได้ด้วย "เทียบเดือน" หรือ "สรุปหมวด"';
export const INSIGHT_LIMIT_TEXT = "วันนี้ขอวิเคราะห์ครบจำนวนแล้ว พรุ่งนี้ลองใหม่ได้นะ";
export const INSIGHT_EMPTY_TEXT =
  "ยังไม่มีรายจ่ายในรอบนี้ให้วิเคราะห์ ลองจดรายการสักพักแล้วถามใหม่นะ";

// ───── forecast ─────
export const FORECAST_LOCKED_TEXT =
  'การพยากรณ์เงินปลายเดือนเป็นฟีเจอร์เฉพาะแผน Elite ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้ดูสรุปได้ด้วย "สรุปเดือนนี้" หรือ "เทียบเดือน"';
export const FORECAST_EMPTY_TEXT =
  "ยังไม่มีข้อมูลในรอบนี้พอให้พยากรณ์ ลองจดรายการสักพักแล้วถามใหม่นะ";

// ───── recent entries ─────
export const RECENT_EMPTY_TEXT = "ยังไม่มีรายการเลย ลองพิมพ์ เช่น กาแฟ 30 ดูนะ";

// ───── search with totals ─────
export const SEARCH_LOCKED_TEXT =
  'การค้นหาพร้อมยอดรวมเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้ค้นหาในหน้ารายการของแอปได้เลย';
export const SEARCH_USAGE_TEXT = [
  "พิมพ์คำที่ต้องการค้นหาต่อท้าย เช่น",
  "• ค้นหา กาแฟ",
  "• ค้นหา #ปาร์ตี้บริษัท",
].join("\n");
export const searchEmptyText = (term: string) => `ค้นหา "${term}"\nไม่พบรายการที่ตรงกันเลย`;

// ───── custom date range summary ─────
export const SUMMARY_RANGE_LOCKED_TEXT =
  'การสรุปช่วงวันเองเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์ "สรุปเดือนนี้" ได้เลย';
export const SUMMARY_RANGE_USAGE_TEXT = [
  "ระบุช่วงวันที่ให้ครบทั้งวันเริ่มและวันสิ้นสุด เช่น",
  "• สรุป 1/10 ถึง 15/10",
  "• สรุป 20/10-30/10 หรือ 20oct-30oct",
  "• สรุป 1-15 ต.ค. หรือ 20 ต.ค. - 30 ต.ค.",
  "• สรุป ตั้งแต่ 1/1/2569 ถึง วันนี้",
  'หรือกดปุ่ม "📆 ช่วงวันเอง" ใต้การ์ดสรุปแล้วเลือกจากปฏิทิน',
].join("\n");
export const SUMMARY_RANGE_BAD_DATE_TEXT = "วันที่ไม่ถูกต้อง ลองใหม่ เช่น สรุป 1/10 ถึง 15/10 นะ";
export const SUMMARY_RANGE_ORDER_TEXT =
  "วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด ลองสลับวันที่แล้วส่งใหม่นะ";
export const SUMMARY_RANGE_TOO_LONG_TEXT =
  "เลือกช่วงได้ไม่เกิน 366 วัน ลองย่อช่วงวันที่ลงแล้วส่งใหม่นะ";

// ───── backdating with the date picker ─────
export const BACKDATE_PICKER_LOCKED_TEXT =
  'การจดย้อนหลังเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์จดเป็นวันนี้ได้เลย';
export const BACKDATE_BAD_DATE_TEXT =
  'วันที่ที่เลือกใช้ไม่ได้ (ต้องไม่เกินวันนี้) ลองกด "จดย้อนหลัง" แล้วเลือกใหม่ได้เลยนะ';

// ───── AI-assisted reading of long sentences ─────
export const SMART_PREFACE_TEXT = "ให้ AI ช่วยอ่านข้อความนี้แล้ว ตรวจก่อนจดนะ";
export const SMART_CANCELLED_TEXT = "ยกเลิกแล้ว ไม่ได้จดรายการนี้ ลองพิมพ์ใหม่ได้เลย";

// ───── receipt split ─────
export const SPLIT_LOCKED_TEXT =
  'การแยกรายการจากใบเสร็จเป็นฟีเจอร์เฉพาะแผน Elite กด "ยืนยัน" เพื่อจดเป็นยอดรวมใบเดียวได้เลยนะ';
export const SPLIT_UNAVAILABLE_TEXT =
  'ใบนี้แยกรายการไม่ได้ (อ่านรายการได้ไม่พอ หรือยอดรายการเกินยอดรวม) กด "ยืนยัน" เพื่อจดเป็นยอดรวมใบเดียวนะ';
export const splitDoneText = (lines: { title: string; amountBaht: string }[], totalBaht: string) =>
  [
    `แยกเป็น ${lines.length} รายการแล้ว (รวม ฿${totalBaht})`,
    ...lines.slice(0, 12).map((l) => `• ${l.title} ฿${l.amountBaht}`),
    ...(lines.length > 12 ? [`และอีก ${lines.length - 12} รายการ`] : []),
  ].join("\n");

// ───── photos attached to entries ─────
export const PHOTO_LOCKED_TEXT =
  'การแนบรูปประกอบรายการเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
// Short on purpose: the camera / album buttons ride on this one line.
export const PHOTO_ASK_TEXT = "📎 เลือกรูปที่จะแนบ";
export const PHOTO_ASK_REPLACE_TEXT = "📎 เลือกรูปใหม่ (แทนรูปเดิม)";
export const PHOTO_LIMIT_TEXT =
  "เดือนนี้แนบรูปครบจำนวนแล้ว ไว้เดือนหน้าแนบเพิ่มได้ใหม่นะ ตอนนี้จดรายการได้ตามปกติ";
export const PHOTO_ATTACHED_TEXT = (title: string) => `แนบรูปกับ "${title}" แล้ว`;
export const PHOTO_EXPIRED_TEXT =
  'หมดเวลารอรูปของรายการนี้แล้ว กดปุ่ม "แนบรูป" ที่การ์ดรายการอีกครั้งได้เลยนะ';

// ───── voice messages ─────
export const VOICE_LOCKED_TEXT =
  'ใช้สิทธิ์ลองจดด้วยเสียงฟรีครบแล้ว จดด้วยเสียงเป็นฟีเจอร์ของแผน Pro ขึ้นไป (Pro 20 ครั้ง/เดือน, Elite ไม่จำกัด) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ตอนนี้พิมพ์จดได้เลย เช่น "กาแฟ 30"';
export const VOICE_TASTE_TEXT =
  'นี่คือสิทธิ์ลองจดด้วยเสียงฟรี 1 ครั้ง (ใช้ครบแล้ว) ชอบไหม? ลองทดลองใช้ Pro ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
/** Monthly voice quota reached; Pro is pointed at Elite, Elite is told when it resets. */
export const voiceQuotaText = (plan: string, limit: number): string =>
  plan === "ultimate"
    ? `เดือนนี้จดด้วยเสียงครบ ${limit} ครั้งตามเกณฑ์ใช้งานปกติแล้ว พิมพ์จดแทนได้เลย และจะใช้เสียงได้ใหม่ต้นเดือนหน้านะ`
    : `เดือนนี้จดด้วยเสียงครบ ${limit} ครั้งแล้ว (แผน Pro) พิมพ์จดแทนได้เลย อัปเกรดเป็น Elite เพื่อจดด้วยเสียงได้ไม่จำกัด หรือรอรีเซ็ตต้นเดือนหน้านะ`;
export const VOICE_UNAVAILABLE_TEXT = "ตอนนี้ยังไม่เปิดให้จดด้วยเสียง พิมพ์จดแทนได้เลยนะ";
export const VOICE_TOO_LONG_TEXT =
  "ข้อความเสียงยาวเกินไป (สูงสุด 30 วินาที) ลองพูดสั้น ๆ ครั้งละไม่กี่รายการนะ";
export const VOICE_DAY_LIMIT_TEXT =
  "วันนี้จดด้วยเสียงครบจำนวนแล้ว พิมพ์จดแทนได้เลย พรุ่งนี้ใช้ได้ใหม่นะ";
export const VOICE_FAILED_TEXT = "ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง หรือพิมพ์จดแทนได้นะ";
export const VOICE_EMPTY_TEXT = "ไม่ได้ยินเสียงพูดชัด ๆ ลองพูดใหม่ให้ใกล้ไมค์อีกนิดนะ";
export const VOICE_CANCELLED_TEXT = "ยกเลิกแล้ว ไม่ได้จดรายการนี้ ลองพูดใหม่ได้เลย";
export const voiceHeardText = (heard: string) => `ได้ยินว่า: "${heard}"`;
export const voiceNoAmountText = (heard: string) =>
  `ได้ยินว่า "${heard}" แต่ไม่เจอจำนวนเงิน ลองพูดใหม่ เช่น "กาแฟ สามสิบบาท" หรือพิมพ์จดแทนได้นะ`;

export const WALLET_NOT_FOUND_TEXT = (hint: string, names: string[]) =>
  `ไม่พบกระเป๋า "${hint}" เลยยังไม่ได้จดรายการนี้\nกระเป๋าที่มี: ${names.join(" · ")}\nพิมพ์ชื่อใหม่อีกครั้ง หรือไม่ใส่ @ เพื่อจดลงกระเป๋าหลักนะ`;
export const WALLET_AMBIGUOUS_TEXT = (hint: string, names: string[]) =>
  `"${hint}" ตรงกับหลายกระเป๋า (${names.join(" · ")}) เลยยังไม่ได้จดรายการนี้\nพิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ`;
export const WALLET_MOVED_TEXT = (title: string, wallet: string) =>
  `ย้าย "${title}" ไปที่ ${wallet} แล้ว`;
export const WALLET_SLIP_MOVED_TEXT = (wallet: string, count: number) =>
  count > 1 ? `ย้ายทั้ง ${count} รายการไป ${wallet} แล้ว` : `ย้ายไป ${wallet} แล้ว`;
export const WALLET_SLIP_ASK_TEXT = "ย้ายรายการของสลิปนี้ไปกระเป๋าไหนดี?";
export const WALLET_MOVE_ASK_TEXT = "ย้ายรายการนี้ไปกระเป๋าไหนดี?";
export const TRANSFER_LOCKED_TEXT =
  'การโอนระหว่างกระเป๋าเป็นฟีเจอร์ของแผน Pro ขึ้นไป (มีกระเป๋าได้ถึง 5 ใบ) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const TRANSFER_SAME_TEXT = "โอนไปกระเป๋าเดียวกันไม่ได้ ลองระบุสองกระเป๋าที่ต่างกันนะ";
export const TRANSFER_USAGE_TEXT =
  'โอนระหว่างกระเป๋าพิมพ์ เช่น "โอน 500 เงินสด>KTC" หรือ "โอน 500 จาก เงินสด ไป KTC" การโอนไม่นับเป็นรายรับหรือรายจ่ายนะ';
export const TRANSFER_CANCELLED_TEXT = "ยกเลิกการโอนแล้ว ยอดสองกระเป๋ากลับเป็นเหมือนเดิม";
export const CARD_LOCKED_TEXT =
  'วงเงินและยอดตามรอบบิลของบัตรเครดิตเป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const CARD_NONE_TEXT =
  'ยังไม่มีกระเป๋าบัตรเครดิต เพิ่มได้ที่หน้ากระเป๋า (เลือกชนิด "บัตรเครดิต" แล้วใส่วงเงินกับวันตัดรอบ) แล้วจดด้วย "กาแฟ 45 @ชื่อบัตร" นะ';
export const CARD_NO_DETAIL_TEXT =
  "บัตรนี้ยังไม่ได้ตั้งวงเงินหรือวันตัดรอบ ตั้งได้ที่หน้ากระเป๋านะ";
export const DEBT_LOCKED_TEXT =
  'การจดหนี้สิน (ให้ยืม/ยืม) เป็นฟีเจอร์ของแผน Elite ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const DEBT_EMPTY_TEXT =
  'ยังไม่มีหนี้ค้าง ลองพิมพ์ "ให้ยืม สมชาย 500" หรือ "ยืม แม่ 2000 คืน 25/10" (ใส่ @กระเป๋า ท้ายข้อความได้ เช่น "ให้ยืม สมชาย 500 @เงินสด") และ "สมชายคืน 200" เมื่อได้เงินคืนนะ';
export const DEBT_TOO_MANY_TEXT = "คนเดียวกันมีหนี้ค้างได้ไม่เกิน 200 ก้อน";
export const DEBT_BAD_DUE_TEXT =
  "วันครบกำหนดไม่ถูกต้อง ลองใช้รูปแบบ 25/10 หรือ พรุ่งนี้ หรือ ภายใน 7 วัน นะ";
export const DEBT_CANCELLED_TEXT = "ยกเลิกแล้ว ยอดกระเป๋ากลับเป็นเหมือนเดิม";
export const debtOverpayText = (person: string, leftBaht: string) =>
  `ชำระเกินยอดที่เหลือไม่ได้ ${person} เหลือ ฿${leftBaht} ลองพิมพ์ยอดที่ไม่เกินนี้นะ`;
export const FX_LOCKED_TEXT =
  'การจดเงินต่างสกุล (เช่น 1500 JPY) แปลงเป็นบาทให้อัตโนมัติ เป็นฟีเจอร์ของแผน Elite ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ตอนนี้พิมพ์ยอดเป็นบาทได้เลย';
export const fxUnsupportedText = (code: string) =>
  `ยังไม่รองรับสกุล ${code} (แหล่งอัตราแลกเปลี่ยนไม่มี) ลองพิมพ์ยอดเป็นบาทแทนนะ`;
export const FX_FAILED_TEXT =
  "ดึงอัตราแลกเปลี่ยนไม่ได้ในตอนนี้ เลยยังไม่ได้จดรายการนี้ ลองใหม่อีกครั้งในสักครู่ หรือพิมพ์ยอดเป็นบาทได้เลยนะ";
export const FX_TOO_SMALL_TEXT =
  "ยอดนี้แปลงเป็นบาทแล้วน้อยกว่า 1 สตางค์ ลองตรวจจำนวนเงินอีกครั้งนะ";
export const DAILY_BUDGET_LOCKED_TEXT =
  'งบรายวัน (บอทเตือนทันทีเมื่อวันนี้ใช้เกิน) เป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const DAILY_BUDGET_USAGE_TEXT =
  'ตั้งงบรายวันพิมพ์ เช่น "งบวัน 500" ดูสถานะด้วย "งบวัน" และปิดด้วย "งบวัน ปิด" นะ';
export const DAILY_BUDGET_NONE_TEXT =
  'ยังไม่ได้ตั้งงบรายวัน พิมพ์ เช่น "งบวัน 500" เพื่อตั้งวงเงินที่วันหนึ่งไม่ควรใช้เกินนะ';
export const DAILY_BUDGET_CLEARED_TEXT = "ปิดงบรายวันแล้ว";
export const dailyBudgetSetText = (baht: string) =>
  `ตั้งงบรายวัน ฿${baht} แล้ว ถ้าวันไหนใช้เกิน บอทจะเตือนทันทีนะ`;
export const GOAL_LOCKED_TEXT =
  'เป้าหมายการออม (กระปุก) เป็นฟีเจอร์ของแผน Pro ขึ้นไป ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const GOAL_EMPTY_TEXT =
  'ยังไม่มีเป้าหมายการออม ลองพิมพ์ "เป้าหมาย ใหม่ เที่ยวญี่ปุ่น 30000" (ใส่วันที่ได้ เช่น "ภายใน 31/3") แล้วหยอดกระปุกด้วย "ออม เที่ยวญี่ปุ่น 2000" นะ';
export const goalFullText = (limit: number) =>
  `มีเป้าหมายได้ ${limit} ใบแล้ว ลบอันที่ไม่ใช้ในหน้าเป้าหมาย${limit < 20 ? " หรืออัปเกรดเป็น Elite เพื่อมีได้ 20 ใบ" : ""}นะ`;
export const GOAL_EXISTS_TEXT = "มีเป้าหมายชื่อนี้อยู่แล้ว ใช้ชื่ออื่นหรือหยอดกระปุกเดิมได้เลยนะ";
export const GOAL_BAD_DUE_TEXT = "วันที่ไม่ถูกต้อง ลองใช้รูปแบบ 31/3 หรือ ภายใน 90 วัน นะ";
export const goalAmbiguousText = (name: string, names: string[]) =>
  `"${name}" ตรงกับหลายเป้าหมาย (${names.join(" · ")}) พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ`;
export const goalOverdrawText = (name: string, savedBaht: string) =>
  `ถอนเกินยอดที่ออมไว้ไม่ได้ ${name} มี ฿${savedBaht} ลองพิมพ์ยอดที่ไม่เกินนี้นะ`;
export const GOAL_UNDONE_TEXT = "ยกเลิกรายการหยอดกระปุกแล้ว";
export const GOAL_UNDO_BLOCKED_TEXT = "ยกเลิกรายการนี้ไม่ได้ เพราะมีการถอนที่ตามมา";
export const BILL_LOCKED_TEXT =
  'การเตือนวันครบกำหนดจ่ายบิลเป็นฟีเจอร์ของแผน Elite ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ';
export const BILL_EMPTY_TEXT =
  'ยังไม่มีบิลที่ตั้งเตือนไว้ ลองพิมพ์ "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15 เตือนก่อน 2 วัน" (ระบุเวลาได้ เช่น "เวลา 20:00") นะ';
export const BILL_USAGE_TEXT =
  'ตั้งบิลพิมพ์ เช่น "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15" · "บิล ใหม่ ประกันรถ 12000 ทุกปี 1/3" · "บิล ใหม่ ค่าส่วนกลาง 800 วันที่ 25/12" ต่อท้ายด้วย "เตือนก่อน 2 วัน" (หรือ "เตือนก่อน 3,1 วัน") และ "เวลา 20:00" ได้ ไม่ใส่ = เตือนก่อน 1 วัน เวลา 09:00';
export const billFullText = (limit: number) =>
  `มีบิลได้ ${limit} รายการแล้ว ลบอันที่ไม่ใช้ในหน้าบิลก่อนนะ`;
export const BILL_EXISTS_TEXT = "มีบิลชื่อนี้อยู่แล้ว ใช้ชื่ออื่น หรือแก้ของเดิมในหน้าบิลนะ";
export const billAmbiguousText = (name: string, names: string[]) =>
  `"${name}" ตรงกับหลายบิล (${names.join(" · ")}) พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ`;
export const BILL_GONE_TEXT =
  'บิลนี้ถูกจัดการไปแล้ว (หรือไม่พบแล้ว) ดูรายการล่าสุดด้วยคำสั่ง "บิล" นะ';
export const BILL_SNOOZED_TEXT = "ได้เลย พรุ่งนี้จะเตือนอีกครั้ง";
export const BILL_RECORDED_ALREADY_TEXT = "จดรายจ่ายของบิลรอบนี้ไปแล้วนะ";
export const GROUP_LOCKED_TEXT =
  'สมุดกลุ่มเป็นฟีเจอร์ของแผน Elite เฉพาะคนที่เปิดสมุดต้องเป็น Elite เพื่อน ๆ ในกลุ่มใช้ได้ฟรี ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ของบอทในแชทส่วนตัวนะ';
export const GROUP_OPENED_TEXT =
  'เปิดสมุดกลุ่มแล้ว 🎉 ใครในกลุ่มก็จดได้ เช่น "จด ข้าวเที่ยง 350" แล้วพิมพ์ "สรุป" ดูว่าใครจ่ายไปเท่าไร (พิมพ์ "วิธีใช้งาน" ดูวิธีใช้ทั้งหมด)';
export const GROUP_ALREADY_OPEN_TEXT = "สมุดกลุ่มนี้เปิดอยู่แล้วนะ";
export const GROUP_OTHER_OWNER_TEXT =
  'สมุดกลุ่มนี้มีเจ้าของสมุดอยู่แล้ว ถ้าอยากเปลี่ยน ให้เจ้าของเดิมพิมพ์ "ปิดสมุดกลุ่ม" ก่อนแล้วเปิดใหม่นะ';
export const GROUP_TOO_MANY_TEXT = `คุณเป็นเจ้าของสมุดกลุ่มครบ 5 กลุ่มแล้ว ปิดกลุ่มที่ไม่ใช้ก่อนนะ`;
export const GROUP_NOT_OPEN_TEXT =
  'กลุ่มนี้ยังไม่ได้เปิดสมุด สมาชิกที่เป็นแผน Elite พิมพ์ "เปิดสมุดกลุ่ม" ได้เลย';
export const GROUP_PAUSED_TEXT =
  "สมุดกลุ่มนี้หยุดจดชั่วคราว เพราะแผน Elite ของเจ้าของสมุดหมดอายุ ดูสรุปได้ตามปกติ ต่ออายุแผนแล้วจดต่อได้เลยนะ";
export const GROUP_CLOSED_TEXT =
  'ปิดสมุดกลุ่มแล้ว ข้อมูลยังเก็บไว้ เปิดใหม่ได้ด้วย "เปิดสมุดกลุ่ม"';
export const GROUP_OWNER_ONLY_TEXT = "เฉพาะเจ้าของสมุดเท่านั้นที่ทำอย่างนี้ได้นะ";
export const GROUP_NO_USER_TEXT =
  "บอทยังไม่รู้ว่าใครพิมพ์ ให้เพิ่มบอทเป็นเพื่อน (และยอมรับข้อกำหนดของ LINE OA) ก่อน แล้วลองพิมพ์ใหม่นะ";
export const GROUP_RECORD_USAGE_TEXT =
  'พิมพ์ชื่อรายการแล้วตามด้วยจำนวนเงิน เช่น "จด ข้าวเที่ยง 350" นะ';
export const GROUP_EXPENSE_ONLY_TEXT = "สมุดกลุ่มจดรายจ่ายเท่านั้นนะ ลองพิมพ์ยอดโดยไม่ใส่ + นำหน้า";
export const GROUP_TOO_MANY_ENTRIES_TEXT = "จดได้ครั้งละไม่เกิน 5 รายการนะ";
export const GROUP_DAY_FULL_TEXT = "วันนี้กลุ่มนี้จดครบ 300 รายการแล้ว พรุ่งนี้มาจดต่อนะ";
export const GROUP_RECENT_EMPTY_TEXT = "ยังไม่มีรายการในสมุดกลุ่ม";
export const GROUP_NOTHING_TO_DELETE_TEXT = "ไม่มีรายการของคุณให้ลบ";
export const GROUP_DELETED_TEXT = "ลบแล้ว";
export const GROUP_CANNOT_DELETE_TEXT = "ลบได้เฉพาะรายการของตัวเอง (หรือเจ้าของสมุดลบได้ทุกรายการ)";
export const GROUP_ENTRY_GONE_TEXT = "ไม่พบรายการนี้แล้ว";
export const GROUP_TRIP_EXISTS_TEXT =
  'มีทริปที่เปิดอยู่แล้ว พิมพ์ "จบทริป" ก่อนแล้วค่อยเริ่มทริปใหม่นะ';
export const GROUP_NO_TRIP_TEXT =
  'ยังไม่มีทริปที่เปิดอยู่ พิมพ์ "เริ่มทริป ชื่อทริป" เพื่อเริ่มหารค่าใช้จ่ายนะ';
export const GROUP_TRIP_NO_EXIST_TEXT =
  'ยังไม่เคยมีทริปในกลุ่มนี้ พิมพ์ "เริ่มทริป ชื่อทริป" ได้เลย';
export const GROUP_TRIP_CLOSE_DENIED_TEXT = "จบทริปได้เฉพาะคนที่เริ่มทริปหรือเจ้าของสมุดนะ";
export const GROUP_SPLIT_NEEDS_TRIP_TEXT =
  'ใช้ "หาร" / "ไม่หาร" ได้เฉพาะตอนมีทริปที่เปิดอยู่ พิมพ์ "เริ่มทริป ชื่อทริป" ก่อนนะ';
export const groupTripStartedText = (name: string) =>
  `เริ่มทริป "${name}" แล้ว 🧳 ต่อไปทุกรายการที่ "จด" จะหารเท่ากันทุกคนที่ร่วมทริป\nกดปุ่มด้านล่างเพื่อร่วมทริป (หรือพิมพ์ "ร่วมทริป") ถ้าจะหารไม่เท่ากันพิมพ์เช่น "จด ไวน์ 900 หาร แอน บ๊อบ" หรือ "จด ค่าห้อง 3000 ไม่หาร บ๊อบ" จบแล้วพิมพ์ "สรุปทริป"`;
export const groupTripJoinedText = (who: string, trip: string, count: number) =>
  `${who} ร่วมทริป "${trip}" แล้ว (ตอนนี้ ${count} คน)`;
export const groupSplitUnknownText = (names: string[]) =>
  `ไม่รู้จัก ${names.join(", ")} ในทริปนี้ ให้เขาพิมพ์ "ร่วมทริป" ก่อน (หรือพิมพ์ชื่อให้ตรงกับชื่อใน LINE) เลยยังไม่ได้จดรายการนี้นะ`;
export const groupSplitAmbiguousText = (names: string[]) =>
  `${names.join(", ")} ตรงกับหลายคน พิมพ์ชื่อให้ชัดขึ้นอีกนิดนะ เลยยังไม่ได้จดรายการนี้`;
export const GROUP_TRIP_OLD_EMPTY_TEXT = "ยังไม่มีทริปที่จบแล้ว";
export const SHARED_WALLET_ONLY_ENTRIES_TEXT =
  "กระเป๋าร่วมใช้ได้เฉพาะรายรับ/รายจ่ายตอนนี้ โอน หนี้ และบัตรเครดิตยังใช้ได้กับกระเป๋าส่วนตัวเท่านั้นนะ";
export const SHARED_WALLET_LOCKED_TEXT =
  'กระเป๋าร่วมกับคนอื่นเป็นฟีเจอร์ของแผน Pro ขึ้นไป (Pro 2 คน, Elite สูงสุด 10 คน) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" นะ ส่วนการถูกชวนเข้ากระเป๋าร่วม ใช้แผนไหนก็ร่วมได้ฟรี';
export const sharedInviteText = (wallet: string, code: string) =>
  `ชวนเข้ากระเป๋า "${wallet}" 💑\nรหัส: ${code}\nให้เขาพิมพ์ในแชทกับบอทว่า\nร่วมกระเป๋า ${code}\n(ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง)`;
export const sharedJoinedText = (wallet: string) =>
  `ร่วมกระเป๋า "${wallet}" แล้ว 🎉 จดลงกระเป๋านี้ได้ด้วย @${wallet} เช่น "ข้าวเย็น 300 @${wallet}" ส่วนกระเป๋าและรายการส่วนตัวของคุณยังเป็นส่วนตัวเหมือนเดิม คนที่ร่วมเห็นเฉพาะรายการที่ลงกระเป๋านี้`;
export const sharedLeftText = (wallet: string) =>
  `ออกจากกระเป๋า "${wallet}" แล้ว รายการที่เคยจดไว้ยังอยู่ในกระเป๋านั้น`;
export const SHARED_INVITE_OWNER_ONLY_TEXT = "เฉพาะเจ้าของกระเป๋าที่ชวนคนอื่นได้นะ";
export const SHARED_OWNER_CANNOT_LEAVE_TEXT =
  "เจ้าของออกจากกระเป๋าร่วมไม่ได้ ถ้าไม่ใช้แล้วให้ลบกระเป๋าที่หน้ากระเป๋าเงินนะ";
export const SHARED_JOIN_USAGE_TEXT =
  'พิมพ์ "ร่วมกระเป๋า" ตามด้วยรหัส 6 หลัก เช่น "ร่วมกระเป๋า 482913" นะ';

// ── PDF (statements, bills, lists) ──
export const PDF_UNAVAILABLE_TEXT = "ตอนนี้ยังไม่เปิดให้จดจากไฟล์ PDF ลองพิมพ์จดเองไปก่อนนะ";
export const PDF_ONLY_TEXT =
  "รับเฉพาะไฟล์ PDF นะ (บิล ใบเสร็จ หรือรายการเดินบัญชี) ไฟล์อื่นยังอ่านไม่ได้";
export const PDF_LOCKED_TEXT =
  'จดจากไฟล์ PDF เป็นฟีเจอร์ของแผน Pro ขึ้นไป (Pro 10 ไฟล์/เดือน, Elite 30 ไฟล์/เดือน) ลองทดลองใช้ฟรี 7 วันได้ที่เมนู "อัปเกรด" ตอนนี้พิมพ์จดเองได้เลย เช่น "ค่าไฟ 1200" นะ';
export const PDF_TOO_LARGE_TEXT =
  "ไฟล์ใหญ่เกิน 5 MB ลองแยกเป็นไฟล์เล็กลง (เช่น ทีละเดือน) แล้วส่งใหม่นะ";
export const PDF_TOO_MANY_PAGES_TEXT =
  "ไฟล์ยาวเกิน 10 หน้า ลองแยกเป็นไฟล์สั้นลง (เช่น ทีละเดือน) แล้วส่งใหม่นะ";
export const PDF_PASSWORD_TEXT =
  "ไฟล์นี้ตั้งรหัสผ่านไว้ บอทเปิดอ่านไม่ได้ ปลดรหัสผ่านก่อน (หรือบันทึกเป็น PDF ใหม่แบบไม่มีรหัส) แล้วส่งมาอีกครั้งนะ";
export const PDF_NOT_PDF_TEXT = "ไฟล์นี้เปิดไม่ได้หรือไม่ใช่ PDF ลองส่งใหม่อีกครั้งนะ";
export const PDF_FAILED_TEXT =
  "อ่านไฟล์ PDF ไม่สำเร็จ ลองส่งอีกครั้ง หรือพิมพ์จดเองได้เลยนะ (ไฟล์นี้ยังไม่ถูกนับโควตา)";
export const PDF_NO_ENTRIES_TEXT =
  "ไม่เจอรายการรายรับ/รายจ่ายในไฟล์นี้ ถ้าเป็นไฟล์สแกนที่ภาพไม่ชัด ลองส่งใหม่ให้ชัดขึ้น หรือพิมพ์จดเองได้เลยนะ (ไฟล์นี้ยังไม่ถูกนับโควตา)";
export const PDF_ALL_DUPLICATE_TEXT =
  "ทุกรายการในไฟล์นี้มีอยู่ในสมุดของคุณแล้ว (วันที่ ยอด และประเภทตรงกัน) เลยไม่ได้จดซ้ำ ไม่นับโควตา";
export const PDF_ALREADY_TEXT = "ไฟล์นี้เคยส่งมาจดแล้วนะ ไม่ได้จดซ้ำ";
export const PDF_DAY_LIMIT_TEXT = "วันนี้อ่านไฟล์ PDF เยอะแล้ว พรุ่งนี้ค่อยส่งใหม่ได้นะ";
export const pdfQuotaText = (plan: "plus" | "ultimate", limit: number) =>
  plan === "plus"
    ? `เดือนนี้อ่านไฟล์ PDF ครบ ${limit} ไฟล์แล้ว (แผน Pro) พิมพ์จดเองได้ไม่จำกัด หรืออัปเกรดเป็น Elite เพื่อให้อ่านได้ 30 ไฟล์/เดือน หรือรอโควตารีเซ็ตต้นเดือนหน้านะ`
    : `เดือนนี้อ่านไฟล์ PDF ครบ ${limit} ไฟล์แล้ว พิมพ์จดเองได้เลย และจะอ่านไฟล์ได้ใหม่ต้นเดือนหน้านะ`;
export const PDF_CANCELLED_TEXT = "ยกเลิกแล้ว ไม่ได้จดรายการจากไฟล์นี้ ส่งไฟล์ใหม่ได้เลย";
export const PDF_ALREADY_DONE_TEXT = "ชุดรายการนี้จัดการไปแล้ว หรือหมดอายุแล้วนะ";
export const pdfRecordedText = (count: number) =>
  `จดแล้ว ${count} รายการ ดูได้ที่เมนู "รายการ" และแก้ไขภายหลังได้`;

// ── plain messages sorted by the AI ──
export const SECRET_ASK_TEXT =
  "ข้อความนี้ดูเหมือนรหัสหรือเลขสำคัญ พี่ฮูกเลยไม่ส่งให้ AI อ่าน จะบันทึกเป็นโน้ตไหม?\n⚠️ โน้ตเก็บเป็นข้อความธรรมดา ไม่ควรเก็บรหัสผ่านสำคัญ";
export const INTENT_CONFIRM_TEXT = (label: string) => `พี่ฮูกเข้าใจว่าให้${label} ใช่ไหม?`;
export const INTENT_UNCLEAR_TEXT = "พี่ฮูกไม่แน่ใจ อยากให้ทำอะไรกับข้อความนี้?";
export const INTENT_CANCELLED_TEXT = "ยกเลิกแล้ว ไม่ได้บันทึกอะไร";
export const INTENT_EXPIRED_TEXT = "รายการนี้หมดเวลาหรือทำไปแล้ว ลองพิมพ์ใหม่อีกครั้งนะ";
export const ROUTER_REMINDER_HINT_TEXT =
  'ถ้าจะตั้งเตือน พิมพ์ขึ้นต้นด้วย "เตือน" เช่น "เตือน กินยา 6 โมงเย็น"\nถ้าจะจดเงิน พิมพ์ชื่อกับจำนวน เช่น "กาแฟ 50"';
export const MONEY_HINT_TEXT = 'ลองพิมพ์ชื่อรายการกับจำนวนเงิน เช่น "ค่าหมอ 800" นะ';

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

// ── kept files ──
export const FILE_ASK_KEEP_TEXT = "จะให้พี่ฮูกเก็บไฟล์นี้ไว้ไหม?";
export const FILE_ASK_PDF_TEXT = "ไฟล์ PDF นี้ จะให้พี่ฮูกทำอะไร?";
export const FILE_BLOCKED_TEXT = "พี่ฮูกไม่รับไฟล์ติดตั้งโปรแกรม เช่น .exe หรือ .apk นะ";
export const FILE_TOO_LARGE_TEXT = "ไฟล์ใหญ่เกิน 20 MB ลองย่อขนาดแล้วส่งใหม่นะ";
export const fileFullText = (capacity: string) =>
  `พื้นที่เก็บไฟล์เต็มแล้ว (${capacity}) ลบไฟล์เก่าในคลัง หรืออัปเกรดแผนเพื่อเพิ่มพื้นที่นะ`;
export const fileDayLimitText = (limit: number) =>
  `วันนี้เก็บไฟล์ครบ ${limit} ไฟล์แล้ว พรุ่งนี้ส่งใหม่ได้เลยนะ`;
export const FILE_GONE_TEXT =
  "ไฟล์นี้หมดอายุจาก LINE แล้ว ส่งไฟล์มาอีกครั้งได้เลย พี่ฮูกรออยู่ 5 นาที";
export const FILE_FAILED_TEXT = "เก็บไฟล์ไม่สำเร็จ ลองส่งอีกครั้งนะ";
export const FILE_UNAVAILABLE_TEXT = "ตอนนี้ระบบเก็บไฟล์ยังไม่พร้อม ลองใหม่อีกครั้งนะ";
export const FILE_EXPIRED_TEXT = "ไฟล์นี้หมดเวลาหรือจัดการไปแล้ว ส่งใหม่ได้เลยนะ";
export const FILE_SEND_NOW_TEXT = "ส่งไฟล์มาได้เลย พี่ฮูกรออยู่ 5 นาที";
export const FILE_NOT_FOUND_TEXT = "ยังไม่มีไฟล์ที่เก็บไว้";
export const FILE_VIDEO_ELSEWHERE_TEXT = "วิดีโอนี้อยู่นอก LINE พี่ฮูกเก็บให้ไม่ได้นะ";
export const FILE_NAME_ASK_TEXT =
  'อยากตั้งชื่อใหม่ให้หาง่ายไหม? กดปุ่มตั้งชื่อใหม่ หรือพิมพ์ เช่น "ชื่อไฟล์ รูปบัตร"';
export const FILE_NAME_MANY_TEXT = "ตั้งชื่อแต่ละไฟล์ให้หาง่ายได้ที่คลัง";
export const fileNotFoundText = (term: string) => `ไม่พบไฟล์หรือโน้ตที่มีคำว่า "${term}"`;
export const fileSpaceText = (used: string, capacity: string, url?: string) =>
  `ใช้ไป ${used} จาก ${capacity}${url ? `\nดูไฟล์ทั้งหมด: ${url}` : ""}`;
export const fileRenamedText = (name: string) => `เปลี่ยนชื่อเป็น "${name}" แล้ว`;

// ── notes ──
export const NOTE_SAVED_TEXT = (preview: string, url?: string) =>
  `จดโน้ตแล้ว 📝\n"${preview}"${url ? `\nดู แก้ไข หรือค้นหาทั้งหมด: ${url}` : ""}`;
export const NOTE_SECRET_WARNING_TEXT =
  "⚠️ โน้ตเก็บเป็นข้อความธรรมดา ไม่ควรเก็บรหัสผ่านสำคัญหรือเลขบัตรไว้ที่นี่";
export const NOTE_UNDONE_TEXT = "ยกเลิกโน้ตแล้ว";
export const NOTE_TOO_LONG_TEXT = (max: number) =>
  `โน้ตยาวเกิน ${max.toLocaleString("en-US")} ตัวอักษร ลองแบ่งเป็นหลายโน้ตนะ`;
export const NOTE_FULL_TEXT = (limit: number) =>
  `โน้ตเต็ม ${limit.toLocaleString("en-US")} รายการแล้ว ลบอันเก่าในคลัง หรืออัปเกรดแผนเพื่อเก็บเพิ่มนะ`;
export const NOTE_EMPTY_TEXT = 'ยังไม่มีโน้ต พิมพ์ เช่น "โน้ต ซื้อนม รหัสไวไฟ 1234" ได้เลย';
export const NOTE_SEARCH_USAGE_TEXT = 'พิมพ์คำที่ต้องการหาต่อท้าย เช่น "ค้นหาโน้ต ไวไฟ"';
export const noteNotFoundText = (term: string) => `ไม่เจอโน้ตที่มีคำว่า "${term}"`;

// ── reminders ──
export const REMINDER_USAGE_TEXT = [
  "ตั้งเตือน พิมพ์วันเวลาแล้วตามด้วยเรื่องที่ให้เตือน เช่น",
  "• เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ",
  "• เตือน 25/12 ซื้อของขวัญ",
  "• เตือน อีก 30 นาที พักสายตา",
  "• เตือน ทุกวัน 8 โมง กินยา",
  "• เตือน ทุกวันที่ 1 จ่ายค่าเช่า",
].join("\n");
export const REMINDER_NO_TEXT_TEXT =
  'บอกด้วยว่าให้เตือนเรื่องอะไร เช่น "เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ"';
export const REMINDER_PAST_TEXT = 'เวลานั้นผ่านไปแล้ว ลองระบุใหม่ เช่น "เตือน พรุ่งนี้ 9 โมง …"';
export const REMINDER_TOO_FAR_TEXT = "ตั้งเตือนล่วงหน้าได้ไม่เกิน 1 ปีนะ ลองเช็กวันที่อีกครั้ง";
export const REMINDER_FULL_TEXT = (limit: number) =>
  `มีเตือนที่รออยู่ครบ ${limit} รายการแล้ว ลบอันที่ไม่ใช้ที่หน้าเตือน หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ`;
export const REMINDER_EMPTY_TEXT = ["ยังไม่มีเตือนที่รออยู่", "", REMINDER_USAGE_TEXT].join("\n");
export const REMINDER_NOT_MATCHED_TEXT = 'ไม่พบเตือนนี้ พิมพ์ "รายการเตือน" เพื่อดูเตือนทั้งหมดได้';
export const REMINDER_WHICH_TEXT = "มีหลายเตือนที่ตรง อันไหนนะ?";
export const REMINDER_WHICH_MORE_TEXT =
  "มีหลายเตือนที่ตรง นี่คือ 4 อันแรก ถ้าไม่มีอันที่ต้องการ ลองพิมพ์ชื่อเตือนให้ชัดขึ้นนะ";
export const REMINDER_CANCELLED_TEXT = "ยกเลิกเตือนแล้ว";
export const REMINDER_GONE_TEXT = "ไม่พบเตือนนี้แล้ว (อาจส่งไปแล้วหรือถูกยกเลิก)";
/** The push that arrives at the time. */
export const reminderPushText = (body: string, repeatLabel: string | null, url?: string) =>
  [
    `⏰ เตือน: ${body}`,
    ...(repeatLabel ? [`(${repeatLabel}${url ? ` · ยกเลิกได้ที่ ${url}` : ""})`] : []),
  ].join("\n");

// ── พี่ฮูก (AI assistant) ──
export const OWL_UNAVAILABLE_TEXT = "พี่ฮูกยังไม่เปิดให้ถามตอนนี้ ลองใหม่ภายหลังนะ";
export const OWL_PROMPT_TEXT =
  '🦉 พี่ฮูกมาแล้ว ถามเรื่องเงินหรือเรื่องทั่วไปได้เลย\nให้ตั้งเตือน จดโน้ต หรือหาไฟล์กับโน้ตก็ได้ เช่น "เตือนกินยา 2 ทุ่ม" หรือ "หาไฟล์สัญญาเช่า"\n(พิมพ์ "จบ" เมื่อคุยเสร็จ)';
/** Quick-reply questions (labels are 20 characters at most). None of them changes anything. */
export const OWL_EXAMPLES = [
  "วิเคราะห์เดือนนี้",
  "เหลืองบเท่าไร",
  "ควรออมเดือนละเท่าไร",
  "ไฟล์ของฉัน",
] as const;
export const OWL_END_TEXT = "กลับมาจดรายการตามปกติแล้ว 🦉";
export const OWL_NOT_IN_MODE_TEXT = 'ตอนนี้ไม่ได้ถามพี่ฮูกอยู่นะ พิมพ์ "ถามพี่ฮูก" เมื่ออยากถาม';
export const OWL_TOO_LONG_TEXT = (max: number) => `ถามสั้นลงหน่อยนะ (ไม่เกิน ${max} ตัวอักษร)`;
export const OWL_SECRET_TEXT =
  "ข้อความนี้ดูเหมือนมีรหัสหรือเลขสำคัญ พี่ฮูกเลยไม่ส่งให้ AI นะ ลองถามแบบไม่ใส่เลขดู";
export const OWL_FAILED_TEXT = "พี่ฮูกตอบไม่ได้ตอนนี้ ลองถามใหม่อีกครั้งนะ (ไม่นับโควตาครั้งนี้)";
export const OWL_DAY_LIMIT_TEXT = "วันนี้ถามพี่ฮูกเยอะแล้ว พรุ่งนี้ค่อยมาถามใหม่นะ";
export const owlQuotaText = (plan: "free" | "plus" | "ultimate", limit: number) =>
  plan === "free"
    ? `เดือนนี้ถามพี่ฮูกครบ ${limit} ครั้งแล้ว (แผน Free) อัปเกรดเป็น Pro ถามได้ 50 ครั้ง/เดือน หรือรอโควตารีเซ็ตต้นเดือนหน้านะ`
    : plan === "plus"
      ? `เดือนนี้ถามพี่ฮูกครบ ${limit} ครั้งแล้ว (แผน Pro) อัปเกรดเป็น Elite ถามได้ 300 ครั้ง/เดือน หรือรอโควตารีเซ็ตต้นเดือนหน้านะ`
      : `เดือนนี้ถามพี่ฮูกครบ ${limit} ครั้งตามเกณฑ์ใช้งานปกติแล้ว ถามได้ใหม่ต้นเดือนหน้านะ`;
