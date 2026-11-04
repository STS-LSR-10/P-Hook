import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { signCalendarToken } from "@/lib/auth/calendar-token";
import { signGoogleLinkToken } from "@/lib/auth/google-token";
import { requireUser } from "@/lib/auth/require-user";
import { getServerEnv } from "@/lib/env";
import { googleConfig } from "@/lib/google/config";
import { getGoogleLink, maskEmail } from "@/lib/google/link-repo";
import { addReminderToGoogle } from "@/lib/google/sync";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getReminder } from "@/lib/user-reminder-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = "ไม่พบเตือนนี้ หรือเตือนไปแล้ว";
/** A personal reminder's calendar link is opened at once: it need not last. */
const PERSONAL_LINK_TTL_SECONDS = 15 * 60;
const bodySchema = z.object({ to: z.enum(["google", "device"]) });

const base = () => process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "";

async function findReminder(request: Request, params: Params["params"]) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return { ok: false as const, response: auth };
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return { ok: false as const, response: apiError(NOT_FOUND, 404) };
  const db = getAdminClient();
  const reminder = await getReminder(db, auth.userId, id);
  if (!reminder || reminder.status !== "active")
    return { ok: false as const, response: apiError(NOT_FOUND, 404) };
  return { ok: true as const, auth, db, reminder };
}

/** GET /api/reminders/:id/calendar — the reminder, and how Google Calendar stands, for the page. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const found = await findReminder(request, params);
    if (!found.ok) return found.response;
    const available = googleConfig() !== null;
    // before the migration the link cannot be read: the phone's calendar is still offered
    const link = available
      ? await getGoogleLink(found.db, found.auth.userId).catch(() => null)
      : null;
    return json({
      reminder: found.reminder,
      google: { available, linked: link !== null, email: maskEmail(link?.email ?? null) },
    });
  });
}

/**
 * POST /api/reminders/:id/calendar { to } — add the reminder to a calendar. `added`: done (Google, signed
 * in). `open`: a link for the phone's own browser — the .ics for the phone's calendar, Google's
 * sign-in (first time), or, while Google is not set up here, Google Calendar's own add page.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const found = await findReminder(request, params);
    if (!found.ok) return found.response;
    const { auth, db, reminder } = found;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("ส่งข้อมูลไม่ถูกต้อง", 400);

    const secret = getServerEnv().SESSION_JWT_SECRET;
    const calendarLink = async (to: "ics" | "google") =>
      `${base()}/api/calendar/${reminder.id}?t=${await signCalendarToken(reminder.id, secret, PERSONAL_LINK_TTL_SECONDS)}&to=${to}`;

    if (parsed.data.to === "device") return json({ open: await calendarLink("ics") });
    if (!googleConfig()) return json({ open: await calendarLink("google") });

    const added = await addReminderToGoogle(db, auth.userId, reminder);
    if (added.kind === "added") return json({ added: true, email: maskEmail(added.email) });
    if (added.kind === "failed")
      return apiError("เพิ่มลง Google Calendar ไม่สำเร็จ ลองใหม่อีกครั้งนะ", 502);
    const token = await signGoogleLinkToken(
      { userId: auth.userId, reminderId: reminder.id },
      secret,
    );
    return json({ open: `${base()}/api/google/connect?t=${token}` });
  });
}
