import type { PersonaId } from "@/lib/personalize";
import { planAtLeast, type Plan } from "@/lib/plan";
import type { LineMessage } from "@/lib/types";
import { compactHeader, outlinePill } from "./card-style";
import { COLOR } from "./flex";
import { t as tr } from "@/lib/i18n";

/** The lowest plan that has a thing (Elite includes everything Pro has). */
type Need = Plan;

export interface HelpItem {
  /** An emoji for the round icon at the left of the row. */
  icon: string;
  /** What to type, e.g. "สรุปวันนี้" or "กาแฟ 30". */
  cmd: string;
  /** One short line: what it does. */
  desc: string;
  need: Need;
  /**
   * Tapping the row sends this text as if the person typed it. Only read-only commands get one: an
   * example that records or deletes something is never a button, so nobody saves or loses an entry by
   * trying the help.
   */
  send?: string;
}

export type HelpTopicId =
  | "record"
  | "special"
  | "summary"
  | "search"
  | "wallet"
  | "budget"
  | "debt"
  | "remind"
  | "other"
  | "shortcuts";

export interface HelpTopic {
  id: HelpTopicId;
  /** The chip under the question (20 characters at most). */
  chip: string;
  icon: string;
  title: string;
  subtitle: string;
  /** A short closing line at the foot of the card. */
  tagline: string;
  /** At most 6: more does not fit a phone screen. */
  items: HelpItem[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "record",
    chip: tr("📝 จดรายการ"),
    icon: "📝",
    title: tr("จดรายการ"),
    subtitle: tr("พิมพ์ชื่อรายการ แล้วตามด้วยจำนวนเงิน"),
    tagline: tr("พิมพ์สั้น ๆ ก็จดเสร็จแล้ว"),
    items: [
      { icon: "☕", cmd: "กาแฟ 30", desc: tr("จดรายจ่าย"), need: "free" },
      { icon: "💰", cmd: "เงินเดือน 25000", desc: tr("จดรายรับ"), need: "free" },
      { icon: "➕", cmd: "+500 ขายของ", desc: tr("+ รายรับ · − รายจ่าย"), need: "free" },
      {
        icon: "📅",
        cmd: "เมื่อวาน กาแฟ 45",
        desc: tr("จดย้อนหลัง"),
        need: "starter",
      },
      {
        icon: "🧾",
        cmd: "ข้าว 50, กาแฟ 45",
        desc: tr("หลายรายการในครั้งเดียว"),
        need: "starter",
      },
      {
        icon: "🏷️",
        cmd: "หมูกระทะ 500 #ปาร์ตี้",
        desc: tr("ติดแท็กไว้ค้นหา"),
        need: "starter",
      },
    ],
  },
  {
    id: "special",
    chip: tr("📷 จดแบบพิเศษ"),
    icon: "📷",
    title: tr("จดแบบพิเศษ"),
    subtitle: tr("ส่งรูป ส่งเสียง หรือเงินต่างประเทศ"),
    tagline: tr("ไม่ต้องพิมพ์เองก็จดได้"),
    items: [
      { icon: "📷", cmd: "ส่งรูปสลิป", desc: tr("บอทอ่านยอดให้"), need: "free" },
      {
        icon: "🎤",
        cmd: "ส่งข้อความเสียง",
        desc: tr("พูดแล้วบอทจดให้"),
        need: "starter",
      },
      { icon: "👛", cmd: "กาแฟ 45 @KTC", desc: tr("จดลงกระเป๋าที่เลือก"), need: "starter" },
      {
        icon: "💴",
        cmd: "ราเมน 1500 JPY",
        desc: tr("แปลงสกุลเงินให้"),
        need: "starter",
      },
      {
        icon: "✨",
        cmd: "พิมพ์เป็นประโยคยาว ๆ",
        desc: tr("AI ช่วยอ่าน แล้วถามก่อนจด"),
        need: "ultimate",
      },
    ],
  },
  {
    id: "summary",
    chip: tr("📊 สรุป"),
    icon: "📊",
    title: tr("สรุป"),
    subtitle: tr("แตะที่แถวเพื่อดูได้เลย"),
    tagline: tr("รู้ทันทีว่าเงินไปไหนบ้าง"),
    items: [
      {
        icon: "☀️",
        cmd: "สรุปวันนี้",
        desc: tr("รายรับรายจ่ายวันนี้"),
        need: "free",
        send: "สรุปวันนี้",
      },
      {
        icon: "🗓️",
        cmd: "สรุปเดือนนี้",
        desc: tr("ตามรอบงบ เทียบเดือนก่อน"),
        need: "free",
        send: "สรุปเดือนนี้",
      },
      {
        icon: "🥧",
        cmd: "สรุปหมวด",
        desc: tr("รายจ่ายแยกตามหมวด"),
        need: "free",
        send: "สรุปหมวด",
      },
      { icon: "🕘", cmd: "ล่าสุด", desc: tr("5 รายการล่าสุด"), need: "free", send: "ล่าสุด" },
      { icon: "📆", cmd: "สรุปปี", desc: tr("ภาพรวมทั้งปี"), need: "starter", send: "สรุปปี" },
      {
        icon: "⚖️",
        cmd: "เทียบเดือน",
        desc: tr("เทียบรายหมวดกับเดือนก่อน"),
        need: "plus",
        send: "เทียบเดือน",
      },
    ],
  },
  {
    id: "search",
    chip: tr("🔎 ค้นหา/วิเคราะห์"),
    icon: "🔎",
    title: tr("ค้นหาและวิเคราะห์"),
    subtitle: tr("เจาะลึกการใช้จ่ายของคุณ"),
    tagline: tr("ให้ตัวเลขช่วยตัดสินใจ"),
    items: [
      {
        icon: "🗓️",
        cmd: "สรุป 20/10-30/10",
        desc: tr("สรุปช่วงวันที่เลือก"),
        need: "starter",
      },
      { icon: "🔎", cmd: "ค้นหา กาแฟ", desc: tr("หารายการพร้อมยอดรวม"), need: "starter" },
      { icon: "🔮", cmd: "พยากรณ์", desc: tr("คาดเงินปลายรอบ"), need: "plus", send: "พยากรณ์" },
      { icon: "🧠", cmd: "วิเคราะห์", desc: tr("AI วิเคราะห์การใช้จ่าย"), need: "plus" },
      {
        icon: "🧭",
        cmd: "หน้ารายการ",
        desc: tr("เปิดหน้ารายการในแอป"),
        need: "free",
        send: "หน้ารายการ",
      },
      {
        icon: "🦉",
        cmd: "ถามพี่ฮูก",
        desc: tr("ถามเรื่องเงินกับ AI"),
        need: "free",
        send: "ถามพี่ฮูก",
      },
    ],
  },
  {
    id: "wallet",
    chip: tr("👛 กระเป๋า/บัตร"),
    icon: "👛",
    title: tr("กระเป๋าและบัตร"),
    subtitle: tr("แยกเงินสด บัญชี บัตรเครดิต"),
    tagline: tr("แยกเงินให้เป็นระเบียบ"),
    items: [
      {
        icon: "👛",
        cmd: "กระเป๋า",
        desc: tr("ยอดแต่ละใบและยอดรวม"),
        need: "free",
        send: "กระเป๋า",
      },
      {
        icon: "🔁",
        cmd: "โอน 500 เงินสด>KTC",
        desc: tr("โอนระหว่างกระเป๋า"),
        need: "starter",
      },
      {
        icon: "💳",
        cmd: "บัตร",
        desc: tr("วงเงินและยอดรอบบิล"),
        need: "starter",
        send: "บัตร",
      },
      {
        icon: "💞",
        cmd: "เชิญ กองกลาง",
        desc: tr("ชวนแฟนใช้กระเป๋าร่วม"),
        need: "starter",
      },
      {
        icon: "🔑",
        cmd: "ร่วมกระเป๋า 123456",
        desc: tr("เข้ากระเป๋าร่วมด้วยรหัส"),
        need: "free",
      },
    ],
  },
  {
    id: "budget",
    chip: tr("🎯 งบและเป้าหมาย"),
    icon: "🎯",
    title: tr("งบและเป้าหมาย"),
    subtitle: tr("คุมรายจ่ายและเก็บเงิน"),
    tagline: tr("ค่อย ๆ เก็บ ถึงเป้าแน่นอน"),
    items: [
      { icon: "⏰", cmd: "งบวัน 500", desc: tr("ตั้งงบรายวัน"), need: "starter" },
      {
        icon: "📉",
        cmd: "งบวัน",
        desc: tr("ดูงบวันนี้ · ปิด: งบวัน ปิด"),
        need: "starter",
        send: "งบวัน",
      },
      {
        icon: "🐷",
        cmd: "เป้าหมาย",
        desc: tr("ดูกระปุกออมทั้งหมด"),
        need: "starter",
        send: "เป้าหมาย",
      },
      {
        icon: "🌱",
        cmd: "เป้าหมาย ใหม่ เที่ยวญี่ปุ่น 30000",
        desc: tr("สร้างกระปุกใหม่"),
        need: "starter",
      },
      {
        icon: "🪙",
        cmd: "ออม เที่ยวญี่ปุ่น 2000",
        desc: tr("หยอดเงิน · ถอน … 500"),
        need: "starter",
      },
    ],
  },
  {
    id: "debt",
    chip: tr("🤝 หนี้และบิล"),
    icon: "🤝",
    title: tr("หนี้และบิล"),
    subtitle: tr("ให้ยืม ยืม และเตือนวันจ่าย"),
    tagline: tr("ไม่ลืมทั้งเงินที่ต้องจ่ายและเงินที่ต้องได้คืน"),
    items: [
      {
        icon: "🤲",
        cmd: "ให้ยืม สมชาย 500",
        desc: tr("จดเงินที่ให้ยืม"),
        need: "starter",
      },
      {
        icon: "✅",
        cmd: "สมชายคืน 200",
        desc: tr("จดเงินที่ได้คืน"),
        need: "starter",
      },
      { icon: "📒", cmd: "หนี้", desc: tr("ยอดค้างทั้งหมด"), need: "starter", send: "หนี้" },
      {
        icon: "🧾",
        cmd: "บิล",
        desc: tr("บิลและวันครบกำหนด"),
        need: "plus",
        send: "บิล",
      },
      {
        icon: "🔔",
        cmd: "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15",
        desc: tr("ตั้งบิล บอทเตือนก่อนถึงวัน"),
        need: "plus",
      },
    ],
  },
  {
    id: "remind",
    chip: tr("⏰ เตือน/โน้ต"),
    icon: "⏰",
    title: tr("เตือนและโน้ต"),
    subtitle: tr("ให้บอทช่วยจำ"),
    tagline: tr("ตั้งเตือนตามเวลา จดโน้ตไว้ค้นทีหลัง"),
    items: [
      {
        icon: "⏰",
        cmd: "เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ",
        desc: tr("เตือนเมื่อถึงเวลา"),
        need: "free",
      },
      {
        icon: "🔁",
        cmd: "เตือน ทุกวัน 8 โมง กินยา",
        desc: tr("เตือนซ้ำทุกวัน สัปดาห์ เดือน"),
        need: "free",
      },
      {
        icon: "📋",
        cmd: "เตือน",
        desc: tr("ดูเตือนที่ตั้งไว้"),
        need: "free",
        send: "เตือน",
      },
      { icon: "📝", cmd: "โน้ต ซื้อนม รหัสไวไฟ 1234", desc: tr("จดโน้ตไว้"), need: "free" },
      { icon: "🔎", cmd: "ค้นหาโน้ต ไวไฟ", desc: tr("หาในโน้ต"), need: "free" },
      { icon: "📁", cmd: "เก็บไว้ให้หน่อย", desc: tr("ฝากไฟล์ · หาไฟล์ สัญญา"), need: "free" },
    ],
  },
  {
    id: "other",
    chip: tr("✏️ อื่น ๆ"),
    icon: "✏️",
    title: tr("แก้ไข ฮูกคอยน์ ชวนเพื่อน"),
    subtitle: tr("คำสั่งอื่น ๆ ที่ใช้บ่อย"),
    tagline: tr("จดผิดก็แก้ได้ในพริบตา"),
    items: [
      { icon: "🗑️", cmd: "ลบล่าสุด", desc: tr("ลบรายการล่าสุด"), need: "free" },
      { icon: "✏️", cmd: "แก้ล่าสุด 45", desc: tr("แก้ยอดรายการล่าสุด"), need: "free" },
      {
        icon: "🎁",
        cmd: "ฮูกคอยน์",
        desc: tr("ฮูกคอยน์และวันที่จดต่อเนื่อง"),
        need: "free",
        send: "ฮูกคอยน์",
      },
      {
        icon: "📣",
        cmd: "รหัสชวน",
        desc: tr("ชวนเพื่อน ได้โบนัสทั้งคู่"),
        need: "free",
        send: "รหัสชวน",
      },
      { icon: "🎟️", cmd: "ใช้รหัส ABCD1234", desc: tr("ใส่รหัสของเพื่อน"), need: "free" },
    ],
  },
  {
    id: "shortcuts",
    chip: tr("🚀 ทางลัด"),
    icon: "🚀",
    title: tr("ทางลัด"),
    subtitle: tr("เปิดหน้าต่าง ๆ ในแอป"),
    tagline: tr("ดูภาพรวมได้ละเอียดกว่าในแอป"),
    items: [],
  },
];

