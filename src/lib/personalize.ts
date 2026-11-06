import { can, type Plan } from "@/lib/plan";
import { currencySymbol } from "@/lib/money";
import { t } from "@/lib/i18n";

// ───────────────────────── card colour themes ─────────────────────────

export const THEME_IDS = ["mint", "ocean", "rose", "lavender", "night"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** The manners a person can choose between. */
export const PERSONA_IDS = ["warm", "bestie", "spicy", "tea", "night"] as const;
export type ChosenPersona = (typeof PERSONA_IDS)[number];
/** "plain" is no manner at all: what a free or lapsed plan gets. It is never offered as a choice. */
export type PersonaId = ChosenPersona | "plain";
/** The longest name the bot is asked to call someone. */
export const MAX_CALL_NAME = 20;

export const DEFAULT_THEME: ThemeId = "mint";
export const DEFAULT_PERSONA: ChosenPersona = "warm";

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
export const isPersonaId = (value: unknown): value is ChosenPersona =>
  typeof value === "string" && (PERSONA_IDS as readonly string[]).includes(value);

export interface Palette {
  /** Buttons, links and accents. */
  primary: string;
  /** Header band of a card. */
  soft: string;
  /** Title and subtitle on the header band. */
  headTitle: string;
  headSub: string;
  /** Accent-coloured text that sits on the header band. */
  headAccent: string;
  /** Dark green-ish text that sits on a white body. */
  bodyTitle: string;
  bodySub: string;
  bodyDeep: string;
  /** The small bright dot / highlight. */
  accent: string;
}

/** The look every card is built with; other themes swap these exact values. */
export const BASE_PALETTE: Palette = {
  primary: "#0F766E",
  soft: "#CCFBF1",
  headTitle: "#0B5D4F",
  headSub: "#3F6B63",
  headAccent: "#0F766E",
  bodyTitle: "#0B5D4F",
  bodySub: "#3F6B63",
  bodyDeep: "#14352E",
  accent: "#1ABC9C",
};

export const THEMES: Record<ThemeId, { label: string; palette: Palette }> = {
  mint: { label: t("เขียวมิ้นต์"), palette: BASE_PALETTE },
  ocean: {
    label: t("ฟ้าทะเล"),
    palette: {
      primary: "#0369A1",
      soft: "#E0F2FE",
      headTitle: "#0C4A6E",
      headSub: "#3B6A8A",
      headAccent: "#0369A1",
      bodyTitle: "#0C4A6E",
      bodySub: "#3B6A8A",
      bodyDeep: "#0F2A3F",
      accent: "#38BDF8",
    },
  },
  rose: {
    label: t("ชมพูพีช"),
    palette: {
      primary: "#BE185D",
      soft: "#FCE7F3",
      headTitle: "#831843",
      headSub: "#9D4A6E",
      headAccent: "#BE185D",
      bodyTitle: "#831843",
      bodySub: "#9D4A6E",
      bodyDeep: "#4A1230",
      accent: "#F472B6",
    },
  },
  lavender: {
    label: t("ม่วงลาเวนเดอร์"),
    palette: {
      primary: "#6D28D9",
      soft: "#EDE9FE",
      headTitle: "#4C1D95",
      headSub: "#6B5B95",
      headAccent: "#6D28D9",
      bodyTitle: "#4C1D95",
      bodySub: "#6B5B95",
      bodyDeep: "#2E1065",
      accent: "#A78BFA",
    },
  },
  night: {
    label: t("ดำกลางคืน"),
    palette: {
      primary: "#1E293B",
      soft: "#1E293B",
      headTitle: "#F8FAFC",
      headSub: "#CBD5E1",
      headAccent: "#5EEAD4",
      bodyTitle: "#0F172A",
      bodySub: "#475569",
      bodyDeep: "#0F172A",
      accent: "#38BDF8",
    },
  },
};

type Json = unknown;

/**
 * Re-colour LINE messages for a theme. The card builders use one fixed palette; this swaps those exact
 * colours (so every card, present and future, follows the theme) and never touches the income / expense
 * colours or any other. Text on the header band is told apart from text on the white body, so the dark
 * theme stays readable. Returns the messages unchanged for the default theme.
 */
export function applyTheme<T extends { type: string }>(messages: T[], theme: ThemeId): T[] {
  if (theme === DEFAULT_THEME) return messages;
  const to = THEMES[theme].palette;
  const on = (v: string) => v.toUpperCase();
  const base = BASE_PALETTE;

  const walk = (node: Json, onSoft: boolean): Json => {
    if (Array.isArray(node)) return node.map((item) => walk(item, onSoft));
    if (node === null || typeof node !== "object") return node;
    const obj = node as Record<string, Json>;
    const soft =
      onSoft || (typeof obj.backgroundColor === "string" && on(obj.backgroundColor) === base.soft);
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string" && value.startsWith("#")) {
        out[key] = recolor(on(value), soft);
      } else {
        out[key] = walk(value, soft);
      }
    }
    return out;
  };

  const recolor = (hex: string, onSoft: boolean): string => {
    switch (hex) {
      case base.primary:
        return onSoft ? to.headAccent : to.primary;
      case base.soft:
        return to.soft;
      case base.headTitle:
        return onSoft ? to.headTitle : to.bodyTitle;
      case base.headSub:
        return onSoft ? to.headSub : to.bodySub;
      case base.bodyDeep:
        return to.bodyDeep;
      case base.accent:
        return to.accent;
      default:
        return hex;
    }
  };

  return messages.map((m) => walk(m, false) as T);
}

