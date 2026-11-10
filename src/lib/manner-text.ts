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
    warm: "จดให้แล้วนะค้าบ ✅",
    bestie: "จดแล้วว่ะ ✅",
    spicy: "จดแล้ว พักก่อนนะ ✅",
    tea: "บันทึกเรียบร้อยครับ น่าสนใจดี ✅",
  },
  อย่าลืมตรวจสอบรายการที่จดด้วยนะ: {
    warm: "ลองดูอีกทีว่าถูกมั้ยน้า{name}",
    bestie: "เช็กอีกทีนะแก เผื่อจดผิดว่ะ",
    spicy: "เอาดี ๆ ตรวจเองอีกรอบ อย่าเชื่อใจพี่ฮูกร้อยเปอร์เซ็นต์",
    tea: "รบกวนตรวจดูอีกสักนิดนะครับ ก็แล้วแต่จะพิจารณา",
  },
  "แก้ไขรายการสำเร็จ ✅": {
    warm: "แก้ให้แล้วนะค้าบ ✅",
    bestie: "แก้ให้แล้วว่ะ ✅",
    spicy: "แก้แล้ว รอบนี้ถูกยังคุณน้า ✅",
    tea: "แก้ไขเรียบร้อยครับ ✅",
  },
  อัปเดตรายการเรียบร้อยแล้ว: {
    warm: "อัปเดตให้แล้วนะค้าบ{name}",
    bestie: "อัปเดตให้แล้วว่ะ{name}",
    spicy: "อัปเดตแล้ว เปลี่ยนไวจริงนะคุณน้า",
    tea: "อัปเดตเรียบร้อยครับ",
  },
  "เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ": {
    warm: "เย้! เงินเข้าแล้ว ยินดีด้วยนะค้าบ{name}",
    bestie: "เงินเข้าแล้วว่ะ{name} เลี้ยงข้าวป่ะ 555",
    spicy: "เงินเข้า! ท่องไว้ว่าจน อย่าเพิ่งรีบเผานะ",
    tea: "มีรายรับเข้ามาแล้วครับ น่าสนใจดี",
  },
  [ERROR_TEXT]: {
    warm: "ขอโทษนะค้าบ{name} ระบบสะดุดนิดนึง ลองส่งอีกทีน้า",
    bestie: "เอ้า ระบบรวนว่ะ ลองส่งอีกทีดิ",
    spicy: "ระบบเอ๋อเองว้าย ไม่ใช่ความผิดคุณน้าหรอก ส่งใหม่ดิ",
    tea: "ขออภัยครับ ระบบสะดุดชั่วคราว รบกวนลองใหม่อีกครั้งนะครับ",
  },
  [NOT_FOUND_TEXT]: {
    warm: "ไม่เจอรายการนี้แล้วน้า{name} อาจถูกลบหรือแก้ไปก่อนหน้านะค้าบ",
    bestie: "หาไม่เจอแล้วว่ะ น่าจะโดนลบหรือแก้ไปก่อน",
    spicy: "ว้าย หายไปแล้ว ไม่เจอรายการนี้ น่าจะถูกลบหรือแก้ไปก่อนหน้า",
    tea: "ไม่พบรายการนี้แล้วครับ คงถูกลบหรือแก้ไขไปก่อนหน้า",
  },
  [NOTHING_TO_DELETE_TEXT]: {
    warm: "ยังไม่มีรายการให้ลบเลยนะ{name}",
    bestie: "ยังไม่มีอะไรให้ลบเลยแก",
    spicy: "ไม่มีอะไรให้ลบสักอย่าง เอาดี ๆ จะลบอะไร",
    tea: "ยังไม่มีรายการให้ลบครับ",
  },
  [ALREADY_RECORDED_TEXT]: {
    warm: "สลิปนี้จดไว้แล้วนะค้าบ{name} เลยไม่จดซ้ำให้",
    bestie: "สลิปนี้จดไปแล้วแก ไม่จดซ้ำนะ",
    spicy: "สลิปนี้จดไปแล้ว ส่งซ้ำทำไม อย่าหาทำ ไม่จดซ้ำให้",
    tea: "สลิปนี้บันทึกไว้แล้วครับ จึงไม่ได้บันทึกซ้ำ",
  },
  [SLIP_CANCELLED_TEXT]: {
    warm: "ยกเลิกให้แล้วนะค้าบ ไม่ได้จดสลิปนี้",
    bestie: "ยกเลิกแล้วว่ะ ไม่จดสลิปนี้",
    spicy: "ยกเลิกแล้ว เปลี่ยนใจไวจังคุณน้า ไม่จดสลิปนี้",
    tea: "ยกเลิกเรียบร้อยครับ ไม่ได้จดสลิปนี้",
  },
};

