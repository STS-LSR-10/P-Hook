import { describe, expect, it } from "vitest";
import { joinedLabel, memberCodeOf, memberDays } from "./member";

describe("memberDays", () => {
  it("counts whole days by the calendar day, not by 24 hours", () => {
    const joined = new Date("2026-11-14T16:00:00Z"); // 14 Nov 23:00 in Bangkok
    expect(memberDays(joined, new Date("2026-11-14T16:30:00Z"))).toBe(0);
    expect(memberDays(joined, new Date("2026-11-14T17:30:00Z"))).toBe(1); // 15 Nov 00:30
    expect(memberDays(joined, new Date("2026-11-26T05:00:00Z"))).toBe(12);
  });
  it("never goes below zero", () => {
    expect(memberDays(new Date("2026-11-20T00:00:00Z"), new Date("2026-11-14T00:00:00Z"))).toBe(0);
  });
});

describe("joinedLabel", () => {
  it("is the Thai date with the number of days after the year", () => {
    expect(joinedLabel("2026-11-02T03:00:00Z", new Date("2026-11-14T03:00:00Z"))).toBe(
      "2 พ.ย. 2569 (12 วัน)",
    );
  });
  it("says today on the first day", () => {
    expect(joinedLabel("2026-11-14T03:00:00Z", new Date("2026-11-14T08:00:00Z"))).toBe(
      "14 พ.ย. 2569 (วันนี้)",
    );
  });
});

describe("memberCodeOf", () => {
  it("puts the plan letter before the stored number", () => {
    expect(memberCodeOf("free", "2601")).toBe("PH-F2601");
    expect(memberCodeOf("starter", "26100")).toBe("PH-S26100");
    expect(memberCodeOf("plus", "2610")).toBe("PH-P2610");
    expect(memberCodeOf("ultimate", "261500")).toBe("PH-E261500");
  });
});
