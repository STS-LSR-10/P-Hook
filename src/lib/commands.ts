import type { DaySpec } from "@/lib/summary-range";
import { hasDateToken, parseRangeText, type SummaryPreset } from "@/lib/summary-range-text";
import { parseDebtText, type DebtCommand } from "@/lib/debt";
import { parseBillText, type BillCommand } from "@/lib/bill";
import { parseGoalText, type GoalCommand } from "@/lib/goal";
import { parseTransferText } from "@/lib/transfer";
import { normalizeThaiDigits, parseAmountToSatang } from "@/lib/parse/thai-number";
import { parsePromptPayId } from "@/lib/promptpay";

export type Command =
  | { kind: "help" }
  | { kind: "summary-range"; start: DaySpec; end: DaySpec | "today" }
  | { kind: "summary-range-usage" }
  | { kind: "summary-range-pick" }
  | { kind: "summary-menu" }
  | { kind: "summary-preset"; preset: SummaryPreset }
  | { kind: "search"; term: string }
  | { kind: "search-usage" }
  | { kind: "note-add"; body: string }
  | { kind: "file-save"; name: string | null }
  | { kind: "file-search"; term: string }
  | { kind: "file-list" }
  | { kind: "file-rename"; name: string }
  | { kind: "kept-search"; term: string }
  | { kind: "remind-add"; text: string }
  | { kind: "owl-start" }
  | { kind: "open-page"; page: "summary" | "transactions" | "budgets" | "analytics" }
  | { kind: "owl-ask"; question: string }
  | { kind: "owl-end" }
  | { kind: "remind-list" }
  | { kind: "note-list" }
  | { kind: "note-search"; term: string | null }
  | { kind: "recent" }
  | { kind: "category-spend" }
  | { kind: "year-summary"; year: number | "last" | null }
  | { kind: "compare-months" }
  | { kind: "forecast" }
  | { kind: "insight" }
  | { kind: "wallets" }
  | { kind: "cards"; name: string | null }
  | { kind: "debts" }
  | { kind: "daily-budget"; action: "show" | "set" | "clear" | "usage"; amountSatang?: number }
  | DebtCommand
  | GoalCommand
  | BillCommand
  | { kind: "wallet-join"; code: string | null }
  | { kind: "wallet-invite"; name: string }
  | { kind: "wallet-leave"; name: string }
  | { kind: "transfer"; amountSatang: number; from: string; to: string }
  | { kind: "summary"; scope: "today" | "month" }
  | { kind: "delete-latest" }
  | { kind: "edit-latest"; amountSatang: number }
  | { kind: "edit-latest-usage" }
  | { kind: "edit-done" }
  | { kind: "points" }
  | { kind: "my-code" }
  | { kind: "use-code"; code: string }
  | { kind: "use-code-usage" }
  | { kind: "payment-show" }
  | { kind: "payment-usage" }
  | { kind: "payment-promptpay"; id: string }
  | { kind: "payment-bank"; bank: string; account: string; name: string | null }
  | { kind: "payment-clear"; what: "promptpay" | "bank" };

