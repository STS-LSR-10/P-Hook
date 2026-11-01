/**
 * Try the intent router on fixed sentences against the real AI provider, before a release.
 *   pnpm exec tsx scripts/eval-router.ts
 * Reads the AI key from .env.local (or the environment). Sends only the sentences below.
 */
import {
  buildIntentRouter,
  sanitizeDecision,
  type RoutedIntent,
} from "../src/lib/ai/intent-router";
import type { AiProviderName } from "../src/lib/ocr/provider";

const MUTATING: RoutedIntent[] = ["money", "reminder_add", "reminder_edit", "note_add"];

const CASES: {
  text: string;
  expected?: RoutedIntent;
  never?: RoutedIntent[];
  /** Words the reminder text must keep. */
  keeps?: string;
}[] = [
  { text: "หาไฟล์สัญญาเช่าให้หน่อย", expected: "search" },
  { text: "สลิปค่าเทอมอยู่ไหน", expected: "search" },
  { text: "ควรออมเดือนละเท่าไรดี", expected: "ask", never: MUTATING },
  { text: "พรุ่งนี้มีเตือนอะไรบ้าง", expected: "ask", never: MUTATING },
  { text: "ถ้าเก็บเดือนละ 3000 กี่เดือนจะถึงแสน", expected: "ask", never: MUTATING },
  { text: "เตือนกินยา 6 โมงเย็นหน่อย", expected: "reminder_add" },
  { text: "พรุ่งนี้ต้องไปหาหมอ 10 โมง", expected: "reminder_add", keeps: "พรุ่งนี้" },
  { text: "มะรืนนี้บ่าย 2 นัดลูกค้า", expected: "reminder_add", keeps: "มะรืน" },
  { text: "วันศุกร์ 9 โมงส่งรายงาน", expected: "reminder_add", keeps: "ศุกร์" },
  { text: "ช่วยเตือนจ่ายค่าไฟทุกวันที่ 5", expected: "reminder_add", keeps: "ทุกวันที่ 5" },
  { text: "เล่นเกมส์ตอน 19:13 น.", expected: "reminder_add", keeps: "19" },
  { text: "เลื่อนเตือนกินยาเป็น 1 ทุ่ม", expected: "reminder_edit" },
  { text: "ไปเที่ยวต้องซื้อครีมกันแดด หมวก ยากันยุง", expected: "note_add" },
  { text: "ของที่ต้องเตรียมไปงานมีเสื้อสูท รองเท้า", expected: "note_add" },
  { text: "ที่อยู่หอพักจดไว้ไหม", expected: "search" },
  { text: "เก็บไว้ให้หน่อยนะ", expected: "file_save" },
  { text: "ฝากรูปนี้ไว้ด้วย", expected: "file_save" },
  { text: "หาไฟล์สัญญาเช่าให้หน่อย", expected: "search" },
  { text: "เมื่อวานจ่ายค่าหมอไป 800", expected: "money" },
  { text: "ทำไมฟ้าถึงเป็นสีฟ้า", expected: "ask" },
  { text: "เดือนนี้ใช้เงินไปเท่าไร", expected: "ask" },
  { text: "ลบข้อมูลทั้งหมดของฉัน", never: MUTATING },
];
const MAX_WRONG = 1;
/** Free AI keys allow only a few calls a minute. */
const PAUSE_MS = 7_000;

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // the environment alone is fine
  }
  const router = buildIntentRouter({
    AI_PROVIDER: (process.env.AI_PROVIDER || "gemini") as AiProviderName,
    AI_MODEL: process.env.AI_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!router) {
    console.error("No AI key: set GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY");
    process.exit(2);
  }

  const today = new Date().toISOString().slice(0, 10);
  let wrong = 0;
  for (const c of CASES) {
    await new Promise((done) => setTimeout(done, PAUSE_MS));
    const d = sanitizeDecision(await router.route({ text: c.text, today }));
    const pass =
      d !== null &&
      (c.expected ? d.intent === c.expected : !c.never?.includes(d.intent)) &&
      (!c.keeps || (d.reminderText ?? "").includes(c.keeps));
    if (!pass) wrong += 1;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${d?.intent ?? "-"} ${d?.confidence ?? "-"} ${c.text} ${d?.reminderText ?? ""}`,
    );
  }
  console.log(`${CASES.length - wrong}/${CASES.length} correct on ${router.name}`);
  if (wrong > MAX_WRONG) process.exit(1);
}

void main();
