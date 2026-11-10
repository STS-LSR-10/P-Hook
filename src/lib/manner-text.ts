import { currentLocale } from "./i18n";
import { pickOne } from "./line/variety";
import { withName, type ChosenPersona, type PersonaId } from "./personalize";
import {
  ALREADY_RECORDED_TEXT,
  ERROR_TEXT,
  NOT_FOUND_TEXT,
  NOTHING_TO_DELETE_TEXT,
  SLIP_CANCELLED_TEXT,
} from "./line/messages";

/**
 * The fixed lines people see most (the saved / edited card, a few notices), said in the manner they
 * chose. Each is found by its plain wording, so the code that builds a card or a reply stays as it is
 * and one pass at the end of a reply (`applyManner`, like `applyTheme`) changes the voice everywhere.
 * `{name}` is where the call name goes. The plain manner (free plan) never reaches this table (it has its own wordings in `line/variants-data.ts`).
 */
type Line = Record<ChosenPersona, string>;

export const MANNER_LINES: Record<string, Line> = {
  "จดสำเร็จ ✅": {
    warm: "จดให้แล้วนะ ✅",
    bestie: "จดให้แล้วเว้ย ✅",
    spicy: "จดแล้ว ไม่ต้องขอบคุณ ✅",
    tea: "บันทึกเรียบร้อยครับ ✅",
    night: "จดทันก่อนตาปรือ ✅",
  },
  อย่าลืมตรวจสอบรายการที่จดด้วยนะ: {
    warm: "ลองเช็กอีกนิดว่าถูกต้องไหมนะ{name}",
    bestie: "เช็กหน่อยนะ เดี๋ยวจดผิดแล้วมาโทษกัน",
    spicy: "ตรวจเองด้วย อย่าให้พี่ฮูกต้องตามแก้",
    tea: "รบกวนตรวจดูอีกสักนิดนะครับ เผื่อมือลั่น",
    night: "ตาพี่ฮูกสว่างอยู่ แต่ตาเธอก็ตรวจด้วยนะ",
  },
  "แก้ไขรายการสำเร็จ ✅": {
    warm: "แก้ไขให้แล้วนะ ✅",
    bestie: "แก้ให้แล้วจ้า ✅",
    spicy: "แก้แล้ว รอบนี้ถูกยัง ✅",
    tea: "แก้ไขเรียบร้อยครับ ✅",
    night: "แก้ไขแล้ว ✅",
  },
  อัปเดตรายการเรียบร้อยแล้ว: {
    warm: "อัปเดตให้เรียบร้อยแล้วนะ{name}",
    bestie: "อัปเดตแล้ว เนียนกริบ",
    spicy: "เปลี่ยนใจได้ทุกรอบเลยนะเรา",
    tea: "ปรับให้ตามต้องการแล้วครับ",
    night: "อัปเดตแล้ว ก่อนจะลืมอีก",
  },
  "เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ": {
    warm: "เย้! เงินเข้าแล้ว ยินดีด้วยนะ{name}",
    bestie: "เงินเข้าแล้วเว้ย เลี้ยงข้าวหน่อย 555",
    spicy: "มีเงินเข้าแล้ว อย่าเพิ่งรีบใช้หมดนะ",
    tea: "มีรายรับเข้ามาแล้วครับ ยินดีด้วย",
    night: "เงินเข้า! ตาวาวเลยทีเดียว",
  },
  [ERROR_TEXT]: {
    warm: "ขอโทษนะ{name} ระบบสะดุดนิดหน่อย ลองส่งใหม่อีกครั้งนะ",
    bestie: "โอ๊ย ระบบสะดุดว่ะ ลองส่งใหม่อีกทีนะ",
    spicy: "ระบบเอ๋อเอง ไม่ใช่ความผิดเธอหรอก ส่งใหม่อีกทีสิ",
    tea: "ขออภัยครับ ระบบสะดุดชั่วคราว รบกวนลองใหม่อีกสักครู่",
    night: "ระบบหลับใน... ลองส่งใหม่อีกครั้งนะ",
  },
  [NOT_FOUND_TEXT]: {
    warm: "ไม่เจอรายการนี้แล้วนะ{name} อาจถูกลบหรือแก้ไปก่อนหน้า",
    bestie: "หาไม่เจอแล้วว่ะ น่าจะโดนลบหรือแก้ไปก่อนหน้า",
    spicy: "หายไปแล้ว ใครลบน้า น่าจะเธอเองแหละ หรือไม่ก็แก้ไปแล้ว",
    tea: "ไม่พบรายการนี้แล้วครับ คงถูกลบหรือแก้ไขไปก่อนหน้า",
    night: "รายการนี้หายไปแล้ว ตาพี่ฮูกยังหาไม่เจอ อาจถูกลบหรือแก้ไปแล้ว",
  },
  [NOTHING_TO_DELETE_TEXT]: {
    warm: "ยังไม่มีรายการให้ลบเลยนะ{name}",
    bestie: "ยังไม่มีอะไรให้ลบเลยเพื่อน",
    spicy: "ไม่มีอะไรให้ลบสักอย่าง จะลบอะไรเนี่ย",
    tea: "ยังไม่มีรายการให้ลบครับ",
    night: "ยังไม่มีรายการให้ลบ ตาค้างฟรีเลย",
  },
  [ALREADY_RECORDED_TEXT]: {
    warm: "สลิปนี้จดไว้แล้วนะ{name} เลยไม่ได้จดซ้ำให้",
    bestie: "สลิปนี้จดไปแล้วเพื่อน ไม่จดซ้ำนะ",
    spicy: "สลิปนี้จดไปแล้ว ส่งซ้ำทำไม ไม่จดซ้ำให้หรอก",
    tea: "สลิปนี้เคยบันทึกไว้แล้วครับ จึงไม่ได้จดซ้ำ",
    night: "สลิปนี้เห็นมาแล้ว ตาไม่ฝาด ไม่จดซ้ำนะ",
  },
  [SLIP_CANCELLED_TEXT]: {
    warm: "ยกเลิกให้แล้วนะ ไม่ได้จดสลิปนี้",
    bestie: "ยกเลิกแล้วจ้า ไม่จดสลิปนี้",
    spicy: "ยกเลิกแล้ว เปลี่ยนใจไวจริงนะ ไม่จดสลิปนี้",
    tea: "ยกเลิกเรียบร้อยครับ ไม่ได้จดสลิปนี้",
    night: "ยกเลิกแล้ว ไม่จดสลิปนี้",
  },
};

