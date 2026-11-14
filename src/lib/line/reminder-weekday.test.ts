import { afterEach, describe, expect, it } from "vitest";
import { setLocaleSource } from "@/lib/i18n";
import { fromBangkok } from "@/lib/thai-date";
import { onDay, weekdayNote, weekdayQuestion } from "./reminder-weekday";

type Quick = { text: string; quickReply: { items: { action: { label: string } }[] } };
const SUNDAY_27 = { asked: 0, nearest: "2026-11-27", match: "2026-12-27" };
const labels = (q: Quick) => q.quickReply.items.map((i) => i.action.label);

afterEach(() => setLocaleSource(null));

describe("weekdayQuestion", () => {
  it("names both days, with short buttons that are never cut", () => {
    const q = weekdayQuestion(SUNDAY_27, "id") as unknown as Quick;
    expect(q.text).toContain("27 พ.ย. 2569 เป็นวันศุกร์ ไม่ใช่วันอาทิตย์");
    expect(labels(q)).toEqual(["✅ 27 ธ.ค. (อา.)", "27 พ.ย. (ศ.)", "พิมพ์วันใหม่"]);
    const long = weekdayQuestion({ asked: 4, nearest: "2027-03-30", match: "2027-04-30" }, "id");
    for (const l of labels(long as unknown as Quick)) expect(l.length).toBeLessThanOrEqual(20);
  });

  it("is all English for an English speaker", () => {
    setLocaleSource(() => "en");
    const q = weekdayQuestion(SUNDAY_27, "id") as unknown as Quick;
    expect(q.text).toMatch(/Friday/);
    expect(q.text).toMatch(/Sunday/);
    expect(q.text).not.toMatch(/[ก-๙]/);
    expect(labels(q)[0]).toBe("✅ 27 Dec (Su)");
    expect(weekdayNote(SUNDAY_27)).not.toMatch(/วัน/);
  });
});

describe("onDay", () => {
  it("keeps the time of day on the day picked", () => {
    const at = fromBangkok(2026, 12, 27, 8, 30);
    expect(onDay(at, SUNDAY_27, "2026-11-27")?.toISOString()).toBe("2026-11-27T01:30:00.000Z");
  });
  it("midnight (00:00 of the next day) stays the night after the day picked", () => {
    const at = fromBangkok(2026, 12, 28, 0, 0); // "วันอาทิตย์ 27 เที่ยงคืน"
    expect(onDay(at, SUNDAY_27, "2026-11-27")?.toISOString()).toBe(
      fromBangkok(2026, 11, 28, 0, 0).toISOString(),
    );
  });
  it("only a day that was offered", () => {
    const at = fromBangkok(2026, 12, 27, 8, 30);
    expect(onDay(at, SUNDAY_27, "2099-01-01")).toBeNull();
    expect(onDay(at, SUNDAY_27, "2026-02-31")).toBeNull();
  });
});