// ───────────────────────── bot persona ─────────────────────────

export const PERSONAS: Record<
  ChosenPersona,
  { label: string; emoji: string; desc: string; sample: string; badge?: string }
> = {
  warm: {
    label: t("ฮูกน้อยอบอุ่น"),
    emoji: "🌸",
    desc: t("พูดจาน่ารัก สุภาพ ให้กำลังใจ ใส่ใจทุกเรื่องของคุณ"),
    sample: t("รับทราบครับ{name} ไม่ต้องห่วงนะ พรุ่งนี้สู้ใหม่ พี่ฮูกคอยซัพพอร์ตเสมอครับ ✨"),
  },
  bestie: {
    label: t("ฮูกเพื่อนซี้"),
    emoji: "🤝",
    desc: t("ฟีลเพื่อนสนิท คุยชิล แซะพอกรุบกริบ แต่พึ่งพาได้"),
    sample: t("เออ จัดไป{name}! จดไว้ให้ละ เผื่อรอบนี้สมองเออเร่อลืมอีก 555"),
  },
  spicy: {
    label: t("ฮูกปากแจ๋ว"),
    emoji: "🌶️",
    desc: t("กวนประสาทขั้นสุด ปั่นเก่ง ขยันเบรก ยิงมุกไม่พัก"),
    sample: t(
      "พรุ่งนี้อีกละนะ{name} พูดงี้มาสามวันติดละ 555 เดี๋ยวพี่ฮูกบินไปจิกถึงเตียงเลยคอยดู!",
    ),
  },
  tea: {
    label: t("นกฮูกจิบชา"),
    emoji: "🫖",
    desc: t("ท่าทีสุขุม ผู้ดีทุกคำ แต่คำพูดแอบเหน็บเบา ๆ ให้สะดุ้ง"),
    sample: t("ได้ครับ{name} นึกว่าจะผลัดเป็นเดือนหน้าซะแล้วนะเนี่ย... บันทึกเรียบร้อยครับ"),
  },
  night: {
    label: t("ฮูกนอนดึก"),
    emoji: "🦉",
    badge: t("พิเศษ"),
    desc: t("ขยันเตือนคนนอนดึก จ้องจับผิดรายจ่ายเก่ง ตาวาวทุกการเคลื่อนไหว"),
    sample: t("ดึกป่านนี้ยังไม่นอนอีกนะ{name}! ตาจะค้างแข่งกับพี่ฮูกเหรอ รีบนอนได้แล้ว!"),
  },
};

/** Puts the name a person asked to be called into a line at its "{name}"; with no name, nothing. */
export function withName(line: string, name?: string | null): string {
  return line.replace("{name}", name ? ` ${name}` : "");
}