/**
 * More ways to say the same line in each manner (the table above has the first): one is chosen at
 * random each time, so the same thing happening twice is not said the same way twice.
 */
type More = Partial<Record<ChosenPersona, string[]>>;
export const MANNER_MORE: Record<string, More> = {
  "จดสำเร็จ ✅": {
    warm: ["บันทึกให้เรียบร้อยแล้วนะ ✅", "จดไว้ให้แล้วนะ ✅"],
    bestie: ["จดแล้วจ้า เรียบร้อย ✅", "โอเค จดให้ละ ✅"],
    spicy: ["จดแล้ว เรื่องมากจริง ✅", "จดให้แล้ว ขอบคุณสักคำก็ยังดี ✅"],
    tea: ["บันทึกให้แล้วครับ ✅", "จดไว้เรียบร้อยครับ ✅"],
    night: ["จดแล้ว ก่อนง่วงตก ✅", "จดเสร็จ ตายังไม่ปิด ✅"],
  },
  อย่าลืมตรวจสอบรายการที่จดด้วยนะ: {
    warm: ["ลองดูอีกทีว่าถูกต้องไหมนะ{name}", "ตรวจดูอีกนิดนะ{name} เผื่อมีอะไรคลาดเคลื่อน"],
    bestie: ["ดูอีกทีนะ เดี๋ยวจดผิดจะได้แก้ทัน", "เช็กหน่อยว่าถูกไหม พี่ฮูกก็พลาดได้นะ"],
    spicy: [
      "ตรวจเองอีกรอบ อย่าเชื่อพี่ฮูกร้อยเปอร์เซ็นต์",
      "ดูให้ดีก่อน เดี๋ยวจะมาบอกว่าพี่ฮูกจดผิด",
    ],
    tea: ["รบกวนตรวจสอบอีกครั้งนะครับ", "โปรดตรวจดูความถูกต้องอีกสักนิดนะครับ"],
    night: ["ช่วยตรวจอีกทีนะ ดึกแล้วตาอาจฝาด", "ตรวจอีกหน่อย กันพลาดตอนง่วง"],
  },
  "แก้ไขรายการสำเร็จ ✅": {
    warm: ["แก้ไขเรียบร้อยแล้วนะ ✅", "ปรับให้แล้วนะ ✅"],
    bestie: ["แก้เสร็จละจ้า ✅", "แก้ให้แล้วเว้ย ✅"],
    spicy: ["แก้แล้ว หวังว่ารอบนี้ไม่เปลี่ยนใจอีก ✅", "แก้ให้แล้ว ถูกยังเนี่ย ✅"],
    tea: ["ปรับแก้เรียบร้อยครับ ✅", "แก้ไขให้แล้วครับ ✅"],
    night: ["แก้เสร็จแล้ว ✅", "แก้ให้ก่อนตาปรือ ✅"],
  },
  อัปเดตรายการเรียบร้อยแล้ว: {
    warm: ["อัปเดตให้แล้วนะ{name}", "ปรับรายการเรียบร้อยแล้วนะ{name}"],
    bestie: ["อัปเดตละ เนียน ๆ", "ปรับให้แล้วจ้า"],
    spicy: ["อัปเดตแล้ว เปลี่ยนใจกันบ่อยจริง", "ปรับแล้ว รอบหน้าคิดให้ดีก่อนนะ"],
    tea: ["อัปเดตให้เรียบร้อยครับ", "ปรับรายการให้แล้วครับ"],
    night: ["อัปเดตแล้ว ก่อนง่วงสนิท", "ปรับให้แล้ว ตายังสว่างอยู่"],
  },
  "เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ": {
    warm: ["เย้! มีเงินเข้ามาแล้วนะ{name} ดีใจด้วย", "เงินเข้ากระเป๋าแล้วนะ{name} ยินดีด้วย"],
    bestie: ["เงินเข้าแล้ว! เลี้ยงข้าวด้วยนะ 555", "ติ๊ง เงินเข้าเว้ย ดีใจด้วย"],
    spicy: ["เงินเข้าแล้ว ระวังหายเร็วนะ", "มีรายรับแล้ว ใช้ให้เป็นล่ะ"],
    tea: ["มีเงินเข้ากระเป๋าแล้วครับ ยินดีด้วย", "รายรับเข้ามาแล้วครับ"],
    night: ["เงินเข้า ตาตื่นเลย", "ติ๊ง! เงินเข้า ตาสว่างทันที"],
  },
  [ERROR_TEXT]: {
    warm: [
      "ขอโทษนะ{name} ระบบติดขัดนิดหน่อย ลองส่งอีกครั้งนะ",
      "ระบบสะดุดไปแป๊บหนึ่งนะ{name} ส่งใหม่อีกทีนะ",
    ],
    bestie: ["เอ๊ะ ระบบรวนว่ะ ลองส่งอีกทีนะ", "ระบบสะดุดนิดนึง ส่งใหม่เลยเพื่อน"],
    spicy: ["ระบบงอแงเอง ส่งมาใหม่สิ", "ไม่ใช่ความผิดเธอ ระบบเอ๋อ ลองใหม่"],
    tea: [
      "ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
      "ระบบสะดุดเล็กน้อยครับ รบกวนส่งใหม่อีกสักครั้ง",
    ],
    night: ["ระบบงีบไปแป๊บ... ส่งใหม่นะ", "ระบบสะลึมสะลือ ลองส่งอีกทีนะ"],
  },
  [NOT_FOUND_TEXT]: {
    warm: [
      "หารายการนี้ไม่เจอแล้วนะ{name} อาจถูกลบหรือแก้ไปก่อนหน้า",
      "รายการนี้ไม่อยู่แล้วนะ{name} น่าจะถูกลบหรือแก้ไปก่อน",
    ],
    bestie: [
      "รายการนี้หายไปแล้วว่ะ น่าจะโดนลบหรือแก้ไปก่อน",
      "หาไม่เจอแล้วเพื่อน อาจโดนลบหรือแก้ไปแล้ว",
    ],
    spicy: [
      "หาไม่เจอแล้ว ใครลบน้า หรือแก้ไปแล้วก็ไม่รู้",
      "รายการนี้ไม่อยู่แล้ว เธอลบเองหรือเปล่าเนี่ย",
    ],
    tea: [
      "ไม่พบรายการนี้แล้วครับ เข้าใจว่าถูกลบหรือแก้ไขไปก่อนหน้า",
      "รายการนี้ไม่อยู่ในระบบแล้วครับ คงถูกลบหรือแก้ไขไป",
    ],
    night: [
      "รายการนี้หายไปแล้ว ตาพี่ฮูกยังหาไม่เจอ คงถูกลบหรือแก้ไปแล้ว",
      "หาไม่เจอแล้ว อาจถูกลบหรือแก้ไปก่อนหน้า",
    ],
  },
  [NOTHING_TO_DELETE_TEXT]: {
    warm: ["ตอนนี้ยังไม่มีรายการให้ลบนะ{name}", "ยังไม่มีอะไรให้ลบเลยนะ{name}"],
    bestie: ["ตอนนี้ไม่มีอะไรให้ลบนะเพื่อน", "ไม่มีรายการให้ลบว่ะ"],
    spicy: ["ไม่มีอะไรให้ลบเลย จะลบอะไรกันเนี่ย", "ว่างเปล่า ไม่มีให้ลบหรอก"],
    tea: ["ตอนนี้ไม่มีรายการให้ลบครับ", "ยังไม่มีรายการที่ลบได้ครับ"],
    night: ["ไม่มีรายการให้ลบ ตาค้างเปล่า ๆ", "ยังไม่มีอะไรให้ลบเลย"],
  },
  [ALREADY_RECORDED_TEXT]: {
    warm: ["สลิปนี้เคยจดไว้แล้วนะ{name} เลยไม่จดซ้ำให้", "จดสลิปนี้ไปแล้วนะ{name} ไม่ได้จดซ้ำ"],
    bestie: ["สลิปนี้จดไว้แล้วเพื่อน เลยไม่จดซ้ำ", "อันนี้จดไปแล้วนะ ไม่จดซ้ำให้"],
    spicy: ["สลิปนี้จดแล้ว ส่งซ้ำทำไม ไม่จดซ้ำให้นะ", "จดไปแล้ว ส่งมาอีกก็ไม่จดซ้ำ"],
    tea: [
      "สลิปนี้บันทึกไว้แล้วครับ จึงไม่ได้บันทึกซ้ำ",
      "สลิปใบนี้เคยบันทึกแล้วครับ ไม่บันทึกซ้ำนะครับ",
    ],
    night: ["สลิปนี้เห็นแล้ว ไม่จดซ้ำนะ", "จดสลิปนี้ไปแล้ว ตาไม่ฝาด ไม่จดซ้ำ"],
  },
  [SLIP_CANCELLED_TEXT]: {
    warm: ["ยกเลิกเรียบร้อยแล้วนะ ไม่ได้จดสลิปนี้", "ยกเลิกให้แล้วนะ สลิปนี้ไม่ถูกจด"],
    bestie: ["ยกเลิกเรียบร้อยจ้า ไม่จดสลิปนี้", "ยกเลิกแล้วเว้ย สลิปนี้ไม่จด"],
    spicy: ["ยกเลิกแล้ว เปลี่ยนใจเร็วจริง สลิปนี้ไม่จด", "ยกเลิกให้แล้ว ไม่จดสลิปนี้ก็ได้"],
    tea: ["ยกเลิกให้แล้วครับ สลิปนี้ไม่ถูกบันทึก", "ยกเลิกเรียบร้อยครับ ไม่บันทึกสลิปนี้"],
    night: ["ยกเลิกแล้ว สลิปนี้ไม่จด", "ยกเลิกให้ สลิปนี้ไม่ถูกจด"],
  },
};

