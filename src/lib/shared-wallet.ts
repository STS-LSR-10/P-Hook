import type { JoinResult } from "@/lib/shared-wallet-repo";

/** What to tell someone whose invite code did not work. */
export const JOIN_FAIL_TEXT: Record<Extract<JoinResult, { ok: false }>["reason"], string> = {
  invalid: "ไม่พบรหัสนี้ ตรวจตัวเลข 6 หลักอีกครั้งนะ",
  expired: "รหัสนี้หมดอายุแล้ว (ใช้ได้ 24 ชั่วโมง) ขอรหัสใหม่จากเจ้าของกระเป๋านะ",
  used: "รหัสนี้ถูกใช้ไปแล้ว ขอรหัสใหม่จากเจ้าของกระเป๋านะ",
  own: "นี่คือกระเป๋าของคุณเอง ส่งรหัสให้คนที่จะร่วมกระเป๋านะ",
  already: "คุณร่วมกระเป๋านี้อยู่แล้วนะ",
  full: "กระเป๋านี้มีคนร่วมเต็มตามแผนของเจ้าของแล้ว (Starter 2 คน, Pro 5 คน, Elite สูงสุด 10 คน)",
};