const TOPIC_IDS = new Set<string>(HELP_TOPICS.map((t) => t.id));
export const isHelpTopic = (value: unknown): value is HelpTopicId =>
  typeof value === "string" && TOPIC_IDS.has(value);

/** The row of topic chips under the question and under every topic card (so it stays on screen). */
function chips(): unknown {
  return {
    items: HELP_TOPICS.map((t) => ({
      type: "action",
      action: { type: "postback", label: t.chip, data: `a=help&t=${t.id}`, displayText: t.chip },
    })),
  };
}

/** The question after "วิธีใช้งาน", in the chosen manner of the bot, with the topic chips under it. */
export function buildHelpPrompt(persona: PersonaId = "plain"): LineMessage {
  const wording: Record<PersonaId, string> = {
    plain: tr("อยากรู้เรื่องไหนเป็นพิเศษครับ แตะหัวข้อด้านล่างเพื่อดูวิธีใช้ได้เลยนะ ✨"),
    warm: tr("ถามไว้ก่อนเก่งมากเลยน้า! เลือกหัวข้อด้านล่าง เดี๋ยวบอกให้ละเอียดเลยนะค้าบ 🌟"),
    bestie: tr("อยากรู้เรื่องไหนบอกมาได้เลยแก! จิ้มหัวข้อข้างล่างป่ะ 😎"),
    spicy: tr("ยังไม่รู้จะเริ่มตรงไหนใช่มั้ย? เลือกหัวข้อข้างล่าง แล้วอ่านให้จบนะ สติค่ะ! 📖"),
    tea: tr("หากสงสัยเรื่องใด เลือกหัวข้อด้านล่างได้ตามสะดวกเลยครับ ...ถ้าไม่ลืมไปก่อนนะครับ 🫖"),
  };
  return { type: "text", text: wording[persona], quickReply: chips() };
}