const pickOf = <T>(list: readonly T[], pick: number | undefined): T => {
  const i = Math.min(list.length - 1, Math.floor((pick ?? Math.random()) * list.length));
  return list[Math.max(0, i)] as T;
};

type Moods = Partial<Record<PersonaId, Record<"expense" | "income", readonly string[]>>>;

const QUIPS: Moods = {
  warm: {
    expense: [
      "เก่งมากเลย จดครบทุกบาท! 👏",
      "ขอบคุณที่จดนะ{name} นี่แหละคนมีวินัย ✨",
      "เยี่ยมไปเลย จดทันทีแบบนี้ดีที่สุด",
      "ภูมิใจในตัวคุณ{name}จัง จดต่อเนื่องแบบนี้ต่อไปนะ",
      "สุดยอด! ใส่ใจเงินตัวเองแบบนี้เก่งมาก 🌟",
    ],
    income: [
      "ยินดีด้วยนะ{name}! รายรับเข้ามาแล้ว 🎉",
      "เก่งมากเลย ขยันหาเงินแบบนี้สุดยอด ✨",
      "ว้าว เงินเข้า! คุณทำได้ดีมากจริง ๆ 👏",
      "ภูมิใจด้วยนะ{name} รายรับมาแล้ว จดให้เรียบร้อย",
      "เยี่ยม! ความพยายามได้ผลแล้ว 🌟",
    ],
  },
  bestie: {
    expense: [
      "จดให้แล้วจ้า{name} 😎",
      "โอเค เค้าเก็บเข้าสมุดให้แล้วนะ",
      "ได้เลย{name} จดเรียบร้อย!",
      "ติ๊ก! ลงบัญชีแล้ว ไม่หลุดแน่นอน",
      "รับทราบ~ เดี๋ยวเค้าช่วยจำให้เอง",
    ],
    income: [
      "เงินเข้าแล้ว{name}! เลี้ยงข้าวหน่อยนะ 😆",
      "ว้าว รายรับมาแล้ว จดให้เรียบร้อย",
      "ดีใจด้วย{name} เงินเข้ากระเป๋าแล้ว 🎉",
      "จดแล้วจ้า ขอให้มีแบบนี้ทุกวัน",
      "เยี่ยม! ตังค์เข้า จดให้แล้ว",
    ],
  },
  spicy: {
    expense: [
      "จดแล้วนะ{name} ใช้เงินเก่งจริงนะเรา 😏",
      "บันทึกละ ไม่ต้องทำหน้าไม่รู้ไม่ชี้",
      "ติ๊ก! อีกรายการ กระเป๋าร้องไห้หรือยัง 🌶️",
      "จดให้ละ รอบหน้าคิดก่อนรูดนะ{name}",
    ],
    income: [
      "เงินเข้า! อย่าเพิ่งรีบเอาไปเผานะ{name} 🌶️",
      "จดแล้ว ขอให้เงินอยู่กับเรานานกว่ารอบก่อนนะ",
      "รายรับมาแล้ว เก็บไว้บ้างล่ะ อย่าให้พี่ฮูกต้องบ่น",
    ],
  },
  tea: {
    expense: [
      "ได้ครับ{name} บันทึกเรียบร้อย... ส่วนความคุ้มค่า ไว้ให้คุณพิจารณาเองนะครับ 🫖",
      "จดแล้วครับ{name} ขอบคุณที่ยังจดให้ครบนะครับ",
      "เรียบร้อยครับ รายการนี้... น่าสนใจดีทีเดียว",
    ],
    income: [
      "ยินดีด้วยครับ{name} รายรับเข้ามาแล้ว หวังว่าจะอยู่นานกว่าครั้งก่อนนะครับ 🫖",
      "บันทึกแล้วครับ วันนี้กระเป๋าดูสดใสดีนะครับ",
    ],
  },
  night: {
    expense: [
      "จดแล้ว{name} ดึกแล้วนะ รีบนอนได้แล้ว 🦉",
      "ตาวาวจับได้แล้วรายการนี้ จดให้ละนะ{name}",
      "จดแล้ว อย่าใช้เงินตอนง่วงนะ{name} 🌙",
    ],
    income: [
      "เงินเข้า! ดีใจนะ{name} แต่นอนก่อนค่อยนับต่อ 🦉",
      "จดแล้ว ฝันดีนะ{name} ตื่นมาเงินยังอยู่ 🌙",
    ],
  },
};