/** "ลบแล้ว: กาแฟ ฿50.00": only the lead changes, the entry and its amount stay. */
const DELETED_LEAD = "ลบแล้ว:";
const DELETED_MORE: More = {
  warm: ["ลบเรียบร้อยแล้วนะ:", "ลบออกให้แล้วนะ:"],
  bestie: ["ลบเสร็จจ้า:", "ลบให้แล้วเว้ย:"],
  spicy: ["ลบแล้ว หายวับ:", "ลบเรียบ:"],
  tea: ["ลบให้แล้วครับ:", "ลบออกเรียบร้อยครับ:"],
  night: ["ลบแล้ว:", "ลบออกแล้ว:"],
};
const DELETED: Line = {
  warm: "ลบให้แล้วนะ:",
  bestie: "ลบแล้วจ้า:",
  spicy: "ลบแล้ว หายไปกับสายลม:",
  tea: "ลบเรียบร้อยครับ:",
  night: "ลบทิ้งแล้ว:",
};

/** "จดสำเร็จ 3 รายการ ✅": the title of the card for several entries; `{n}` is the count. */
const BATCH_TITLE = /^จดสำเร็จ (\d+) รายการ ✅$/;
const BATCH_MORE: More = {
  warm: ["บันทึกให้แล้ว {n} รายการนะ ✅", "จดไป {n} รายการแล้วนะ ✅"],
  bestie: ["จดแล้ว {n} อันจ้า ✅", "จดให้ {n} รายการแล้วเว้ย ✅"],
  spicy: ["จดไป {n} รายการ ขยันจดแล้วก็ขยันประหยัดด้วยนะ ✅", "จด {n} รายการรวด เหนื่อยแทน ✅"],
  tea: ["บันทึกครบ {n} รายการแล้วครับ ✅", "จดไว้ {n} รายการเรียบร้อยครับ ✅"],
  night: ["จดแล้ว {n} รายการ ตายังไม่ปิด ✅", "จดไป {n} รายการ ✅"],
};
const BATCH: Line = {
  warm: "จดให้แล้ว {n} รายการนะ ✅",
  bestie: "จดให้แล้ว {n} อัน เว้ย ✅",
  spicy: "จด {n} รายการรวด ขยันจดแต่ขยันใช้ด้วยนะ ✅",
  tea: "บันทึก {n} รายการเรียบร้อยครับ ✅",
  night: "จด {n} รายการ ก่อนตาปรือ ✅",
};

