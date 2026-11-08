/**
 * English typed to the bot by someone who chose English, read as the Thai the bot already understands
 * ("remind me tomorrow 9am pay rent" -> "เตือน พรุ่งนี้ 9:00 pay rent"), so every Thai reader keeps
 * working as it is. Only a command at the start of the message is read: "help desk fee 200" stays an
 * entry. Anything it does not know is passed on as typed (Thai still works too).
 */

/** Whole messages that are a command on their own. */
const COMMANDS: Record<string, string> = {
  help: "วิธีใช้งาน",
  suggest: "เสนอแนะ",
  suggestion: "เสนอแนะ",
  feedback: "เสนอแนะ",
  menu: "วิธีใช้งาน",
  "how to": "วิธีใช้งาน",
  summary: "สรุปวันนี้",
  today: "สรุปวันนี้",
  "today summary": "สรุปวันนี้",
  "this month": "สรุปเดือนนี้",
  "month summary": "สรุปเดือนนี้",
  recent: "ล่าสุด",
  latest: "ล่าสุด",
  undo: "ลบล่าสุด",
  "delete last": "ลบล่าสุด",
  "by category": "สรุปหมวด",
  categories: "สรุปหมวด",
  compare: "เทียบเดือน",
  "compare months": "เทียบเดือน",
  forecast: "พยากรณ์",
  analyse: "วิเคราะห์",
  analyze: "วิเคราะห์",
  insight: "วิเคราะห์",
  year: "สรุปปี",
  "this year": "สรุปปี",
  "last year": "สรุปปีที่แล้ว",
  wallets: "กระเป๋า",
  cards: "บัตร",
  debts: "หนี้",
  bills: "บิล",
  goals: "เป้าหมาย",
  reminders: "รายการเตือน",
  notes: "โน้ต",
  "my files": "ไฟล์ของฉัน",
  files: "ไฟล์ของฉัน",
  "keep this": "เก็บไว้",
  keep: "เก็บไว้",
  points: "เหรียญ",
  coins: "เหรียญ",
  "invite code": "รหัสชวน",
  "my code": "รหัสชวน",
  "daily budget": "งบวัน",
  "daily budget off": "งบวัน ปิด",
  ask: "ถามพี่ฮูก",
  "ask p'hook": "ถามพี่ฮูก",
  done: "จบ",
  stop: "จบ",
};

/** A command followed by what it is about: [pattern, the Thai it becomes]. */
const PREFIXED: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^edit last\s+(.+)$/i, (m) => `แก้ล่าสุด ${m[1]}`],
  [/^daily budget\s+(.+)$/i, (m) => `งบวัน ${m[1]}`],
  [/^use code\s+(.+)$/i, (m) => `ใช้รหัส ${m[1]}`],
  [/^join wallet\s+(.+)$/i, (m) => `ร่วมกระเป๋า ${m[1]}`],
  // "feedback: …" always; "feedback …" unless it reads as an entry ("suggestion box 120")
  [/^(?:suggest|suggestion|feedback):\s*([\s\S]+)$/i, (m) => `เสนอแนะ ${m[1]}`],
  [
    /^(?:suggest|suggestion|feedback)\s+(?![^\n]*\s\d[\d,.]*$)([\s\S]+)$/i,
    (m) => `เสนอแนะ ${m[1]}`,
  ],
  [/^search notes?\s+([\s\S]+)$/i, (m) => `ค้นหาโน้ต ${m[1]}`],
  // "note: …" always; "note …" unless it reads as an entry ("note pad 50")
  [/^note:\s*([\s\S]+)$/i, (m) => `โน้ต ${m[1]}`],
  [/^note\s+(?![^\n]*\s\d[\d,.]*$)([\s\S]+)$/i, (m) => `โน้ต ${m[1]}`],
  [/^find files?\s+([\s\S]+)$/i, (m) => `หาไฟล์ ${m[1]}`],
  [/^search\s+([\s\S]+)$/i, (m) => `ค้นหา ${m[1]}`],
  [/^ask\s+([\s\S]+)$/i, (m) => `ฮูก ${m[1]}`],
  [/^year\s+(\d{4})$/i, (m) => `สรุปปี ${m[1]}`],
  [
    /^transfer\s+(.+)$/i,
    (m) => `โอน ${(m[1] ?? "").replace(/\bfrom\b/gi, "จาก").replace(/\bto\b/gi, "ไป")}`,
  ],
  [/^lend\s+(.+)$/i, (m) => `ให้ยืม ${due(m[1] ?? "")}`],
  [/^borrow\s+(.+)$/i, (m) => `ยืม ${due(m[1] ?? "")}`],
  [/^(?:i\s+)?paid back\s+(.+?)\s+(\d[\d,.]*.*)$/i, (m) => `คืน${m[1]} ${m[2]}`],
  [/^(.+?)\s+paid (?:me\s+)?back\s+(.+)$/i, (m) => `${m[1]}คืน ${m[2]}`],
  [/^repay\s+(\S+)\s+(.+)$/i, (m) => `คืน${m[1]} ${m[2]}`],
  [/^pay bill\s+(.+)$/i, (m) => `จ่ายบิล ${m[1]}`],
  [/^new goal\s+(.+)$/i, (m) => `เป้าหมาย ใหม่ ${m[1]}`],
  [/^save\s+(.+\s\d[\d,.]*)$/i, (m) => `ออม ${m[1]}`],
  [/^withdraw\s+(.+\s\d[\d,.]*)$/i, (m) => `ถอน ${m[1]}`],
  [/^summary\s+(.+)$/i, (m) => `สรุป ${(m[1] ?? "").replace(/\bto\b/gi, "ถึง")}`],
  [/^remind(?:\s+me)?(?:\s+to)?\s+([\s\S]+)$/i, (m) => `เตือน ${times(m[1] ?? "")}`],
];