/** A short extra line after recording; null for no manner at all. */
export function savedQuip(
  persona: PersonaId,
  type: "expense" | "income",
  pick?: number,
  name?: string | null,
): string | null {
  const list = QUIPS[persona]?.[type];
  return list && list.length > 0 ? withName(pickOf(list, pick), name) : null;
}

const ALERTS: Partial<Record<PersonaId, Record<80 | 100, readonly string[]>>> = {
  warm: {
    80: [
      "งบ{scope}ใช้ไป 80% แล้ว ({figures}) ยังเหลืออีกนิด คุณคุมได้แน่{name} ✨",
      "เกือบถึงเป้าแล้วนะ งบ{scope} 80% ({figures}) สู้ ๆ",
      "ยังไหว! งบ{scope}เหลืออีก 20% ค่อย ๆ ใช้นะ{name} 🌟",
    ],
    100: [
      "งบ{scope}หมดแล้ว ({figures}) ไม่เป็นไรนะ{name} รอบหน้าคุณทำได้ดีกว่าเดิมแน่ 💪",
      "เกินงบ{scope}ไปนิด ({figures}) แต่คุณจดครบ นั่นก็เก่งแล้ว ✨",
      "งบ{scope}เต็มแล้ว ({figures}) พรุ่งนี้เริ่มใหม่ด้วยกันนะ 🌈",
    ],
  },
  bestie: {
    80: [
      "เฮ้ย{name} งบ{scope}เหลือไม่เยอะแล้วนะ ใช้ไป 80% ({figures})",
      "เริ่มตึงแล้วนะ{name} งบ{scope}ถึง 80% แล้ว ({figures})",
      "งบ{scope}ใกล้หมดแล้ว ผ่อนหน่อยดีไหม ({figures})",
    ],
    100: [
      "เอ้า!{name} งบ{scope}หมดแล้วนะ ({figures}) พักก่อนไหม 😅",
      "งบ{scope}ทะลุแล้ว ({figures}) ใจเย็น ๆ น้า",
      "ตึ้บ! เกินงบ{scope}แล้ว ({figures}) พรุ่งนี้ค่อยมาสู้ใหม่",
    ],
  },
  spicy: {
    80: [
      "งบ{scope}ใช้ไป 80% แล้วนะ{name} ({figures}) เริ่มระวังได้แล้ว!",
      "อย่าเพิ่งซื้อนะ! งบ{scope}ถึง 80% แล้ว ({figures})",
      "เตือนครั้งแรก งบ{scope}จะหมดแล้ว ({figures}) คุมหน่อย",
    ],
    100: [
      "เกินงบ{scope}แล้ว! ({figures}) หยุดใช้ก่อน ไม่ต้องซื้ออะไรเพิ่มแล้ว!",
      "ไหนบอกจะคุมงบไง!{name} {scope}เกินแล้ว ({figures}) 😤",
      "งบ{scope}หมดแล้ว ({figures}) ตั้งสติ แล้วงดซื้อของจุกจิกนะ",
    ],
  },
  tea: {
    80: [
      "งบ{scope}ใช้ไป 80% แล้วนะครับ{name} ({figures}) ไม่ได้ว่าอะไรหรอกครับ แค่ชวนสังเกต 🫖",
      "เรียนให้ทราบครับ งบ{scope}ถึง 80% ({figures}) ช่วงนี้ใจป้ำจังนะครับ",
    ],
    100: [
      "งบ{scope}หมดแล้วครับ{name} ({figures}) ไม่เป็นไรครับ ใคร ๆ ก็พลาดได้... บ่อยหน่อยก็เท่านั้น 🫖",
      "เกินงบ{scope}แล้วครับ ({figures}) พี่ฮูกแค่จดตามจริงนะครับ ไม่ได้เหน็บ",
    ],
  },
  night: {
    80: [
      "ตาวาว! งบ{scope}ใช้ไป 80% แล้ว ({figures}){name} 🦉",
      "งบ{scope}ใกล้หมดแล้ว ({figures}) พี่ฮูกเห็นนะว่าใช้อะไรไปบ้าง",
    ],
    100: [
      "เกินงบ{scope}แล้ว ({figures}){name} ดึกแล้ว เลิกช้อปแล้วไปนอนเถอะ 🌙",
      "งบ{scope}หมดแล้ว ({figures}) จับได้คาตาเลย ปิดแอปแล้วนอนนะ 🦉",
    ],
  },
};