/** "สรุปวันนี้ (…)\nยังไม่มีรายการเลย": the heading stays, the last line changes. */
const EMPTY_TAIL = "\nยังไม่มีรายการเลย";
const EMPTY_MORE: More = {
  warm: [
    "ยังว่างอยู่เลยนะ{name} เริ่มจดอันแรกกันเถอะ",
    "ตอนนี้ยังไม่มีรายการนะ{name} มาจดอันแรกกัน",
  ],
  bestie: ["ยังไม่มีอะไรเลยเพื่อน จดอันแรกสิ", "ว่างเปล่าเลย มาจดกัน"],
  spicy: ["ไม่มีรายการเลย ไม่ได้ใช้เงินจริงหรือไม่ได้จด", "ว่างโล่ง ขี้เกียจจดหรือเปล่าเนี่ย"],
  tea: ["ตอนนี้ยังไม่มีรายการครับ", "ยังไม่มีรายการให้แสดงครับ"],
  night: ["ยังไม่มีรายการ ตาจะค้างฟรี", "ว่างอยู่ ยังไม่มีอะไรให้ดู"],
};
const EMPTY: Line = {
  warm: "ยังไม่มีรายการเลยนะ{name} เริ่มจดอันแรกกันเถอะ",
  bestie: "ยังว่างเปล่าเลยเพื่อน จดอันแรกสิ",
  spicy: "ว่างเปล่า ไม่ได้ใช้เงินจริงหรือขี้เกียจจดเนี่ย",
  tea: "ยังไม่มีรายการเลยครับ",
  night: "ยังไม่มีรายการเลย ตาจะค้างเปล่า ๆ",
};