/**
 * One thing you can do: the command in bold, a short line under it. Plain, with a thin line between
 * rows. Only what the person's plan has can be tapped (and only read-only commands have `send`).
 */
function row(item: HelpItem, index: number, plan: Plan) {
  const tappable = planAtLeast(plan, item.need) && item.send !== undefined;
  return [
    ...(index > 0 ? [{ type: "separator", margin: "md" }] : []),
    {
      type: "box",
      layout: "vertical",
      margin: index > 0 ? "md" : "none",
      spacing: "xs",
      ...(tappable
        ? { action: { type: "message", label: item.cmd.slice(0, 20), text: item.send } }
        : {}),
      contents: [
        { type: "text", text: item.cmd, size: "sm", weight: "bold", color: COLOR.text, wrap: true },
        { type: "text", text: item.desc, size: "xs", color: COLOR.muted, wrap: true },
      ],
    },
  ];
}

/** A how-to card: the one-row header with its icon, then the rows, and nothing at the foot. */
function plainBubble(input: { icon: string; title: string; body: unknown[]; right?: string }) {
  return {
    type: "bubble",
    size: "kilo",
    header: compactHeader(input.title, input.right, input.icon),
    body: { type: "box", layout: "vertical", paddingAll: "12px", contents: input.body },
  };
}