/** The 80% / 100% category or overall budget warning in the chosen manner. */
export function budgetAlertLine(
  persona: PersonaId,
  input: { level: 80 | 100; scope: string; figures: string },
  pick?: number,
  name?: string | null,
): string | null {
  const list = ALERTS[persona]?.[input.level];
  if (!list) return null;
  return withName(pickOf(list, pick), name)
    .replaceAll("{scope}", input.scope)
    .replaceAll("{figures}", input.figures);
}

export interface DailyVars {
  spent: string;
  limit: string;
  over: string;
  /** The name the person asked to be called, when there is one. */
  name?: string | null;
}

/** The first-time "over today's limit" lines for a manner; undefined = keep the original playful set. */
export function dailyOverLines(persona: PersonaId): ((v: DailyVars) => string)[] | undefined {
  const c = () => currencySymbol();
  const n = (v: DailyVars, line: string) => withName(line, v.name);
  switch (persona) {
    case "bestie":
      return [
        (v) =>
          n(
            v,
            `เพื่อนนน{name} วันนี้เกินงบแล้วนะ ใช้ไป ${c()}${v.spent} จาก ${c()}${v.limit} (เกิน ${c()}${v.over}) 😅`,
          ),
        (v) => n(v, `โอ๊ย กระเป๋าร้องแล้ว วันนี้เกิน ${c()}${v.over} พรุ่งนี้ผ่อนหน่อยน้า{name}`),
        (v) =>
          n(v, `งบวันนี้ ${c()}${v.limit} หมดแล้วนะ เกินมา ${c()}${v.over} ไว้พรุ่งนี้ค่อยสู้ใหม่`),
        (v) =>
          n(
            v,
            `เอ้า เกินงบวันนี้ ${c()}${v.over} แล้ว (${c()}${v.spent}) เลี้ยงข้าวเค้าชดเชยด้วย 😆`,
          ),
      ];
    case "spicy":
      return [
        (v) =>
          n(
            v,
            `เกินงบวันนี้แล้ว!{name} ใช้ไป ${c()}${v.spent} จาก ${c()}${v.limit} (เกิน ${c()}${v.over}) หยุดใช้ได้แล้ว!`,
          ),
        (v) => n(v, `ไหนบอกจะคุมไง!{name} วันนี้เกินงบ ${c()}${v.over} แล้วนะ 😤`),
        (v) =>
          n(
            v,
            `เตือนแล้วนะ งบวันนี้ ${c()}${v.limit} หมด ตอนนี้เกิน ${c()}${v.over} งดซื้อของที่เหลือของวันนี้!`,
          ),
        (v) => n(v, `วันนี้รูดเกินงบ ${c()}${v.over} (${c()}${v.spent}) พรุ่งนี้ห้ามพลาดอีกนะ!`),
        (v) => n(v, `เกินอีกแล้ว ${c()}${v.over}!{name} ตั้งสติก่อนจะกดซื้ออะไรต่อ`),
      ];
    case "warm":
      return [
        (v) =>
          n(
            v,
            `วันนี้เกินงบไปนิด ${c()}${v.over} (${c()}${v.spent} จาก ${c()}${v.limit}) ไม่เป็นไรนะ{name} พรุ่งนี้ทำได้ดีกว่านี้แน่ ✨`,
          ),
        (v) => n(v, `ไม่เป็นไรเลย! เกินงบ ${c()}${v.over} แต่คุณจดครบทุกบาท เก่งมากแล้ว 👏`),
        (v) =>
          n(
            v,
            `งบวันนี้ ${c()}${v.limit} เต็มแล้ว (เกิน ${c()}${v.over}) ขอบคุณที่ดูแลเงินตัวเองนะ{name} พรุ่งนี้เริ่มใหม่ด้วยกัน 🌈`,
          ),
        (v) => n(v, `เกินมา ${c()}${v.over} นิดเดียว คุณรู้ตัวเร็วแล้วนั่นแหละคือเก่ง 🌟`),
      ];
    case "tea":
      return [
        (v) =>
          n(
            v,
            `งบวันนี้ ${c()}${v.limit} ใช้ไป ${c()}${v.spent} แล้วนะครับ{name} เกินมา ${c()}${v.over} ...ไม่ได้ว่าอะไรครับ 🫖`,
          ),
        (v) =>
          n(v, `เรียนให้ทราบครับ วันนี้เกินงบ ${c()}${v.over} ช่างน่าประทับใจในความมั่นใจนะครับ`),
        (v) =>
          n(
            v,
            `เกินงบไป ${c()}${v.over} แล้วครับ{name} พรุ่งนี้ค่อยพิจารณาใหม่ก็ได้ครับ ...หวังว่านะครับ`,
          ),
      ];
    case "night":
      return [
        (v) =>
          n(v, `วันนี้เกินงบ ${c()}${v.over} แล้ว!{name} ดึกแล้วด้วย เลิกช้อปแล้วไปนอนเถอะ 🌙`),
        (v) =>
          n(
            v,
            `ตาวาว! ใช้ไป ${c()}${v.spent} จาก ${c()}${v.limit} เกินมา ${c()}${v.over} พี่ฮูกจับได้แล้วนะ{name} 🦉`,
          ),
        (v) => n(v, `งบวันนี้หมดแล้ว (เกิน ${c()}${v.over}) ปิดแอปแล้วนอนก่อน พรุ่งนี้ค่อยว่ากัน`),
      ];
    default:
      return undefined;
  }
}

