import { z } from "zod";
import { parseEmoji } from "@/lib/category-emoji";
import { t } from "@/lib/i18n";
import { MAX_REMINDER_CATEGORY_NAME } from "@/lib/user-reminder";

const schema = z.object({ name: z.string().max(100), emoji: z.string().max(32) });

export const REMINDER_CATEGORY_INVALID_TEXT = t(
  "ตั้งชื่อหมวด (ไม่เกิน {0} ตัวอักษร) และเลือกอีโมจิ 1 ตัวนะ",
  MAX_REMINDER_CATEGORY_NAME,
);

/** A name (1 to 20 letters) and exactly one emoji, or null. */
export function readReminderCategory(input: unknown): { name: string; emoji: string } | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return null;
  const name = parsed.data.name.replace(/\s+/g, " ").trim();
  const emoji = parseEmoji(parsed.data.emoji);
  if (!name || [...name].length > MAX_REMINDER_CATEGORY_NAME) return null;
  if (!emoji.ok || !emoji.emoji) return null;
  return { name, emoji: emoji.emoji };
}