const SHORTCUTS: { label: string; path: string }[] = [
  { label: tr("📊 หน้าสรุป"), path: "/summary" },
  { label: tr("🧾 หน้ารายการ"), path: "/transactions" },
  { label: tr("🏷️ หมวดและงบ"), path: "/budgets" },
  { label: tr("⚙️ ตั้งค่า"), path: "/settings" },
  { label: tr("⭐ อัปเกรด"), path: "/upgrade" },
];

/**
 * One topic as a card: a soft header with a big icon, then a coloured tile per thing you can do, with
 * its plan badge (dimmed when the person's plan lacks it), then a closing line with the app logo.
 * The topic chips ride along so they stay under the latest message.
 */
export function buildHelpTopicCard(input: {
  topic: HelpTopicId;
  plan: Plan;
  appUrl?: string;
}): LineMessage {
  const topic = HELP_TOPICS.find((t) => t.id === input.topic) ?? (HELP_TOPICS[0] as HelpTopic);
  const body =
    topic.id === "shortcuts"
      ? input.appUrl
        ? SHORTCUTS.map((sc, i) => ({
            type: "box",
            layout: "horizontal",
            margin: i === 0 ? "none" : "sm",
            contents: [
              outlinePill(sc.label, {
                type: "uri",
                label: sc.label,
                uri: `${input.appUrl}${sc.path}`,
              }),
            ],
          }))
        : [
            {
              type: "text",
              text: tr("เปิดจากเมนูด้านล่างของแชทได้เลย"),
              size: "sm",
              color: COLOR.muted,
              wrap: true,
            },
          ]
      : topic.items.flatMap((item, i) => row(item, i, input.plan));
  return {
    type: "flex",
    altText: tr("วิธีใช้: {0}", topic.title),
    quickReply: chips(),
    contents: plainBubble({ icon: topic.icon, title: topic.title, body }),
  };
}