/** Recognize the short commands. Returns null for anything that should be parsed as a transaction. */
export function parseCommand(input: string): Command | null {
  const text = normalizeThaiDigits(input).trim().replace(/\s+/g, " ").toLowerCase();

  // Notes: "โน้ต ซื้อนม" saves, "โน้ต" lists, "ค้นหาโน้ต ไวไฟ" / "โน้ต ค้นหา ไวไฟ" searches. The word
  // must stand alone ("โน้ตบุ๊ก 25000" is still an entry), and the text keeps its case and line breaks.
  const raw = input.trim();
  const noteSearch = /^(?:ค้นหา\s*โน[้๊็]ต|โน[้๊็]ต\s+ค้นหา)(?:\s+([\s\S]+))?$/.exec(raw);
  if (noteSearch) return { kind: "note-search", term: noteSearch[1]?.trim() || null };
  const note = /^โน[้๊็]ต(?:\s+([\s\S]+))?$/.exec(raw);
  if (note)
    return note[1]?.trim() ? { kind: "note-add", body: note[1].trim() } : { kind: "note-list" };

  // Kept files: "เก็บไว้" keeps what was just sent. Only these whole phrases count ("เก็บไว้กินเย็น 80"
  // is still an entry).
  if (["เก็บไว้", "เก็บไว้ให้หน่อย", "เก็บไว้หน่อย", "เก็บไฟล์นี้"].includes(text)) {
    return { kind: "file-save", name: null };
  }
  const fileSave = /^เก็บไฟล์(?:\s+([\s\S]+))?$/.exec(raw);
  if (fileSave) return { kind: "file-save", name: fileSave[1]?.trim() || null };
  const fileSearch = /^หาไฟล์\s+([\s\S]+)$/.exec(raw);
  if (fileSearch?.[1]) return { kind: "file-search", term: fileSearch[1].trim() };
  const fileRename = /^ชื่อไฟล์\s+([\s\S]+)$/.exec(raw);
  if (fileRename?.[1]) return { kind: "file-rename", name: fileRename[1].trim() };
  if (["ไฟล์ของฉัน", "ไฟล์ทั้งหมด", "หน้าไฟล์"].includes(text)) return { kind: "file-list" };

  // The pages that are not on the Rich Menu any more open from a short chat command.
  if (["หน้ารายการ", "รายการทั้งหมด", "ประวัติ", "ประวัติรายการ"].includes(text)) {
    return { kind: "open-page", page: "transactions" };
  }
  if (["หน้างบ", "งบ", "หมวด/งบ", "หมวดและงบ", "จัดการงบ", "หน้าหมวด"].includes(text)) {
    return { kind: "open-page", page: "budgets" };
  }
  if (["หน้าวิเคราะห์", "กราฟ", "หน้ากราฟ"].includes(text)) {
    return { kind: "open-page", page: "analytics" };
  }
  if (["หน้าสรุป", "เปิดหน้าสรุป"].includes(text)) return { kind: "open-page", page: "summary" };

  // พี่ฮูก (the AI assistant): "ถามพี่ฮูก" starts a few minutes of questions, "ฮูก ใช้ไปเท่าไร" asks one,
  // "จบ" leaves the mode. The name must stand alone ("ฮูกกี้ 50" is still an entry).
  if (["ถามพี่ฮูก", "ถามฮูก", "พี่ฮูก", "ฮูก"].includes(text)) return { kind: "owl-start" };
  if (["จบ", "จบการถาม", "เลิกถาม", "พอแล้ว"].includes(text)) return { kind: "owl-end" };
  const owlAsk = /^(?:ถาม)?(?:พี่)?ฮูก\s+([\s\S]+)$/.exec(raw);
  if (owlAsk?.[1]?.trim()) return { kind: "owl-ask", question: owlAsk[1].trim() };

  // Reminders: "เตือน พรุ่งนี้ 9 โมง จ่ายค่าไฟ" sets one ("เตือนฉัน ..." / "เตือนให้ ..." too), "เตือน"
  // or "รายการเตือน" lists them. "เตือน" must stand alone ("เตือนใจ 100" is still an entry).
  if (text === "รายการเตือน" || text === "เตือนทั้งหมด") return { kind: "remind-list" };
  const remind = /^เตือน(?:ฉัน|ผม|ดิฉัน|หนู)?(?:\s*ให้(?=\s))?(?:\s+([\s\S]+))?$/.exec(raw);
  if (remind) {
    return remind[1]?.trim()
      ? { kind: "remind-add", text: remind[1].trim() }
      : { kind: "remind-list" };
  }

  if (["ช่วยเหลือ", "วิธีใช้", "วิธีใช้งาน", "help", "?", "เมนู"].includes(text))
    return { kind: "help" };
  if (text === "สรุปวันนี้") return { kind: "summary", scope: "today" };
  if (text === "สรุปเดือนนี้") return { kind: "summary", scope: "month" };
  if (["ล่าสุด", "รายการล่าสุด", "5 รายการล่าสุด"].includes(text)) return { kind: "recent" };
  if (["สรุปหมวด", "สรุปตามหมวด", "สรุปหมวดหมู่"].includes(text)) return { kind: "category-spend" };
  if (["เทียบเดือน", "เทียบเดือนก่อน", "เปรียบเทียบเดือน"].includes(text)) {
    return { kind: "compare-months" };
  }
  if (["วิเคราะห์", "วิเคราะห์การใช้จ่าย", "ai insight", "insight"].includes(text)) {
    return { kind: "insight" };
  }
  if (["กระเป๋า", "กระเป๋าเงิน", "ยอดเงิน", "ยอดคงเหลือ", "wallet", "wallets"].includes(text)) {
    return { kind: "wallets" };
  }
  // "บัตร" / "บัตรเครดิต" / "บัตร ktc" (a name has no digits: "บัตร 500" is an ordinary entry)
  const cards = /^(?:บัตรเครดิต|บัตร)(?:\s+([^\d]+))?$/.exec(text);
  if (cards) return { kind: "cards", name: cards[1]?.trim() || null };
  // "งบวัน" shows, "งบวัน 500" sets, "งบวัน ปิด" clears the daily limit
  const daily = /^(?:งบรายวัน|งบวัน)(?:\s+(.+))?$/.exec(text);
  if (daily) {
    const arg = daily[1]?.trim();
    if (!arg) return { kind: "daily-budget", action: "show" };
    if (["ปิด", "ล้าง", "ยกเลิก", "off"].includes(arg))
      return { kind: "daily-budget", action: "clear" };
    const m = /^(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน|ล้าน)?\s*(?:บาท)?$/.exec(arg);
    const satang = m?.[1] ? parseAmountToSatang(m[1], m[2]) : 0;
    return satang > 0
      ? { kind: "daily-budget", action: "set", amountSatang: satang }
      : { kind: "daily-budget", action: "usage" };
  }
  if (["หนี้", "หนี้สิน", "ลูกหนี้", "เจ้าหนี้", "debts"].includes(text)) return { kind: "debts" };
  const transfer = parseTransferText(text);
  if (transfer) return { kind: "transfer", ...transfer };
  // names keep their case, so the debt phrases read the original text
  // shared wallets: "ร่วมกระเป๋า 482913" · "เชิญ กองกลาง" · "ออกจากกระเป๋า กองกลาง"
  const join = /^ร่วมกระเป๋า(?:\s+(.+))?$/.exec(
    normalizeThaiDigits(input).trim().replace(/\s+/g, " "),
  );
  if (join)
    return { kind: "wallet-join", code: /^\d{6}$/.test(join[1] ?? "") ? (join[1] ?? null) : null };
  const invite = /^เชิญ(?:เข้ากระเป๋า)?\s+([^\d]+)$/.exec(input.trim().replace(/\s+/g, " "));
  if (invite?.[1]) return { kind: "wallet-invite", name: invite[1].trim() };
  const leave = /^ออกจากกระเป๋า\s+(.+)$/.exec(input.trim().replace(/\s+/g, " "));
  if (leave?.[1]) return { kind: "wallet-leave", name: leave[1].trim() };
  const bill = parseBillText(normalizeThaiDigits(input).trim().replace(/\s+/g, " "));
  if (bill) return bill;
  const goal = parseGoalText(normalizeThaiDigits(input).trim().replace(/\s+/g, " "));
  if (goal) return goal;
  const debt = parseDebtText(normalizeThaiDigits(input).trim().replace(/\s+/g, " "));
  if (debt) return debt;
  if (["พยากรณ์", "พยากรณ์เงิน", "พยากรณ์ปลายเดือน", "พยากรณ์ปลายรอบ"].includes(text)) {
    return { kind: "forecast" };
  }
  if (["สรุปปี", "สรุปรายปี", "สรุปปีนี้"].includes(text))
    return { kind: "year-summary", year: null };
  if (["สรุปปีที่แล้ว", "สรุปปีก่อน"].includes(text)) return { kind: "year-summary", year: "last" };
  const yearMatch = /^(?:สรุปปี|สรุปรายปี)\s+(\d{4})$/.exec(text);
  if (yearMatch?.[1]) return { kind: "year-summary", year: Number(yearMatch[1]) };
  // "สรุป" alone asks which summary; the ready-made ones and the date picker are named commands
  if (text === "สรุป") return { kind: "summary-menu" };
  if (["สรุปเมื่อวาน", "สรุปเมื่อวานนี้"].includes(text)) {
    return { kind: "summary-preset", preset: "yesterday" };
  }
  if (["สรุปสัปดาห์นี้", "สรุปอาทิตย์นี้", "สรุปรายสัปดาห์"].includes(text)) {
    return { kind: "summary-preset", preset: "this-week" };
  }
  if (["สรุปสัปดาห์ที่แล้ว", "สรุปสัปดาห์ก่อน", "สรุปอาทิตย์ที่แล้ว"].includes(text)) {
    return { kind: "summary-preset", preset: "last-week" };
  }
  if (["สรุปเดือนที่แล้ว", "สรุปเดือนก่อน"].includes(text)) {
    return { kind: "summary-preset", preset: "last-month" };
  }
  if (["สรุปช่วง", "สรุปช่วงวันที่", "สรุปช่วงเวลา", "เลือกช่วงวันที่"].includes(text)) {
    return { kind: "summary-range-pick" };
  }
  // "สรุป 20/10-30/10", "สรุป 20oct-30oct", "สรุป 1-15 ต.ค.", "สรุป ตั้งแต่ 20/10 ถึงวันนี้"…
  const rangeText = /^(?:สรุป|summary)(?:ช่วง)?\s*(.+)$/.exec(text)?.[1];
  if (rangeText) {
    const range = parseRangeText(rangeText);
    if (range) return { kind: "summary-range", ...range };
    // a date that is not a whole range: show how to write one
    if (hasDateToken(rangeText)) return { kind: "summary-range-usage" };
  }
  // "ค้นหา กาแฟ" / "ค้นหา #ปาร์ตี้": the term is taken from the original text so it keeps its case
  if (text === "ค้นหา") return { kind: "search-usage" };
  if (text.startsWith("ค้นหา ")) {
    const term = input.trim().replace(/\s+/g, " ").slice("ค้นหา ".length).trim();
    return term ? { kind: "search", term } : { kind: "search-usage" };
  }
  if (text === "ลบล่าสุด") return { kind: "delete-latest" };
  if (["เหรียญสะสม", "เหรียญ", "ตังสะสม", "แต้ม", "แต้มสะสม", "points"].includes(text))
    return { kind: "points" };
  if (["รหัสชวน", "รหัสชวนเพื่อน", "รหัสของฉัน"].includes(text)) return { kind: "my-code" };

  if (text.startsWith("ใช้รหัส")) {
    const code = /^ใช้รหัส\s+([a-z0-9]{4,16})$/.exec(text)?.[1];
    return code ? { kind: "use-code", code: code.toUpperCase() } : { kind: "use-code-usage" };
  }

  // where to be paid when splitting a bill in a group (set here in the private chat, never in the group)
  if (text === "พร้อมเพย์") return { kind: "payment-show" };
  if (text === "พร้อมเพย์ ลบ" || text === "ลบพร้อมเพย์") {
    return { kind: "payment-clear", what: "promptpay" };
  }
  if (text.startsWith("พร้อมเพย์ ")) {
    const pp = parsePromptPayId(text.slice("พร้อมเพย์ ".length));
    return pp ? { kind: "payment-promptpay", id: pp.id } : { kind: "payment-usage" };
  }
  if (text === "บัญชี ลบ" || text === "ลบบัญชี") return { kind: "payment-clear", what: "bank" };
  if (text.startsWith("บัญชี ")) {
    // "บัญชี กสิกร 123-4-56789-0 สมชาย ใจดี": the bank, the number, then the name on the account
    const m = /^บัญชี\s+(\S{1,30})\s+([0-9][0-9-]{5,19})(?:\s+(.{1,60}))?$/.exec(
      input.trim().replace(/\s+/g, " "),
    );
    return m?.[1] && m[2]
      ? { kind: "payment-bank", bank: m[1], account: m[2], name: m[3]?.trim() || null }
      : { kind: "payment-usage" };
  }

  // sent by the LIFF edit page after a save: the bot answers with the card of what was edited
  if (text === "แก้ไขเสร็จแล้ว") return { kind: "edit-done" };
  if (text.startsWith("แก้ล่าสุด")) {
    const rest = text.slice("แก้ล่าสุด".length).trim();
    const m = /^(\d(?:[\d,]*\d)?(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน|ล้าน)?\s*(?:บาท)?$/.exec(rest);
    if (m?.[1]) {
      const satang = parseAmountToSatang(m[1], m[2]);
      if (satang > 0) return { kind: "edit-latest", amountSatang: satang };
    }
    return { kind: "edit-latest-usage" };
  }
  return null;
}
