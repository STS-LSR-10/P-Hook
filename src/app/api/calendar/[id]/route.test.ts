import { beforeEach, describe, expect, it, vi } from "vitest";
import { signCalendarToken } from "@/lib/auth/calendar-token";

const SECRET = "s".repeat(32);
const R = "44444444-4444-4444-8444-444444444444";

let reminder: { body: string; remindAt: string; repeat: "daily" | null; active: boolean } | null;

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ SESSION_JWT_SECRET: SECRET }) }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/group-reminder-repo", () => ({
  getCalendarReminder: async (_db: unknown, id: string) => (id === R ? reminder : null),
}));

const { GET } = await import("./route");
const call = async (query: string, id = R) =>
  GET(new Request(`https://app.test/api/calendar/${id}?${query}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  reminder = {
    body: "ส่งงาน",
    remindAt: "2026-11-03T03:00:00.000Z",
    repeat: "daily",
    active: true,
  };
});

describe("GET /api/calendar/:id", () => {
  it("gives the reminder as an .ics file the phone adds", async () => {
    const t = await signCalendarToken(R, SECRET);
    const res = await call(`t=${t}&to=ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("SUMMARY:ส่งงาน");
    expect(body).toContain("RRULE:FREQ=DAILY");
  });

  it("sends Google Calendar users to its add-event page", async () => {
    const t = await signCalendarToken(R, SECRET);
    const res = await call(`t=${t}&to=google`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("https://calendar.google.com/calendar/render");
  });

  it("refuses a link not made for this reminder, and says so for one cancelled", async () => {
    const other = await signCalendarToken("55555555-5555-4555-8555-555555555555", SECRET);
    expect((await call(`t=${other}&to=ics`)).status).toBe(404);
    expect((await call("t=nope&to=ics")).status).toBe(404);
    const t = await signCalendarToken(R, SECRET);
    reminder = { ...reminder!, active: false };
    const gone = await call(`t=${t}&to=ics`);
    expect(gone.status).toBe(410);
    expect(await gone.text()).toContain("ยกเลิกหรือเตือนไปแล้ว");
  });
});