/**
 * The look every how-to card shares (private topics, the group guide, the group welcome): a soft header
 * with a big icon, a body of coloured tiles, and a foot with the app logo and a closing line (or, for
 * the welcome, its own buttons).
 */
export function topicBubble(input: {
  icon: string;
  title: string;
  subtitle: string;
  tagline?: string;
  body: unknown[];
  appUrl?: string;
  footer?: unknown[];
  /** A smaller card (for a swipeable set): narrower, smaller type, tighter spacing. */
  compact?: boolean;
}) {
  const compact = input.compact === true;
  return {
    type: "bubble",
    // the group welcome is small cards to swipe through
    size: compact ? "kilo" : "mega",
    header: {
      type: "box",
      layout: "horizontal",
      backgroundColor: COLOR.primarySoft,
      paddingAll: "12px",
      spacing: "md",
      alignItems: "center",
      contents: [
        { type: "text", text: input.icon, size: "lg", flex: 0 },
        {
          type: "box",
          layout: "vertical",
          spacing: "xs",
          flex: 1,
          contents: [
            {
              type: "text",
              text: input.title,
              weight: "bold",
              size: "lg",
              color: "#0B5D4F",
              wrap: true,
            },
            {
              type: "text",
              text: input.subtitle,
              size: "xs",
              color: "#3F6B63",
              wrap: true,
            },
          ],
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: compact ? "10px" : "12px",
      spacing: "none",
      contents: input.body,
    },
    footer: input.footer
      ? {
          type: "box",
          layout: "vertical",
          paddingAll: "12px",
          spacing: "sm",
          contents: input.footer,
        }
      : {
          type: "box",
          layout: "horizontal",
          paddingAll: "12px",
          spacing: "md",
          alignItems: "center",
          contents: [
            {
              type: "text",
              text: input.tagline ?? "",
              size: "xs",
              color: COLOR.muted,
              wrap: true,
              flex: 1,
            },
          ],
        },
  };
}

/** The greeting for a new friend: three ways to record, and a button to the full guide. */
export function buildWelcomeCard(input: { appUrl?: string }): LineMessage {
  const example = (cmd: string, desc: string) => ({
    type: "box",
    layout: "horizontal",
    spacing: "md",
    alignItems: "center",
    margin: "sm",
    contents: [
      {
        type: "text",
        text: cmd,
        size: "sm",
        weight: "bold",
        color: "#14352E",
        flex: 4,
        wrap: true,
      },
      { type: "text", text: desc, size: "xs", color: COLOR.muted, flex: 3, wrap: true },
    ],
  });
  return {
    type: "flex",
    altText: tr("สวัสดี! เราคือพี่ฮูก พิมพ์ เช่น กาแฟ 30 หรือ เงินเดือน 25000 ได้เลย"),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: COLOR.primarySoft,
        paddingAll: "12px",
        spacing: "xs",
        contents: [
          {
            type: "text",
            text: tr("สวัสดี! เราคือพี่ฮูก 👋"),
            weight: "bold",
            size: "lg",
            color: "#0B5D4F",
          },
          {
            type: "text",
            text: tr("ผู้ช่วยจดรายรับรายจ่ายของคุณ พิมพ์สั้น ๆ ได้เลย"),
            size: "xs",
            color: "#3F6B63",
            wrap: true,
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          { type: "text", text: "ลองพิมพ์ดู", size: "xs", weight: "bold", color: COLOR.muted },
          example(tr("กาแฟ 30"), tr("จดรายจ่าย")),
          example(tr("เงินเดือน 25000"), tr("จดรายรับ")),
          example(tr("+500 ขายของ"), tr("ใส่ + เป็นรายรับ")),
          example(tr("ส่งรูปสลิป"), tr("บอทอ่านให้ (ลองฟรี 1 ใบ)")),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: COLOR.primary,
            action: { type: "message", label: "ดูวิธีใช้ทั้งหมด", text: "วิธีใช้งาน" },
          },
          ...(input.appUrl
            ? [
                {
                  type: "button",
                  style: "secondary",
                  height: "sm",
                  action: { type: "uri", label: "เปิดหน้าสรุป", uri: `${input.appUrl}/summary` },
                },
              ]
            : []),
        ],
      },
    },
  };
}