/**
 * More ways to say the same line in each manner (the table above has the first): one is chosen at
 * random each time, so the same thing happening twice is not said the same way twice.
 */
type More = Partial<Record<ChosenPersona, string[]>>;
export const MANNER_MORE: Record<string, More> = {
  "จดสำเร็จ ✅": {
    warm: ["เรียบร้อยครับผม จดไว้ให้แล้วน้า ✅", "จดแล้วนะ คนเก่ง ✅"],
    bestie: ["โอเค ลงสมุดให้ละ จัดไป ✅", "เรียบร้อย เวิร์กเลย ✅"],
    spicy: ["จดให้ละ ว้าย เก่งจังนะคุณน้า ✅", "บันทึกแล้ว พักก่อนนะ ✅"],
    tea: ["จดไว้ให้แล้วครับ ตามสะดวกเลยครับ ✅", "เรียบร้อยครับ ✅"],
  },
  อย่าลืมตรวจสอบรายการที่จดด้วยนะ: {
    warm: ["ช่วยเช็กอีกนิดนะค้าบ{name} เผื่อพลาด", "ตรวจอีกทีนะคนเก่ง เผื่อมีอะไรคลาด"],
    bestie: ["ดูหน่อยว่าถูกมั้ย เอาจริงพี่ฮูกก็พลาดได้", "ตรวจให้ชัวร์อีกรอบดิ{name}"],
    spicy: ["สติค่ะ ดูก่อนว่าถูกมั้ย", "ตรวจเองด้วย อย่าหาทำให้พี่ฮูกโดนว่า"],
    tea: ["รบกวนตรวจดูอีกรอบด้วยนะครับ น่าจะดีกว่า", "ตามสะดวกครับ แต่ตรวจดูอีกทีก็ดีนะครับ"],
  },
  "แก้ไขรายการสำเร็จ ✅": {
    warm: ["แก้ไขให้แล้วน้า ไม่เป็นไรเลย ✅", "ปรับให้แล้วนะคนเก่ง ✅"],
    bestie: ["แก้เสร็จละ เวิร์กเลย ✅", "โอเค แก้ให้แล้วนะ แก ✅"],
    spicy: ["แก้ให้ละ เปลี่ยนใจบ่อยจังนะ ✅", "แก้เรียบร้อย ทีหน้าเช็กก่อนจดนะ ✅"],
    tea: ["ปรับให้แล้วครับ ช่างน่าเอ็นดูที่เปลี่ยนใจได้ ✅", "แก้ไขแล้วครับ ตามสะดวกเลยครับ ✅"],
  },
  อัปเดตรายการเรียบร้อยแล้ว: {
    warm: ["ปรับรายการเรียบร้อยครับผม", "อัปเดตแล้วน้า{name} สู้ ๆ นะ"],
    bestie: ["ปรับละ เนียนเลย", "เรียบร้อย อัปเดตแล้วว่ะ"],
    spicy: ["ปรับให้ละ เอาดี ๆ ทีหน้าเช็กก่อนจดนะ", "อัปเดตแล้ว สติค่ะ คิดให้ดีก่อนทีหน้า"],
    tea: ["ปรับให้แล้วครับ ตามสะดวก", "อัปเดตแล้วครับ น่าสนใจดี"],
  },
  "เย้! มีเงินเข้ากระเป๋าเพิ่มแล้วนะ": {
    warm: ["เงินเข้ากระเป๋าแล้วน้า{name} คนเก่งจริง ๆ", "มีรายรับเข้ามาแล้ว ดีใจด้วยครับผม{name}"],
    bestie: ["ติ๊ง! เงินเข้า โคตรดีเลย", "เงินเข้าแล้วแก เอาจริงดีใจด้วยนะ"],
    spicy: ["มีเงินเข้าละ ว้าย อย่าหาทำใช้หมดในวันเดียว", "รายรับมาแล้ว สติค่ะ เก็บไว้บ้าง"],
    tea: [
      "เงินเข้าเรียบร้อยครับ ขอแสดงความยินดี",
      "รายรับเข้ามาแล้วครับ ก็แล้วแต่จะพิจารณาว่าจะอยู่นานแค่ไหน",
    ],
  },
  [ERROR_TEXT]: {
    warm: [
      "โอ๊ย ระบบรวนไปแป๊บนึงครับผม{name} ไม่เป็นไรนะ ลองใหม่เลย",
      "ระบบสะดุดครับ{name} ไม่ใช่ความผิดคุณเลย ลองส่งอีกทีนะ",
    ],
    bestie: [
      "ระบบเอ๋อไปแป๊บ ส่งใหม่ป่ะ",
      "ระบบสะดุดว่ะ{name} เอาจริงไม่ใช่ความผิดแกเลย ส่งใหม่เลย",
    ],
    spicy: [
      "ระบบงอแงเอง ไม่ใช่ความผิดเธอหรอก ลองส่งใหม่อีกทีนะ",
      "เอาดี ๆ ระบบสะดุด ไม่ใช่ความผิดเธอ ส่งใหม่เลย",
    ],
    tea: [
      "ระบบขัดข้องเล็กน้อยครับ รบกวนลองใหม่อีกครั้ง",
      "ระบบสะดุดชั่วคราวครับ ขออภัยในความไม่สะดวก ลองใหม่อีกทีนะครับ",
    ],
  },
  [NOT_FOUND_TEXT]: {
    warm: [
      "หารายการนี้ไม่เจอครับผม{name} น่าจะถูกลบหรือแก้ไปแล้ว",
      "รายการนี้ไม่อยู่แล้วนะ{name} น่าจะถูกลบหรือแก้ไปแล้ว ไม่เป็นไรเลย",
    ],
    bestie: [
      "รายการนี้หายไปละแก เอาจริงน่าจะโดนลบ",
      "ไม่เจอแล้วว่ะ{name} อาจโดนแก้หรือลบไปก่อนหน้า",
    ],
    spicy: [
      "ไม่เจอรายการนี้ เอาดี ๆ เช็กที่หน้ารายการอีกทีนะ อาจถูกลบหรือแก้ไปแล้ว",
      "ไม่เจอรายการนี้แล้วคุณน้า น่าจะถูกลบหรือแก้ไปก่อนหน้า",
    ],
    tea: [
      "รายการนี้ไม่อยู่ในระบบแล้วครับ คงถูกลบหรือแก้ไขไป",
      "ไม่พบรายการนี้ในระบบครับ ดูเหมือนจะถูกลบหรือแก้ไขไปก่อนหน้า",
    ],
  },
  [NOTHING_TO_DELETE_TEXT]: {
    warm: ["ตอนนี้ไม่มีอะไรให้ลบน้า", "ยังไม่มีรายการที่ลบได้ครับผม"],
    bestie: ["ไม่มีรายการให้ลบว่ะ", "ยังว่างอยู่ ไม่มีอะไรให้ลบดิ"],
    spicy: ["ว่างเปล่าเลยคุณน้า ไม่มีให้ลบ", "สติค่ะ ยังไม่มีรายการให้ลบ"],
    tea: ["ตอนนี้ไม่มีรายการที่ลบได้ครับ", "ไม่มีรายการให้ลบครับ ช่างน่าเอ็นดู"],
  },
  [ALREADY_RECORDED_TEXT]: {
    warm: ["เคยจดสลิปนี้ไปแล้วน้า{name} ไม่ได้จดซ้ำ", "สลิปใบนี้จดไว้แล้วครับผม ไม่จดซ้ำนะ"],
    bestie: ["อันนี้จดไว้แล้วว่ะ ไม่จดซ้ำให้", "สลิปนี้เคยจดแล้วดิ{name} เลยไม่จดซ้ำ"],
    spicy: ["จดไปแล้วคุณน้า ส่งมาอีกก็ไม่จดซ้ำ", "สติค่ะ สลิปนี้เคยจดแล้ว ไม่จดซ้ำนะ"],
    tea: [
      "สลิปใบนี้เคยบันทึกไว้แล้วครับ จึงไม่ได้บันทึกซ้ำนะครับ",
      "บันทึกไปแล้วครับ เลยไม่บันทึกซ้ำให้ ส่งซ้ำก็น่าสนใจดีนะครับ",
    ],
  },
  [SLIP_CANCELLED_TEXT]: {
    warm: ["ยกเลิกเรียบร้อยครับผม สลิปนี้ไม่ถูกจดน้า", "ยกเลิกแล้วนะ ไม่เป็นไรเลย ไม่จดสลิปนี้"],
    bestie: ["ยกเลิกให้ละ สลิปนี้ไม่จดนะ", "โอเค ยกเลิกแล้วแก ไม่จดสลิปนี้"],
    spicy: ["ยกเลิกให้ละ ไม่จดสลิปนี้ สติค่ะ", "ยกเลิกแล้ว สติค่ะ สลิปนี้ไม่จด"],
    tea: [
      "ยกเลิกให้แล้วครับ สลิปนี้ไม่ถูกบันทึก",
      "ยกเลิกเรียบร้อยครับ สลิปนี้ไม่จด ตามสะดวกจะส่งใหม่ก็ได้ครับ",
    ],
  },
};