/** "due 25/10" after a debt is "คืน 25/10". */
const due = (s: string) => s.replace(/\bdue\b/gi, "คืน");

const DAYS: Record<string, string> = {
  sunday: "อาทิตย์",
  monday: "จันทร์",
  tuesday: "อังคาร",
  wednesday: "พุธ",
  thursday: "พฤหัสบดี",
  friday: "ศุกร์",
  saturday: "เสาร์",
};

/** A reminder's when, in the Thai words its reader knows. */
function times(s: string): string {
  return (
    s
      .replace(/\bin\s+(\d+)\s*(?:minutes?|mins?)\b/gi, "อีก $1 นาที")
      .replace(/\bin\s+(\d+)\s*(?:hours?|hrs?|h)\b/gi, "อีก $1 ชั่วโมง")
      .replace(/\bevery month on the\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi, "ทุกวันที่ $1")
      .replace(
        /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
        (_, d) => {
          return `ทุกวัน${DAYS[String(d).toLowerCase()]}`;
        },
      )
      .replace(/\b(?:every day|daily)\b/gi, "ทุกวัน")
      .replace(/\btomorrow\b/gi, "พรุ่งนี้")
      .replace(/\btoday\b/gi, "วันนี้")
      .replace(/\bnoon\b/gi, "12:00")
      .replace(/\bmidnight\b/gi, "เที่ยงคืน")
      .replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/gi, (_, h, min, ap) => {
        let hour = Number(h) % 12;
        if (String(ap).toLowerCase() === "pm") hour += 12;
        return `${hour}:${min ?? "00"}`;
      })
      // "at 9" with no am/pm: that hour
      .replace(/\bat\s+(\d{1,2})(?![\d:.])/gi, "$1:00")
      .replace(/\bat\s+(?=\d|เที่ยงคืน)/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Money coming in, said in English: just the word and the amount ("salary 25000", "bonus 5000"). Any
 * more words or a second number could make it something else ("income tax 5000"), so it is left as
 * typed and read like any entry.
 */
const INCOME = /^(salary|bonus|wages?|dividends?|commission)\s+(\d[\d,.]*)$/i;

/**
 * What an English message is read as: `command`, the Thai command it starts with (null when none), and
 * `entry`, the text to read as an entry when it is not a command, or when the command finds nothing to
 * act on and the message falls back to an entry (so the entry keeps the person's own words).
 */
export function englishMessage(input: string): { command: string | null; entry: string } {
  const text = input.trim();
  const entry = englishEntry(input);
  const command = COMMANDS[text.toLowerCase().replace(/\s+/g, " ")];
  if (command) return { command, entry };
  for (const [pattern, toThai] of PREFIXED) {
    const m = pattern.exec(text);
    if (m) return { command: toThai(m), entry };
  }
  return { command: null, entry };
}

/** An entry in English: "yesterday …" is the Thai word for it, and money in gets its "+". */
function englishEntry(input: string): string {
  const text = input.trim();
  const past = /^yesterday\s+([\s\S]+)$/i.exec(text);
  const rest = past?.[1] ?? text;
  const income = INCOME.exec(rest);
  const body = income?.[1] && income[2] ? `+${income[2]} ${income[1]}` : past ? rest : input;
  return past ? `เมื่อวาน ${body}` : body;
}

/** The text the bot reads: the Thai command when there is one, else the entry. */
export function englishToThai(input: string): string {
  const read = englishMessage(input);
  return read.command ?? read.entry;
}