/** The group guide, one topic a card: at most three commands each, the most used first. */
const GROUP_CARDS: { icon: string; title: string; items: HelpItem[]; note?: string }[] = [
  {
    icon: "🧾",
    title: tr("จดและดูยอด"),
    items: [
      { icon: "🧾", cmd: "จด ข้าวเที่ยง 350", desc: tr("ต้องมีคำว่า จด ด้วย"), need: "free" },
      { icon: "📊", cmd: "สรุป · สรุปวันนี้", desc: tr("ใครจ่ายไปเท่าไร"), need: "free" },
      { icon: "🕘", cmd: "ล่าสุด · ลบล่าสุด", desc: tr("ดูหรือลบรายการล่าสุด"), need: "free" },
    ],
  },
  {
    icon: "💸",
    title: tr("หารเงิน"),
    items: [
      { icon: "🍽️", cmd: "หารบิล หมูกระทะ 1200", desc: tr("หารบิล พร้อม QR รายคน"), need: "free" },
      { icon: "📣", cmd: "ตามเงิน", desc: tr("ดูว่าใครยังค้างจ่าย"), need: "free" },
      {
        icon: "✈️",
        cmd: "เริ่มทริป · สรุปทริป · จบทริป",
        desc: tr("หารค่าทริป ใครโอนคืนใคร"),
        need: "free",
      },
    ],
  },
  {
    icon: "🗂️",
    title: tr("ของในกลุ่ม"),
    items: [
      {
        icon: "⏰",
        cmd: "เตือน 10 โมง บอกให้ @แอน ส่งงาน",
        desc: tr("แท็กคนได้ · ดูทั้งหมด: เตือนกลุ่ม"),
        need: "free",
      },
      {
        icon: "📝",
        cmd: "โน้ต ซื้อน้ำแข็ง · โน้ตกลุ่ม",
        desc: tr("โน้ตที่ทั้งกลุ่มเห็น"),
        need: "free",
      },
      { icon: "📁", cmd: "เก็บไฟล์ · หาไฟล์ สัญญา", desc: tr("คลังไฟล์ของกลุ่ม"), need: "free" },
    ],
  },
  {
    icon: "🦉",
    title: tr("อื่น ๆ"),
    items: [
      {
        icon: "🦉",
        cmd: "ฮูก เดือนนี้กลุ่มใช้ไปเท่าไร",
        desc: tr("ถามพี่ฮูกเรื่องสมุดกลุ่ม"),
        need: "free",
      },
      { icon: "🔒", cmd: "ปิดสมุดกลุ่ม", desc: tr("เฉพาะเจ้าของสมุด"), need: "free" },
    ],
    note: tr("ทุกคนต้องเพิ่มพี่ฮูกเป็นเพื่อนก่อน บอทถึงรู้ว่าใครจ่าย"),
  },
];