/** "ลบแล้ว: กาแฟ ฿50.00": only the lead changes, the entry and its amount stay. */
const DELETED_LEAD = "ลบแล้ว:";
const DELETED_MORE: More = {
  warm: ["ลบเรียบร้อยครับผม:", "ลบออกให้แล้วน้า:"],
  bestie: ["ลบให้ละ:", "ลบเสร็จแล้วแก:"],
  spicy: ["ลบเรียบ สติค่ะ:", "ลบแล้ว เอาดี ๆ:"],
  tea: ["ลบออกแล้วครับ:", "ลบให้แล้วครับ ตามสะดวก:"],
};
const DELETED: Line = {
  warm: "ลบให้แล้วนะค้าบ:",
  bestie: "ลบแล้วว่ะ:",
  spicy: "ลบแล้ว หายวับ:",
  tea: "ลบเรียบร้อยครับ:",
};

/** "จดสำเร็จ 3 รายการ ✅": the title of the card for several entries; `{n}` is the count. */
const BATCH_TITLE = /^จดสำเร็จ (\d+) รายการ ✅$/;
const BATCH_MORE: More = {
  warm: ["จดไป {n} รายการแล้วน้า คนเก่ง ✅", "บันทึกให้ {n} รายการแล้วนะ ✅"],
  bestie: ["ลงสมุด {n} รายการละ ✅", "จดไป {n} รายการแล้วแก ✅"],
  spicy: ["จด {n} รายการเลย ท่องไว้ว่าจน ✅", "จดแล้ว {n} รายการ สติค่ะ ✅"],
  tea: ["จดไว้ {n} รายการแล้วครับ น่าสนใจดี ✅", "บันทึก {n} รายการให้แล้วครับ ✅"],
};
const BATCH: Line = {
  warm: "จดให้แล้ว {n} รายการนะค้าบ ✅",
  bestie: "จดให้แล้ว {n} อันว่ะ ✅",
  spicy: "จด {n} รายการรวด ขยันจดแล้วก็ขยันประหยัดด้วยนะ ✅",
  tea: "บันทึก {n} รายการเรียบร้อยครับ ✅",
};

