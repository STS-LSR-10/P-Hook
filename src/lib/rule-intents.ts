import type { Command } from "@/lib/commands";
import { normalizeThaiDigits, parseAmountToSatang } from "@/lib/parse/thai-number";
import { parseReminder } from "@/lib/user-reminder";
import { ASKS_RE } from "@/lib/ai/route-text";

/**
 * The ways people say a command that are not the exact word (`parseCommand` takes those): "ลบอันล่าสุด",
 * "เดือนนี้ใช้ไปเท่าไหร่", "จดโน้ต …", "อย่าลืม … พรุ่งนี้", "สวัสดี". Read here by rules so the AI is
 * not asked, and costs nothing. null means the rules do not know the phrase (then the AI may help).
 */

/** Polite endings that change nothing: "ค่ะ" "ครับ" "นะ" "หน่อย"… */
const POLITE = /(?:ครับ|ค่ะ|คะ|จ้า|จ้ะ|นะ|หน่อย)+$/;

type Period = "today" | "yesterday" | "this-week" | "last-week" | "month" | "last-month";

const PERIODS: [RegExp, Period][] = [
  [/^วันนี้$/, "today"],
  [/^เมื่อวาน(?:นี้)?$/, "yesterday"],
  [/^(?:สัปดาห์|อาทิตย์)นี้$/, "this-week"],
  [/^(?:สัปดาห์|อาทิตย์)(?:ที่แล้ว|ก่อน|ที่ผ่านมา)$/, "last-week"],
  [/^เดือนนี้$/, "month"],
  [/^เดือน(?:ที่แล้ว|ก่อน|ที่ผ่านมา)$/, "last-month"],
];

function periodOf(word: string): Period | null {
  return PERIODS.find(([re]) => re.test(word))?.[1] ?? null;
}

function summaryFor(period: Period): Command {
  switch (period) {
    case "today":
      return { kind: "summary", scope: "today" };
    case "month":
      return { kind: "summary", scope: "month" };
    default:
      return { kind: "summary-preset", preset: period };
  }
}

const HELLO = /^(?:สวัสดี|หวัดดี|ดีจ้า|ดี|hello|hi|hey)(?:พี่ฮูก|ฮูก|ทุกคน)?$/;
const THANKS = /^(?:ขอบคุณ|ขอบใจ|thanks|thankyou|thx)(?:มาก|มากๆ|พี่ฮูก|ฮูก)*$/;

// a budget said in the chat: "งบอาหาร 3000" · "ตั้งงบ 20000" · "งบกินเที่ยว 120 บาท". It is not an
// expense: the budgets page opens with it filled in, and the person confirms there.
const BUDGET_SET =
  /^(?:ตั้ง|กำหนด|เปลี่ยน|ปรับ|แก้|อัปเดต)?\s*งบ(?:ประมาณ)?\s*([^\d]*?)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน|ล้าน)?\s*(?:บาท)?$/i;
/** Words that mean "the whole budget" rather than a category. */
const OVERALL_WORDS = [
  "",
  "รวม",
  "รายเดือน",
  "เดือนละ",
  "ต่อเดือน",
  "ทั้งเดือน",
  "ทั้งหมด",
  "เดือนนี้",
  "ต่อรอบ",
];
/** "งบวันละ 300" is the daily budget (its own command); a weekly one, and words that are not a name, are left to the AI. */
const DAILY_WORDS = ["วัน", "รายวัน", "วันละ", "ต่อวัน", "ทุกวัน"];
const NOT_A_NAME =
  /^(?:รายสัปดาห์|สัปดาห์ละ|ต่อสัปดาห์|รายอาทิตย์|อาทิตย์ละ|ต่ออาทิตย์|เหลือ|เท่าไหร่|เท่าไร|ใช้ไป)$/;
/** More than the budgets page takes (9 digits of baht). */
const MAX_BUDGET_SATANG = 100_000_000_000;