/**
 * How to use the group ledger: small cards to swipe through, a topic each, numbered so it shows there
 * is more. Everyone in the group reads it, so there are no buttons that send messages.
 */
export function buildGroupHelpCard(): LineMessage {
  return {
    type: "flex",
    altText: tr("วิธีใช้สมุดกลุ่ม: จด ข้าวเที่ยง 350 · สรุป · ล่าสุด · หารบิล"),
    contents: {
      type: "carousel",
      contents: GROUP_CARDS.map((card, n) =>
        plainBubble({
          icon: card.icon,
          title: card.title,
          right: `${n + 1}/${GROUP_CARDS.length}`,
          body: [
            ...card.items.flatMap((item, i) => row(item, i, "free")),
            ...(card.note
              ? [
                  {
                    type: "text",
                    text: card.note,
                    size: "xs",
                    color: COLOR.muted,
                    wrap: true,
                    margin: "lg",
                  },
                ]
              : []),
          ],
        }),
      ),
    },
  };
}

/**
 * What the group sees when the bot is added: three small cards to swipe through (hello and the buttons,
 * three steps, who it is for) instead of one tall one. "เปิดสมุดกลุ่ม" opens a LIFF page (it checks the
 * person is a friend of the bot and an Elite member, and only then writes the command in the group),
 * so someone who is not a friend gets an explanation and an add-friend link instead of silence. Groups
 * have no single person's theme, so it keeps the default colours.
 */
