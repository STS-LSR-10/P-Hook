import { describe, expect, it } from "vitest";
import { signCalendarToken, verifyCalendarToken } from "./auth/calendar-token";
import { buildIcs, googleCalendarUrl } from "./calendar";

const AT = new Date("2026-11-03T03:00:00Z"); // 10:00 in Bangkok
const NOW = new Date("2026-11-02T10:00:00Z");
const SECRET = "s".repeat(32);

describe("buildIcs", () => {
  it("is one event at the reminder's time, with the phone's alert at that moment", () => {
    const ics = buildIcs({ id: "r1", body: "ส่งงาน, ด่วน; ด้วย", at: AT, repeat: null, now: NOW });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("UID:r1@phook\r\n");
    expect(ics).toContain("DTSTART:20261103T030000Z\r\n");
    expect(ics).toContain("DTEND:20261103T031500Z\r\n");
    expect(ics).toContain("SUMMARY:ส่งงาน\\, ด่วน\\; ด้วย\r\n");
    expect(ics).toContain("TRIGGER:PT0M\r\n");
    expect(ics).not.toContain("RRULE");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("repeats as the reminder does", () => {
    expect(buildIcs({ id: "r1", body: "x", at: AT, repeat: "weekly", now: NOW })).toContain(
      "RRULE:FREQ=WEEKLY\r\n",
    );
  });
});

describe("googleCalendarUrl", () => {
  it("opens Google Calendar with the event filled in", () => {
    const url = new URL(googleCalendarUrl({ body: "ส่งงาน", at: AT, repeat: "daily" }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("ส่งงาน");
    expect(url.searchParams.get("dates")).toBe("20261103T030000Z/20261103T031500Z");
    expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=DAILY");
  });
});

describe("the calendar link's token", () => {
  it("names one reminder, and nothing else", async () => {
    const token = await signCalendarToken("r1", SECRET);
    await expect(verifyCalendarToken(token, SECRET)).resolves.toBe("r1");
    await expect(verifyCalendarToken(token, "t".repeat(32))).resolves.toBeNull();
    await expect(verifyCalendarToken("nope", SECRET)).resolves.toBeNull();
  });
});