function parseBudgetSet(raw: string): Command | null {
  const text = normalizeThaiDigits(raw).replace(/\s+/g, " ").trim().replace(POLITE, "").trim();
  const m = BUDGET_SET.exec(text);
  if (!m?.[2]) return null;
  // "อาหาร เดือนละ" is "อาหาร": the period word after the name says nothing about which category
  const name = (m[1] ?? "").replace(/\s*(?:เดือนละ|ต่อเดือน|รายเดือน|ต่อรอบ)$/, "").trim();
  const amountSatang = parseAmountToSatang(m[2], m[3]);
  if (amountSatang <= 0 || amountSatang >= MAX_BUDGET_SATANG || name.length > 30) return null;
  if (/[-+]$/.test(name) || NOT_A_NAME.test(name)) return null;
  if (DAILY_WORDS.includes(name)) return { kind: "daily-budget", action: "set", amountSatang };
  return {
    kind: "budget-set",
    name: OVERALL_WORDS.includes(name) ? null : name,
    amountSatang,
  };
}

export function parseNaturalCommand(input: string, now: Date): Command | null {
  const raw = input.trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "").toLowerCase();
  // the same without the polite ending ("ขอบคุณค่ะ" → "ขอบคุณ")
  const plain = compact.replace(POLITE, "");

  // chit-chat: answered with a fixed line
  if (HELLO.test(plain)) return { kind: "chitchat", say: "hello" };
  if (THANKS.test(plain)) return { kind: "chitchat", say: "thanks" };

  // help
  if (["ช่วยด้วย", "ใช้ยังไง", "ใช้งานยังไง", "ทำอะไรได้บ้าง", "ทำอะไรได้"].includes(plain)) {
    return { kind: "help" };
  }

  // the last entry
  if (/^(?:ลบ|ยกเลิก)(?:อัน|รายการ)?(?:ล่าสุด|สุดท้าย)$/.test(plain)) {
    return { kind: "delete-latest" };
  }
  if (/^(?:ขอ)?ดู(?:รายการ)?ล่าสุด$/.test(plain)) return { kind: "recent" };

  // a summary of a period: "ดูสรุป" · "ยอดเดือนนี้" · "เดือนนี้ใช้ไปเท่าไหร่"
  if (plain === "ดูสรุป" || plain === "ขอดูสรุป") return { kind: "summary-menu" };
  const ask = /^(?:ขอ)?(?:ดู)?(?:ยอด|สรุป|ยอดใช้จ่าย|รายจ่าย)(.+)$/.exec(plain)?.[1];
  const spent =
    /^(.+?)(?:เรา|ฉัน|ผม|หนู)?(?:ใช้|จ่าย)(?:เงิน)?ไป(?:ทั้งหมด)?(?:เท่าไหร่|เท่าไร|กี่บาท)(?:แล้ว|บ้าง)?\??$/.exec(
      plain,
    )?.[1];
  const period = periodOf(ask ?? spent ?? "");
  if (period) return summaryFor(period);

  // a budget
  const budget = parseBudgetSet(raw);
  if (budget) return budget;

  // notes: "จดโน้ต ซื้อนม" · "บันทึกโน้ต …" · "จำไว้ว่า แม่ชอบทุเรียน"
  const note =
    /^(?:จด|บันทึก)โน[้๊็]ต\s+([\s\S]+)$/.exec(raw)?.[1] ?? /^จำไว้ว่า\s*([\s\S]+)$/.exec(raw)?.[1];
  if (note?.trim()) return { kind: "note-add", body: note.trim() };

  // a reminder with the time said clearly: "เตือนจ่ายค่าไฟ พรุ่งนี้ 9 โมง" · "อย่าลืมโทรหาแม่ พรุ่งนี้"
  const remind = /^(?:ช่วย)?(?:เตือน(?!ใจ)|อย่าลืม)(?:ฉัน|ผม|หนู)?\s*([\s\S]+)$/
    .exec(raw)?.[1]
    ?.trim();
  if (remind && parseReminder(remind, now).ok) return { kind: "remind-add", text: remind };

  // "หา ใบเสร็จ ค่าไฟ": look everywhere (a word with no number, so "หา 500" and a question are left alone)
  const find = /^หา\s+([^\d\n]{2,60})$/.exec(normalizeThaiDigits(raw))?.[1]?.trim();
  if (find && !ASKS_RE.test(raw))
    return { kind: "find", term: raw.replace(/^หา\s+/, "").trim(), in: "any" };

  return null;
}