export function buildGroupWelcomeCard(input: { appUrl?: string; openUrl?: string }): LineMessage {
  const who: HelpItem[] = [
    { icon: "👨‍👩‍👧", cmd: "ครอบครัว · คู่รัก", desc: "ดูว่าเงินกองกลางไปไหนบ้าง", need: "free" },
    { icon: "✈️", cmd: "เพื่อนไปเที่ยว", desc: "หารค่าทริป สรุปว่าใครโอนคืนใคร", need: "free" },
    { icon: "🏠", cmd: "เพื่อนร่วมบ้าน", desc: "จดค่าส่วนกลางและของใช้ร่วมกัน", need: "free" },
  ];
  const step = (n: string, text: string, hint: string) => ({
    type: "box",
    layout: "horizontal",
    spacing: "md",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "22px",
        height: "22px",
        cornerRadius: "11px",
        backgroundColor: COLOR.primary,
        justifyContent: "center",
        alignItems: "center",
        flex: 0,
        contents: [
          { type: "text", text: n, size: "xs", weight: "bold", color: "#FFFFFF", align: "center" },
        ],
      },
      {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        flex: 1,
        contents: [
          { type: "text", text, size: "xs", weight: "bold", color: "#14352E", wrap: true },
          { type: "text", text: hint, size: "xs", color: COLOR.muted, wrap: true },
        ],
      },
    ],
  });
  const openButton = input.openUrl
    ? { type: "uri", label: "📒 เปิดสมุดกลุ่ม", uri: input.openUrl }
    : { type: "message", label: "📒 เปิดสมุดกลุ่ม", text: "เปิดสมุดกลุ่ม" };
  return {
    type: "flex",
    altText: tr('พี่ฮูกมาแล้ว! ช่วยกันจดรายจ่ายในกลุ่ม แตะ "เปิดสมุดกลุ่ม" เพื่อเริ่ม'),
    contents: {
      type: "carousel",
      contents: [
        topicBubble({
          compact: true,
          icon: "👋",
          title: tr("พี่ฮูก มาช่วยจดแล้ว"),
          subtitle: tr("ช่วยกันจดรายจ่ายของกลุ่ม"),
          appUrl: input.appUrl,
          body: [
            {
              type: "text",
              text: tr("ดูว่าใครจ่ายไปเท่าไร หารบิล แบ่งค่าทริป ตามเงินเพื่อนได้ในกลุ่มนี้"),
              size: "xs",
              color: "#14352E",
              wrap: true,
              margin: "sm",
            },
            {
              type: "text",
              text: tr("ปัดไปดูวิธีเริ่มใช้ →"),
              size: "xs",
              color: COLOR.muted,
              margin: "md",
            },
          ],
          footer: [
            {
              type: "button",
              style: "primary",
              height: "sm",
              color: COLOR.primary,
              action: openButton,
            },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: { type: "message", label: "📖 วิธีใช้งาน", text: "วิธีใช้งาน" },
            },
          ],
        }),
        topicBubble({
          compact: true,
          icon: "🚀",
          title: tr("เริ่มใช้ใน 3 ขั้น"),
          subtitle: tr("ง่ายนิดเดียว"),
          tagline: tr("เพื่อน ๆ จดได้ฟรี"),
          appUrl: input.appUrl,
          body: [
            step(
              "1",
              tr("กด “เปิดสมุดกลุ่ม”"),
              tr("ผู้เปิดต้องเป็น Starter ขึ้นไป (ทดลองฟรี 7 วัน)"),
            ),
            step("2", tr("พิมพ์ จด ข้าวเที่ยง 350"), tr("หรือ ค่าน้ำ 200 จด · หารบิลข้าว 900")),
            step("3", tr("พิมพ์ สรุป"), tr("ดูยอดรวมและใครจ่ายเท่าไร")),
          ],
        }),
        topicBubble({
          compact: true,
          icon: "👥",
          title: tr("เหมาะกับ"),
          subtitle: tr("กลุ่มแบบไหนใช้ได้บ้าง"),
          tagline: tr("ชวนบอทเข้ากลุ่มได้เลย"),
          appUrl: input.appUrl,
          body: who.map((item, i) => row(item, i, "free")),
        }),
      ],
    },
  };
}