/** "สรุปวันนี้ (…)\nยังไม่มีรายการเลย": the heading stays, the last line changes. */
const EMPTY_TAIL = "\nยังไม่มีรายการเลย";
const EMPTY_MORE: More = {
  warm: [
    "ตอนนี้ยังว่างอยู่น้า{name} มาจดอันแรกกันนะค้าบ",
    "ยังไม่มีรายการครับผม{name} สู้ ๆ นะ เริ่มจดทีละอัน",
  ],
  bestie: ["ยังไม่มีอะไรเลยว่ะ{name} ป่ะ เริ่มจดกัน", "ว่างโล่ง จดอันแรกให้เวิร์กหน่อยดิ"],
  spicy: [
    "ไม่มีรายการเลยคุณน้า วันนี้ประหยัดจริงหรือยังไม่ได้จดเนี่ย",
    "ว้าย ว่างโล่งเลย ลองจดอันแรกดูสิ",
  ],
  tea: ["ตอนนี้ยังไม่มีรายการให้แสดงครับ", "ยังไม่มีรายการครับ ตามสะดวกเลยครับ"],
};
const EMPTY: Line = {
  warm: "ยังไม่มีรายการเลยนะ{name} เริ่มจดอันแรกกันน้า",
  bestie: "ยังว่างเปล่าเลยแก จดอันแรกดิ",
  spicy: "ว่างเปล่าเลย ไม่ได้ใช้เงินจริงหรือยังไม่ได้จด เอาดี ๆ",
  tea: "ยังไม่มีรายการครับ",
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
