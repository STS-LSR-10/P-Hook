import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, isLocale, setLocaleSource, t } from "./i18n";
import { formatThaiDate, formatThaiDayMonth, thaiMonthYear } from "./thai-date";

afterEach(() => setLocaleSource(null));

describe("the person's language", () => {
  it("is Thai unless set: the words stay as written", () => {
    expect(currentLocale()).toBe("th");
    expect(t("บันทึก")).toBe("บันทึก");
    expect(t("ใช้ไป {0} จาก {1}", "฿5", "฿10")).toBe("ใช้ไป ฿5 จาก ฿10");
  });

  it("in English, words come from the dictionary, with the values put in", () => {
    setLocaleSource(() => "en");
    expect(t("บันทึก")).toBe("Save");
    expect(t("ใช้ไป {0} จาก {1}", "฿5", "฿10")).toBe("Spent ฿5 of ฿10");
  });

  it("words with no English yet stay Thai rather than go blank", () => {
    setLocaleSource(() => "en");
    expect(t("คำที่ยังไม่มีคำแปล")).toBe("คำที่ยังไม่มีคำแปล");
  });

  it("dates in English use the Western year and English months", () => {
    const at = new Date("2026-11-03T03:00:00Z");
    expect(formatThaiDate(at, true)).toBe("3 พ.ย. 2569 10:00");
    setLocaleSource(() => "en");
    expect(formatThaiDate(at, true)).toBe("3 Nov 2026 10:00");
    expect(formatThaiDayMonth(at)).toBe("3 Nov");
    expect(thaiMonthYear("2026-11")).toBe("Nov 2026");
  });

  it("only Thai and English", () => {
    expect(isLocale("th")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    setLocaleSource(() => "fr");
    expect(currentLocale()).toBe("th");
  });
});
