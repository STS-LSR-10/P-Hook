import { afterEach, describe, expect, it } from "vitest";
import {
  bangkokParts,
  currentZone,
  formatThaiDate,
  fromBangkok,
  setZoneSource,
} from "./thai-date";
import { isZone, utcOffsetLabel, ZONES } from "./zone";

afterEach(() => setZoneSource(null));

describe("the person's time zone", () => {
  it("is Bangkok unless set", () => {
    expect(currentZone()).toBe("Asia/Bangkok");
    expect(formatThaiDate(new Date("2026-11-03T03:00:00Z"), true)).toBe("3 พ.ย. 2569 10:00");
  });

  it("reads and writes wall-clock times in the zone that is set", () => {
    setZoneSource(() => "Asia/Tokyo");
    const at = new Date("2026-11-03T03:00:00Z");
    expect(bangkokParts(at)).toMatchObject({ day: 3, hour: 12, minute: 0 });
    expect(fromBangkok(2026, 11, 3, 12, 0).toISOString()).toBe(at.toISOString());
  });

  it("follows daylight saving, on both sides of the change", () => {
    setZoneSource(() => "America/New_York");
    // EDT (UTC-4) before 1 Nov 2026, EST (UTC-5) after
    expect(fromBangkok(2026, 10, 30, 9, 0).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(fromBangkok(2026, 11, 3, 9, 0).toISOString()).toBe("2026-11-03T14:00:00.000Z");
    expect(bangkokParts(new Date("2026-11-03T14:00:00Z"))).toMatchObject({ day: 3, hour: 9 });
  });

  it("a zone it does not know falls back to Bangkok", () => {
    setZoneSource(() => "Mars/Olympus");
    expect(bangkokParts(new Date("2026-11-03T03:00:00Z")).hour).toBe(10);
  });
});

describe("the zones to pick from", () => {
  it("are real zones, Bangkok among them, each once", () => {
    expect(ZONES.length).toBeGreaterThan(40);
    expect(ZONES.map((z) => z.id)).toContain("Asia/Bangkok");
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
    for (const z of ZONES) expect(isZone(z.id)).toBe(true);
    expect(isZone("Mars/Olympus")).toBe(false);
    expect(isZone("UTC")).toBe(true);
  });

  it("say their offset from UTC now", () => {
    expect(utcOffsetLabel("Asia/Bangkok", new Date("2026-11-03T00:00:00Z"))).toBe("UTC+07:00");
    expect(utcOffsetLabel("Asia/Kolkata", new Date("2026-11-03T00:00:00Z"))).toBe("UTC+05:30");
    expect(utcOffsetLabel("America/New_York", new Date("2026-11-03T00:00:00Z"))).toBe(
      "UTC-05:00",
    );
  });
});
