import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { MAX_START_DAY } from "@/lib/budget-cycle";
import { requireFeature } from "@/lib/plan-server";
import { DEFAULT_PERSONA, DEFAULT_THEME, PERSONA_IDS, THEME_IDS } from "@/lib/personalize";
import { normalizeTime } from "@/lib/reminder";
import { getSettings } from "@/lib/repo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_ZONE, isZone } from "@/lib/zone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    return json(await settingsOf(getAdminClient(), auth.userId));
  });
}

/** The settings, and the time zone (kept on the person, not with the other settings). */
async function settingsOf(db: SupabaseClient, userId: string) {
  const [settings, user] = await Promise.all([
    getSettings(db, userId),
    db.from("users").select("timezone").eq("id", userId).single(),
  ]);
  if (user.error) throw new Error(`load zone: ${user.error.message}`);
  const zone = (user.data as { timezone?: string } | null)?.timezone;
  return { ...settings, timezone: isZone(zone) ? zone : DEFAULT_ZONE };
}

const patchSchema = z
  .object({
    confirm_style: z.enum(["full", "short", "off"]),
    budget_cycle: z.enum(["monthly", "weekly"]),
    cycle_start_day: z.number().int().min(1).max(MAX_START_DAY),
    daily_reminder_enabled: z.boolean(),
    /** "HH:MM" Bangkok time */
    daily_reminder_time: z.string(),
    weekly_summary_enabled: z.boolean(),
    monthly_summary_enabled: z.boolean(),
    card_theme: z.enum(THEME_IDS),
    bot_persona: z.enum(PERSONA_IDS),
    photo_prompt: z.boolean(),
    /** One of the zones we list; the page signs in again after a change, so the session carries it. */
    timezone: z.string().refine(isZone),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ค่าที่ส่งมาไม่ถูกต้อง", 400);
    const { timezone, ...rest } = parsed.data;
    const patch: Record<string, unknown> = { ...rest };

    const db = getAdminClient();

    if (timezone !== undefined) {
      const { error } = await db.from("users").update({ timezone }).eq("id", auth.userId);
      if (error) throw new Error(`save zone: ${error.message}`);
    }

    if (parsed.data.daily_reminder_time !== undefined) {
      const time = normalizeTime(parsed.data.daily_reminder_time);
      if (!time) return apiError("เวลาไม่ถูกต้อง (เช่น 20:30)", 400);
      patch.daily_reminder_time = time;
    }

    // Reminders are a Plus feature. Turning them off is always allowed.
    const wantsReminder =
      parsed.data.daily_reminder_enabled === true || parsed.data.daily_reminder_time !== undefined;
    if (wantsReminder) {
      const locked = await requireFeature(db, auth.userId, "dailyReminder");
      if (locked) return locked;
    }

    // Automatic summaries are a paid feature. Turning them off is always allowed.
    if (
      parsed.data.weekly_summary_enabled === true ||
      parsed.data.monthly_summary_enabled === true
    ) {
      const locked = await requireFeature(db, auth.userId, "autoSummary");
      if (locked) return locked;
    }

    // Another look or manner than the default is a Pro feature. Going back to the default is
    // always allowed, so a lapsed plan can still reset it.
    if (
      (parsed.data.card_theme !== undefined && parsed.data.card_theme !== DEFAULT_THEME) ||
      (parsed.data.bot_persona !== undefined && parsed.data.bot_persona !== DEFAULT_PERSONA)
    ) {
      const locked = await requireFeature(db, auth.userId, "personalize");
      if (locked) return locked;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await db
        .from("user_settings")
        .upsert({ user_id: auth.userId, ...patch }, { onConflict: "user_id" });
      if (error) throw new Error(`save settings: ${error.message}`);
    }
    return json(await settingsOf(db, auth.userId));
  });
}
