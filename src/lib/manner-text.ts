import { currentLocale } from "./i18n";
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
 * `{name}` is where the call name goes. The plain manner (free plan) never reaches this table.
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

/** "ลบแล้ว: กาแฟ ฿50.00": only the lead changes, the entry and its amount stay. */
const DELETED_LEAD = "ลบแล้ว:";
const DELETED: Line = {
  warm: "ลบให้แล้วนะ:",
  bestie: "ลบแล้วจ้า:",
  spicy: "ลบแล้ว หายไปกับสายลม:",
  tea: "ลบเรียบร้อยครับ:",
  night: "ลบทิ้งแล้ว:",
};

/** "จดสำเร็จ 3 รายการ ✅": the title of the card for several entries; `{n}` is the count. */
const BATCH_TITLE = /^จดสำเร็จ (\d+) รายการ ✅$/;
const BATCH: Line = {
  warm: "จดให้แล้ว {n} รายการนะ ✅",
  bestie: "จดให้แล้ว {n} อัน เว้ย ✅",
  spicy: "จด {n} รายการรวด ขยันจดแต่ขยันใช้ด้วยนะ ✅",
  tea: "บันทึก {n} รายการเรียบร้อยครับ ✅",
  night: "จด {n} รายการ ก่อนตาปรือ ✅",
};

/** "สรุปวันนี้ (…)\nยังไม่มีรายการเลย": the heading stays, the last line changes. */
const EMPTY_TAIL = "\nยังไม่มีรายการเลย";
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
  if (exact) return withName(exact[persona], name);
  const many = BATCH_TITLE.exec(value);
  if (many) return withName(BATCH[persona].replace("{n}", many[1] ?? ""), name);
  // the two patterns are for a plain reply only: never an AI answer, or a title inside a card
  if (!topLevel) return value;
  if (value.startsWith(DELETED_LEAD) && !value.includes("\n")) {
    return DELETED[persona] + value.slice(DELETED_LEAD.length);
  }
  if (value.startsWith("สรุป") && value.endsWith(EMPTY_TAIL) && value.split("\n").length === 2) {
    return value.slice(0, -EMPTY_TAIL.length) + "\n" + withName(EMPTY[persona], name);
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