/** One short line while spending goes on past an already-broken daily limit. */
export function dailyStillOverLine(persona: PersonaId, over: string, name?: string | null): string {
  const o = `${currencySymbol()}${over}`;
  switch (persona) {
    case "bestie":
      return withName(`ยังเกินงบวันนี้อยู่ ${o} นะเพื่อน{name}`, name);
    case "spicy":
      return withName(`ยังเกินอยู่ ${o}!{name} ยังจะใช้ต่ออีกเหรอ!`, name);
    case "warm":
      return withName(`ยังเกินงบอยู่ ${o} นิดหน่อย ค่อย ๆ ปรับกันนะ{name} ✨`, name);
    case "tea":
      return withName(`ยังเกินอยู่ ${o} นะครับ{name} ไม่ได้ว่าอะไรครับ แค่แจ้งให้ทราบ 🫖`, name);
    case "night":
      return withName(`ยังเกินอยู่ ${o}{name} ตายังไม่ง่วงเหรอ ไปนอนได้แล้ว 🌙`, name);
    default:
      return `ยังเกินงบวันนี้อยู่ ${o}`;
  }
}

/**
 * The look and manner that apply to a user right now. They are a paid feature, so a free (or lapsed)
 * plan always gets the defaults while the saved choice is kept for when the plan comes back.
 */
export function effectivePrefs(
  plan: Plan,
  saved: { card_theme?: unknown; bot_persona?: unknown; call_name?: unknown },
): { theme: ThemeId; persona: PersonaId; name: string | null } {
  if (!can(plan, "personalize")) return { theme: DEFAULT_THEME, persona: "plain", name: null };
  return {
    theme: isThemeId(saved.card_theme) ? saved.card_theme : DEFAULT_THEME,
    // a row with no manner saved (or one we do not know) gets none, like before
    persona: isPersonaId(saved.bot_persona) ? saved.bot_persona : "plain",
    name: cleanCallName(saved.call_name),
  };
}

/** The name to call someone by: one line, trimmed, not longer than MAX_CALL_NAME; else null. */
export function cleanCallName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\s\u0000-\u001f{}<>]+/g, " ").trim();
  return name.length >= 1 && [...name].length <= MAX_CALL_NAME ? name : null;
}