function swap(
  value: string,
  persona: ChosenPersona,
  name: string | null | undefined,
  topLevel: boolean,
): string {
  const exact = MANNER_LINES[value];
  if (exact)
    return withName(pickOne([exact[persona], ...(MANNER_MORE[value]?.[persona] ?? [])]), name);
  const many = BATCH_TITLE.exec(value);
  if (many) {
    const said = pickOne([BATCH[persona], ...(BATCH_MORE[persona] ?? [])]);
    return withName(said.replace("{n}", many[1] ?? ""), name);
  }
  // the two patterns are for a plain reply only: never an AI answer, or a title inside a card
  if (!topLevel) return value;
  if (value.startsWith(DELETED_LEAD) && !value.includes("\n")) {
    return (
      pickOne([DELETED[persona], ...(DELETED_MORE[persona] ?? [])]) +
      value.slice(DELETED_LEAD.length)
    );
  }
  if (value.startsWith("สรุป") && value.endsWith(EMPTY_TAIL) && value.split("\n").length === 2) {
    const said = pickOne([EMPTY[persona], ...(EMPTY_MORE[persona] ?? [])]);
    return value.slice(0, -EMPTY_TAIL.length) + "\n" + withName(said, name);
  }
  return value;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Says the fixed lines above in the person's manner. Only the `text` / `altText` of a message is
 * read (never the text a button sends: the bot reads that as a command). The plain manner, an
 * English chat (translated later from the plain wording) and any other text come back untouched.
 */
export function applyManner<T extends { type: string }>(
  messages: T[],
  persona: PersonaId,
  name?: string | null,
): T[] {
  if (persona === "plain" || currentLocale() === "en") return messages;
  const walk = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    const out: Record<string, Json> = {};
    const isAction = node.type === "message";
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        (key === "text" || key === "altText") && typeof value === "string" && !isAction
          ? swap(value, persona, name, false)
          : walk(value);
    }
    return out;
  };
  return messages.map((m) => {
    const top = m as unknown as { type: string; text?: unknown };
    if (top.type === "text" && typeof top.text === "string") {
      const rest = walk({ ...(m as unknown as Record<string, Json>), text: "" }) as Record<
        string,
        Json
      >;
      return { ...rest, text: swap(top.text, persona, name, true) } as unknown as T;
    }
    return walk(m as unknown as Json) as unknown as T;
  });
}
