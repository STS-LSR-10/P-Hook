import { can, type Plan } from "@/lib/plan";
import { currencySymbol } from "@/lib/money";
import { t } from "@/lib/i18n";

// ───────────────────────── card colour themes ─────────────────────────

export const THEME_IDS = ["mint", "ocean", "rose", "lavender", "night"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** The manners a person can choose between. */
export const PERSONA_IDS = ["warm", "bestie", "spicy", "tea"] as const;
export type ChosenPersona = (typeof PERSONA_IDS)[number];
/** "plain" is no manner at all: what a free or lapsed plan gets. It is never offered as a choice. */
export type PersonaId = ChosenPersona | "plain";
/** The longest name the bot is asked to call someone. */
export const MAX_CALL_NAME = 20;

export const DEFAULT_THEME: ThemeId = "mint";
export const DEFAULT_PERSONA: ChosenPersona = "warm";

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
/** A manner that was removed keeps working for anyone who still has it saved: night owl became bestie. */
const RETIRED_PERSONA: Record<string, ChosenPersona> = { night: "bestie" };
export const currentPersona = (value: unknown): unknown =>
  typeof value === "string" && Object.hasOwn(RETIRED_PERSONA, value)
    ? RETIRED_PERSONA[value]
    : value;
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
    desc: t("เซฟโซน ปลอบโยน นุ่มนวล ใจดี คอยให้กำลังใจเสมอ ไม่ดุ ไม่ตัดสิน"),
    sample: t("ไม่เป็นไรนะค้าบ{name} พลาดได้น้า พรุ่งนี้สู้ ๆ นะ คนเก่ง พี่ฮูกอยู่ตรงนี้เสมอ ✨"),
  },
  bestie: {
    label: t("ฮูกเพื่อนซี้"),
    emoji: "🤝",
    desc: t(
      "เพื่อนสนิทสายลุย ๆ จริงใจ คุยเหมือนพิมพ์แชต LINE ตรงไปตรงมา ช่วยกันแบบเพื่อนช่วยเพื่อน",
    ),
    sample: t(
      'เอาจริงนะแก{name} จดไว้ให้ละ อยากดูว่าเดือนนี้เวิร์กมั้ย พิมพ์ "สรุปเดือนนี้" ได้เลย',
    ),
  },
  spicy: {
    label: t("ฮูกปากแจ๋ว"),
    emoji: "🌶️",
    desc: t("ตัวแม่สายฟาด ปากจัดแต่จริงใจ ขยันเตือนสติแบบฮา ๆ หวังดีเสมอ"),
    sample: t("พักก่อนค่ะ{name} สติค่ะ! อย่าหาทำรูดอีกนะคุณน้า ท่องไว้ว่าจน เดี๋ยวพี่ฮูกจดให้ก่อน"),
  },
  tea: {
    label: t("นกฮูกจิบชา"),
    emoji: "🫖",
    desc: t("ผู้ดีจิบชา นิ่ง สงบ เรียบหรู มีชั้นเชิงในการแซะแบบเชือดนิ่ม ๆ ไม่ใช้สแลง"),
    sample: t("น่าสนใจดีครับ{name} ก็แล้วแต่จะพิจารณานะครับ บันทึกเรียบร้อยแล้ว ตามสะดวกเลยครับ"),
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
      "จดครบทุกบาทเลย เก่งมากนะค้าบ 👏",
      "ขอบคุณที่จดนะ{name} มีวินัยสุด ๆ เลยน้า ✨",
      "จดทันทีแบบนี้ดีที่สุดเลย สู้ ๆ นะ คนเก่ง",
      "ภูมิใจในตัวคุณ{name}จัง จดต่อเนื่องแบบนี้ต่อไปนะค้าบ",
      "ใส่ใจเงินตัวเองแบบนี้ คนเก่งเลย 🌟",
    ],
    income: [
      "ยินดีด้วยนะ{name}! รายรับเข้ามาแล้ว 🎉",
      "ขยันหาเงินแบบนี้ คนเก่งของพี่ฮูกเลย ✨",
      "เงินเข้า! ดีใจด้วยนะค้าบ คุณทำได้ดีจริง ๆ 👏",
      "ภูมิใจจังนะ{name} รายรับมาแล้ว จดให้เรียบร้อยครับผม",
      "ความพยายามได้ผลแล้วน้า เยี่ยมไปเลย 🌟",
    ],
  },
  bestie: {
    expense: [
      "จดให้แล้วว่ะ{name} เนียน ๆ เลย ✌️",
      "ลงสมุดละ ไม่หลุดแน่นอน เดี๋ยวช่วยจำให้เอง",
      "โอเค{name} จดเรียบร้อย เวิร์กเลยป่ะ",
      'ติ๊ก! อีกรายการ อยากดูว่าเดือนนี้เป็นไง พิมพ์ "สรุปเดือนนี้" ได้เลย',
      "เอาจริงนะแก จดทันทีแบบนี้แหละโคตรดี",
    ],
    income: [
      "เงินเข้าแล้ว{name}! เลี้ยงข้าวป่ะ 555",
      "โคตรดี รายรับมาแล้ว จดให้เรียบร้อย",
      "ดีใจด้วยนะแก{name} เงินเข้ากระเป๋าแล้ว 🎉",
      "ติ๊ง! เงินเข้า ขอให้มีแบบนี้ทุกวันดิ",
      "เวิร์กมาก ตังค์เข้า จดให้ละ",
    ],
  },
  spicy: {
    expense: [
      "จดอีกแล้วนะ{name} กระเป๋าแหกแล้วมั้ง 🌶️",
      "บันทึกแล้ว พักก่อนค่ะ รูดเก่งจังนะคุณน้า 😏",
      "อีกรายการละ ท่องไว้ว่าจนนะ{name}",
      "จดให้ละ เอาดี ๆ คิดก่อนรูดทีหน้านะ",
      "ว้าย อีกแล้วเหรอ สติค่ะ{name} อย่าหาทำเพิ่ม",
    ],
    income: [
      "เงินเข้า! อย่าเพิ่งรีบเอาไปเผานะ{name} 🌶️",
      "จดแล้ว ท่องไว้ว่าจน ขอให้เงินอยู่กับเรานานกว่ารอบก่อน",
      "รายรับมาแล้ว สติค่ะ เก็บไว้บ้าง อย่าให้พี่ฮูกต้องบ่น",
    ],
  },
  tea: {
    expense: [
      "บันทึกเรียบร้อยครับ{name} ส่วนความคุ้มค่า ก็แล้วแต่จะพิจารณานะครับ 🫖",
      "จดแล้วครับ{name} น่าสนใจดีนะครับ รายการนี้",
      "เรียบร้อยครับ ช่างน่าเอ็นดูจริง ๆ ตามสะดวกเลยครับ",
    ],
    income: [
      "ยินดีด้วยครับ{name} รายรับเข้ามาแล้ว หวังว่าจะอยู่นานกว่าครั้งก่อนนะครับ 🫖",
      "บันทึกแล้วครับ วันนี้กระเป๋าดูสดใสดีนะครับ",
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
      "งบ{scope}ใช้ไป 80% แล้วนะค้าบ ({figures}) ยังเหลืออีกนิด คุณคุมได้แน่{name} ✨",
      "เกือบถึงเป้าแล้วน้า งบ{scope} 80% ({figures}) สู้ ๆ นะ คนเก่ง",
      "ยังไหวนะ! งบ{scope}เหลืออีก 20% ค่อย ๆ ใช้น้า{name} 🌟",
    ],
    100: [
      "งบ{scope}หมดแล้วนะ ({figures}) ไม่เป็นไรเลย{name} รอบหน้าคุณทำได้ดีกว่านี้แน่ 💪",
      "เกินงบ{scope}ไปนิดนึง ({figures}) แต่คุณจดครบ เก่งแล้วน้า ✨",
      "งบ{scope}เต็มแล้ว ({figures}) พรุ่งนี้เริ่มใหม่ด้วยกันนะค้าบ 🌈",
    ],
  },
  bestie: {
    80: [
      "เฮ้ย{name} งบ{scope}เหลือไม่เยอะแล้วนะ ใช้ไป 80% ({figures})",
      "เริ่มตึงละนะ{name} งบ{scope}ถึง 80% แล้ว ({figures})",
      "งบ{scope}ใกล้หมดละว่ะ ผ่อนหน่อยดีป่ะ ({figures})",
    ],
    100: [
      "เอ้า!{name} งบ{scope}หมดแล้วว่ะ ({figures}) พักก่อนป่ะ 😅",
      "งบ{scope}ทะลุแล้วแก ({figures}) ใจเย็น ๆ ดิ",
      "ตึ้บ! เกินงบ{scope}แล้ว ({figures}) พรุ่งนี้ค่อยมาสู้ใหม่",
    ],
  },
  spicy: {
    80: [
      "งบ{scope}ใช้ไป 80% แล้วนะ{name} ({figures}) พักก่อนค่ะ เริ่มระวังได้แล้ว!",
      "อย่าหาทำ! งบ{scope}ถึง 80% แล้ว ({figures}) สติค่ะ",
      "เตือนแล้วนะคุณน้า งบ{scope}จะหมดแล้ว ({figures}) เอาดี ๆ คุมหน่อย",
    ],
    100: [
      "เกินงบ{scope}แล้ว! ({figures}) ว้าย ท่องไว้ว่าจน หยุดก่อนค่ะ 😤",
      "ไหนบอกจะคุมไง{name} {scope}เกินแล้ว ({figures}) เอาดี ๆ นะ 😤",
      "งบ{scope}หมดแล้ว ({figures}) สติค่ะ งดซื้อของจุกจิกด้วยนะคุณน้า",
    ],
  },
  tea: {
    80: [
      "งบ{scope}ใช้ไป 80% แล้วนะครับ{name} ({figures}) ไม่ได้ว่าอะไรครับ แค่ชวนสังเกต 🫖",
      "เรียนให้ทราบครับ งบ{scope}ถึง 80% ({figures}) ช่วงนี้ใจป้ำจังนะครับ น่าสนใจดี",
    ],
    100: [
      "งบ{scope}หมดแล้วครับ{name} ({figures}) ไม่เป็นไรครับ ใคร ๆ ก็พลาดได้... บ่อยหน่อยก็เท่านั้น 🫖",
      "เกินงบ{scope}แล้วครับ ({figures}) พี่ฮูกแค่จดตามจริงนะครับ ก็แล้วแต่จะพิจารณา",
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
            `เฮ้ย{name} วันนี้เกินงบแล้วนะ ใช้ไป ${c()}${v.spent} จาก ${c()}${v.limit} (เกิน ${c()}${v.over}) 😅`,
          ),
        (v) => n(v, `โอ๊ย กระเป๋าร้องละว่ะ วันนี้เกิน ${c()}${v.over} พรุ่งนี้ผ่อนหน่อยดิ{name}`),
        (v) =>
          n(
            v,
            `งบวันนี้ ${c()}${v.limit} หมดแล้วแก เกินมา ${c()}${v.over} ไว้พรุ่งนี้ค่อยสู้ใหม่ป่ะ`,
          ),
        (v) =>
          n(
            v,
            `เอ้า เกินงบวันนี้ ${c()}${v.over} แล้ว (${c()}${v.spent}) เอาจริงเลี้ยงข้าวชดเชยด้วยดิ 😆`,
          ),
      ];
    case "spicy":
      return [
        (v) =>
          n(
            v,
            `เกินงบวันนี้แล้ว!{name} ใช้ไป ${c()}${v.spent} จาก ${c()}${v.limit} (เกิน ${c()}${v.over}) พักก่อนค่ะ!`,
          ),
        (v) => n(v, `ไหนบอกจะคุมไง!{name} วันนี้เกินงบ ${c()}${v.over} แล้วนะ สติค่ะ 😤`),
        (v) =>
          n(
            v,
            `เตือนแล้วนะคุณน้า งบวันนี้ ${c()}${v.limit} หมด ตอนนี้เกิน ${c()}${v.over} อย่าหาทำซื้อต่อเลย!`,
          ),
        (v) => n(v, `ว้าย วันนี้รูดเกินงบ ${c()}${v.over} (${c()}${v.spent}) ท่องไว้ว่าจนนะ{name}`),
        (v) => n(v, `เกินอีกแล้ว ${c()}${v.over}!{name} เอาดี ๆ ตั้งสติก่อนจะกดซื้ออะไรต่อ`),
      ];
    case "warm":
      return [
        (v) =>
          n(
            v,
            `วันนี้เกินงบไปนิดนึง ${c()}${v.over} (${c()}${v.spent} จาก ${c()}${v.limit}) ไม่เป็นไรนะค้าบ{name} พรุ่งนี้ทำได้ดีกว่านี้แน่ ✨`,
          ),
        (v) => n(v, `ไม่เป็นไรเลยน้า! เกินงบ ${c()}${v.over} แต่คุณจดครบทุกบาท เก่งมากแล้ว 👏`),
        (v) =>
          n(
            v,
            `งบวันนี้ ${c()}${v.limit} เต็มแล้ว (เกิน ${c()}${v.over}) ขอบคุณที่ดูแลเงินตัวเองนะ{name} พรุ่งนี้เริ่มใหม่ด้วยกันนะค้าบ 🌈`,
          ),
        (v) => n(v, `เกินมา ${c()}${v.over} นิดเดียวเอง รู้ตัวเร็วแบบนี้คือเก่งแล้วนะ คนเก่ง 🌟`),
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
            `เกินงบไป ${c()}${v.over} แล้วครับ{name} พรุ่งนี้ค่อยพิจารณาใหม่ก็ได้ครับ ตามสะดวกเลยครับ`,
          ),
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
      return withName(`ยังเกินงบวันนี้อยู่ ${o} นะแก{name}`, name);
    case "spicy":
      return withName(`ยังเกินอยู่ ${o}!{name} ว้าย ยังจะใช้ต่ออีกเหรอ อย่าหาทำ!`, name);
    case "warm":
      return withName(`ยังเกินงบอยู่ ${o} นิดหน่อยน้า ค่อย ๆ ปรับกันนะค้าบ{name} ✨`, name);
    case "tea":
      return withName(`ยังเกินอยู่ ${o} นะครับ{name} ไม่ได้ว่าอะไรครับ แค่แจ้งให้ทราบ 🫖`, name);
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
    persona: isPersonaId(currentPersona(saved.bot_persona))
      ? (currentPersona(saved.bot_persona) as ChosenPersona)
      : "plain",
    name: cleanCallName(saved.call_name),
  };
}

/** The name to call someone by: one line, trimmed, not longer than MAX_CALL_NAME; else null. */
export function cleanCallName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\s\u0000-\u001f{}<>]+/g, " ").trim();
  return name.length >= 1 && [...name].length <= MAX_CALL_NAME ? name : null;
}
