import { can, type Plan } from "@/lib/plan";
import { currencySymbol } from "@/lib/money";

// ───────────────────────── card colour themes ─────────────────────────

export const THEME_IDS = ["mint", "ocean", "rose", "lavender", "night"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const PERSONA_IDS = ["polite", "friendly", "strict", "cheer"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export const DEFAULT_THEME: ThemeId = "mint";
export const DEFAULT_PERSONA: PersonaId = "polite";

export const isThemeId = (value: unknown): value is ThemeId =>
  typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
export const isPersonaId = (value: unknown): value is PersonaId =>
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
  mint: { label: "เขียวมิ้นต์", palette: BASE_PALETTE },
  ocean: {
    label: "ฟ้าทะเล",
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
    label: "ชมพูพีช",
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
    label: "ม่วงลาเวนเดอร์",
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
    label: "ดำกลางคืน",
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

export const PERSONAS: Record<PersonaId, { label: string; sample: string }> = {
  polite: { label: "สุภาพ", sample: "บันทึกให้เรียบร้อยแล้วค่ะ" },
  friendly: { label: "เพื่อนสนิท", sample: "จดให้แล้วจ้า เดี๋ยวเค้าจำให้เอง" },
  strict: { label: "ดุหน่อย", sample: "เกินงบอีกแล้วนะ! ใจเย็น ๆ ก่อน" },
  cheer: { label: "ชมเยอะ", sample: "เก่งมากเลย จดครบทุกบาท!" },
};

const pickOf = <T>(list: readonly T[], pick: number | undefined): T => {
  const i = Math.min(list.length - 1, Math.floor((pick ?? Math.random()) * list.length));
  return list[Math.max(0, i)] as T;
};

/** A short extra line after recording; null for the polite (default) manner. */
export function savedQuip(
  persona: PersonaId,
  type: "expense" | "income",
  pick?: number,
): string | null {
  const lists: Partial<Record<PersonaId, Record<"expense" | "income", readonly string[]>>> = {
    friendly: {
      expense: [
        "จดให้แล้วจ้า 😎",
        "โอเค เค้าเก็บเข้าสมุดให้แล้วนะ",
        "ได้เลยเพื่อน จดเรียบร้อย!",
        "ติ๊ก! ลงบัญชีแล้ว ไม่หลุดแน่นอน",
        "รับทราบ~ เดี๋ยวเค้าช่วยจำให้เอง",
      ],
      income: [
        "เงินเข้าแล้ว! เลี้ยงข้าวหน่อยนะ 😆",
        "ว้าว รายรับมาแล้ว จดให้เรียบร้อย",
        "ดีใจด้วยเพื่อน เงินเข้ากระเป๋าแล้ว 🎉",
        "จดแล้วจ้า ขอให้มีแบบนี้ทุกวัน",
        "เยี่ยม! ตังค์เข้า จดให้แล้ว",
      ],
    },
    cheer: {
      expense: [
        "เก่งมากเลย จดครบทุกบาท! 👏",
        "ขอบคุณที่จดนะ นี่แหละคนมีวินัย ✨",
        "เยี่ยมไปเลย จดทันทีแบบนี้ดีที่สุด",
        "ภูมิใจในตัวคุณจัง จดต่อเนื่องแบบนี้ต่อไปนะ",
        "สุดยอด! ใส่ใจเงินตัวเองแบบนี้เก่งมาก 🌟",
      ],
      income: [
        "ยินดีด้วยค่ะ! รายรับเข้ามาแล้ว 🎉",
        "เก่งมากเลย ขยันหาเงินแบบนี้สุดยอด ✨",
        "ว้าว เงินเข้า! คุณทำได้ดีมากจริง ๆ 👏",
        "ภูมิใจด้วยนะ รายรับมาแล้ว จดให้เรียบร้อย",
        "เยี่ยม! ความพยายามได้ผลแล้ว 🌟",
      ],
    },
    strict: {
      // The strict manner only scolds when the budget is crossed; saving an expense stays calm.
      expense: [],
      income: [
        "รายรับเข้าแล้ว แต่อย่าเพิ่งรีบใช้นะ เก็บไว้บ้างด้วย!",
        "ได้เงินมาแล้ว จำไว้ว่าออมก่อนใช้ ไม่ใช่ใช้ก่อนออม",
        "จดแล้ว ขอให้เงินก้อนนี้อยู่นานกว่าครั้งก่อนนะ",
      ],
    },
  };
  const list = lists[persona]?.[type];
  return list && list.length > 0 ? pickOf(list, pick) : null;
}

/** The 80% / 100% category or overall budget warning in the chosen manner. */
export function budgetAlertLine(
  persona: PersonaId,
  input: { level: 80 | 100; scope: string; figures: string },
  pick?: number,
): string | null {
  const { level, scope, figures } = input;
  const lists: Partial<Record<PersonaId, Record<80 | 100, readonly string[]>>> = {
    friendly: {
      80: [
        `เฮ้ย งบ${scope}เหลือไม่เยอะแล้วนะ ใช้ไป 80% (${figures})`,
        `เริ่มตึงแล้วนะเพื่อน งบ${scope}ถึง 80% แล้ว (${figures})`,
        `งบ${scope}ใกล้หมดแล้ว ผ่อนหน่อยดีไหม (${figures})`,
      ],
      100: [
        `เอ้า! งบ${scope}หมดแล้วนะ (${figures}) พักก่อนไหม 😅`,
        `งบ${scope}ทะลุแล้วเพื่อน (${figures}) ใจเย็น ๆ น้า`,
        `ตึ้บ! เกินงบ${scope}แล้ว (${figures}) พรุ่งนี้ค่อยมาสู้ใหม่`,
      ],
    },
    strict: {
      80: [
        `งบ${scope}ใช้ไป 80% แล้วนะ (${figures}) เริ่มระวังได้แล้ว!`,
        `อย่าเพิ่งซื้อนะ! งบ${scope}ถึง 80% แล้ว (${figures})`,
        `เตือนครั้งแรก งบ${scope}จะหมดแล้ว (${figures}) คุมหน่อย`,
      ],
      100: [
        `เกินงบ${scope}แล้ว! (${figures}) หยุดใช้ก่อน ไม่ต้องซื้ออะไรเพิ่มแล้ว!`,
        `ไหนบอกจะคุมงบไง! ${scope}เกินแล้ว (${figures}) 😤`,
        `งบ${scope}หมดแล้ว (${figures}) ตั้งสติ แล้วงดซื้อของจุกจิกนะ`,
      ],
    },
    cheer: {
      80: [
        `งบ${scope}ใช้ไป 80% แล้ว (${figures}) ยังเหลืออีกนิด คุณคุมได้แน่ ✨`,
        `เกือบถึงเป้าแล้วนะ งบ${scope} 80% (${figures}) สู้ ๆ`,
        `ยังไหว! งบ${scope}เหลืออีก 20% ค่อย ๆ ใช้นะ 🌟`,
      ],
      100: [
        `งบ${scope}หมดแล้ว (${figures}) ไม่เป็นไรนะ รอบหน้าคุณทำได้ดีกว่าเดิมแน่ 💪`,
        `เกินงบ${scope}ไปนิด (${figures}) แต่คุณจดครบ นั่นก็เก่งแล้ว ✨`,
        `งบ${scope}เต็มแล้ว (${figures}) พรุ่งนี้เริ่มใหม่ด้วยกันนะ 🌈`,
      ],
    },
  };
  const list = lists[persona]?.[level];
  return list ? pickOf(list, pick) : null;
}

export interface DailyVars {
  spent: string;
  limit: string;
  over: string;
}

/** The first-time "over today's limit" lines for a manner; undefined = keep the original playful set. */
export function dailyOverLines(persona: PersonaId): ((v: DailyVars) => string)[] | undefined {
  switch (persona) {
    case "friendly":
      return [
        (v) =>
          `เพื่อนนน วันนี้เกินงบแล้วนะ ใช้ไป ${currencySymbol()}${v.spent} จาก ${currencySymbol()}${v.limit} (เกิน ${currencySymbol()}${v.over}) 😅`,
        (v) => `โอ๊ย กระเป๋าร้องแล้ว วันนี้เกิน ${currencySymbol()}${v.over} พรุ่งนี้ผ่อนหน่อยน้า`,
        (v) =>
          `งบวันนี้ ${currencySymbol()}${v.limit} หมดแล้วนะ เกินมา ${currencySymbol()}${v.over} ไว้พรุ่งนี้ค่อยสู้ใหม่`,
        (v) =>
          `เอ้า เกินงบวันนี้ ${currencySymbol()}${v.over} แล้ว (${currencySymbol()}${v.spent}) เลี้ยงข้าวเค้าชดเชยด้วย 😆`,
      ];
    case "strict":
      return [
        (v) =>
          `เกินงบวันนี้แล้ว! ใช้ไป ${currencySymbol()}${v.spent} จาก ${currencySymbol()}${v.limit} (เกิน ${currencySymbol()}${v.over}) หยุดใช้ได้แล้ว!`,
        (v) => `ไหนบอกจะคุมไง! วันนี้เกินงบ ${currencySymbol()}${v.over} แล้วนะ 😤`,
        (v) =>
          `เตือนแล้วนะ งบวันนี้ ${currencySymbol()}${v.limit} หมด ตอนนี้เกิน ${currencySymbol()}${v.over} งดซื้อของที่เหลือของวันนี้!`,
        (v) =>
          `วันนี้รูดเกินงบ ${currencySymbol()}${v.over} (${currencySymbol()}${v.spent}) พรุ่งนี้ห้ามพลาดอีกนะ!`,
        (v) => `เกินอีกแล้ว ${currencySymbol()}${v.over}! ตั้งสติก่อนจะกดซื้ออะไรต่อ`,
      ];
    case "cheer":
      return [
        (v) =>
          `วันนี้เกินงบไปนิด ${currencySymbol()}${v.over} (${currencySymbol()}${v.spent} จาก ${currencySymbol()}${v.limit}) ไม่เป็นไรนะ พรุ่งนี้ทำได้ดีกว่านี้แน่ ✨`,
        (v) => `ไม่เป็นไรเลย! เกินงบ ${currencySymbol()}${v.over} แต่คุณจดครบทุกบาท เก่งมากแล้ว 👏`,
        (v) =>
          `งบวันนี้ ${currencySymbol()}${v.limit} เต็มแล้ว (เกิน ${currencySymbol()}${v.over}) ขอบคุณที่ดูแลเงินตัวเองนะ พรุ่งนี้เริ่มใหม่ด้วยกัน 🌈`,
        (v) => `เกินมา ${currencySymbol()}${v.over} นิดเดียว คุณรู้ตัวเร็วแล้วนั่นแหละคือเก่ง 🌟`,
      ];
    default:
      return undefined;
  }
}

/** One short line while spending goes on past an already-broken daily limit. */
export function dailyStillOverLine(persona: PersonaId, over: string): string {
  switch (persona) {
    case "friendly":
      return `ยังเกินงบวันนี้อยู่ ${currencySymbol()}${over} นะเพื่อน`;
    case "strict":
      return `ยังเกินอยู่ ${currencySymbol()}${over}! ยังจะใช้ต่ออีกเหรอ!`;
    case "cheer":
      return `ยังเกินงบอยู่ ${currencySymbol()}${over} นิดหน่อย ค่อย ๆ ปรับกันนะ ✨`;
    default:
      return `ยังเกินงบวันนี้อยู่ ${currencySymbol()}${over}`;
  }
}

/**
 * The look and manner that apply to a user right now. They are a paid feature, so a free (or lapsed)
 * plan always gets the defaults while the saved choice is kept for when the plan comes back.
 */
export function effectivePrefs(
  plan: Plan,
  saved: { card_theme?: unknown; bot_persona?: unknown },
): { theme: ThemeId; persona: PersonaId } {
  if (!can(plan, "personalize")) return { theme: DEFAULT_THEME, persona: DEFAULT_PERSONA };
  return {
    theme: isThemeId(saved.card_theme) ? saved.card_theme : DEFAULT_THEME,
    persona: isPersonaId(saved.bot_persona) ? saved.bot_persona : DEFAULT_PERSONA,
  };
}
