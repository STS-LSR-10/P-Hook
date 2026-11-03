import { verifyCalendarToken } from "@/lib/auth/calendar-token";
import { buildIcs, googleCalendarUrl } from "@/lib/calendar";
import { getServerEnv } from "@/lib/env";
import { getCalendarReminder } from "@/lib/group-reminder-repo";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const plain = (text: string, status: number) =>
  new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * GET /api/calendar/:id?t=&to=ics|google — the "add to calendar" buttons on a group's reminder card.
 * Opened in the phone's own browser with no session: the token names the one reminder. `ics` gives a
 * file the phone's calendar adds; `google` goes to Google Calendar's add-event page. Always the
 * reminder as it is now, so an edit made since the card was sent is what gets added.
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  const url = new URL(request.url);
  const named = await verifyCalendarToken(
    url.searchParams.get("t") ?? "",
    getServerEnv().SESSION_JWT_SECRET,
  );
  if (named !== id) return plain("ไม่พบเตือนนี้", 404);

  const reminder = await getCalendarReminder(getAdminClient(), id);
  if (!reminder) return plain("ไม่พบเตือนนี้", 404);
  if (!reminder.active) return plain("เตือนนี้ถูกยกเลิกหรือเตือนไปแล้ว", 410);

  const event = { body: reminder.body, at: new Date(reminder.remindAt), repeat: reminder.repeat };
  if (url.searchParams.get("to") === "google") {
    return new Response(null, {
      status: 302,
      headers: { Location: googleCalendarUrl(event), "Cache-Control": "no-store" },
    });
  }
  return new Response(buildIcs({ id, ...event, now: new Date() }), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="reminder.ics"',
      "Cache-Control": "no-store",
    },
  });
}
