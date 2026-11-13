import { loadBonus } from "@/lib/addons-repo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { json } from "@/lib/api";
import { getPlanInfo } from "@/lib/plan-server";
import {
  MAX_AHEAD_DAYS,
  MAX_REMINDER_TEXT,
  capacityOf,
  isBuiltInCategory,
  type ReminderKind,
} from "@/lib/user-reminder";
import { listReminderCategories } from "@/lib/reminder-category-repo";
import { countActiveReminders } from "@/lib/user-reminder-repo";

/** POST and PATCH share this: what a reminder is made of. */
export const reminderSchema = z.object({
  body: z.string().trim().min(1).max(MAX_REMINDER_TEXT),
  /** ISO moment with an offset (the page sends the Bangkok time the person picked). */
  remindAt: z.string().datetime({ offset: true }),
  repeat: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
  /** A built-in key or the id of one of the person's own categories (checked by `categoryProblem`). */
  category: z.string().min(1).max(40).nullable().optional(),
});

export const REMINDER_INVALID_TEXT = `เขียนเรื่องที่ให้เตือน (ไม่เกิน ${MAX_REMINDER_TEXT} ตัวอักษร) และเลือกวันเวลาให้ถูกต้องนะ`;

/** The problem with a time, or null when it can be used. */
export function reminderTimeProblem(remindAt: Date): string | null {
  const now = Date.now();
  if (remindAt.getTime() <= now + 30_000) return "เวลานั้นผ่านไปแล้ว เลือกเวลาใหม่นะ";
  if (remindAt.getTime() > now + MAX_AHEAD_DAYS * 86_400_000) {
    return "ตั้งเตือนล่วงหน้าได้ไม่เกิน 1 ปีนะ";
  }
  return null;
}

/** The answer when the plan has no room for one more of `kind` (one-off or repeating), or null. */
export async function reminderRoomProblem(
  db: SupabaseClient,
  userId: string,
  kind: ReminderKind,
): Promise<Response | null> {
  const [{ plan }, count] = await Promise.all([
    getPlanInfo(db, userId),
    countActiveReminders(db, userId, kind),
  ]);
  const limit = capacityOf(plan, kind, (await loadBonus(db, userId)).alerts);
  if (count < limit) return null;
  return json(
    {
      error:
        kind === "repeat"
          ? `มีเตือนประจำ (เตือนซ้ำ) ครบ ${limit} รายการแล้ว ลบอันที่ไม่ใช้หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ`
          : `มีเตือนที่รออยู่ครบ ${limit} รายการแล้ว ลบอันที่ไม่ใช้หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ`,
      upgrade: plan !== "ultimate",
    },
    409,
  );
}

/** The problem with a category, or null when it is built in, one of the person's own, or none. */
export async function categoryProblem(
  db: SupabaseClient,
  userId: string,
  category: string | null | undefined,
): Promise<string | null> {
  if (!category || isBuiltInCategory(category)) return null;
  const own = await listReminderCategories(db, userId);
  return own.some((c) => c.id === category) ? null : "ไม่พบหมวดนี้ ลองเลือกหมวดใหม่นะ";
}
