import { t } from "@/lib/i18n";
import { bangkokParts, formatThaiDate, fromBangkok, isValidYmd } from "@/lib/thai-date";
import type { LineMessage } from "@/lib/types";
import { MAX_AHEAD_DAYS, type WeekdayMismatch } from "@/lib/user-reminder";
import { choices } from "./intent-handlers";

// in functions, not at load: the names follow the language of whoever is asking
const weekdayName = (d: number) =>
  [
    t("วันอาทิตย์"),
    t("วันจันทร์"),
    t("วันอังคาร"),
    t("วันพุธ"),
    t("วันพฤหัสบดี"),
    t("วันศุกร์"),
    t("วันเสาร์"),
  ][d] ?? "";
const weekdayShort = (d: number) =>
  [t("อา."), t("จ."), t("อ."), t("พ."), t("พฤ."), t("ศ."), t("ส.")][d] ?? "";

const ymdParts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];
const weekdayOf = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
/** "27 ธ.ค. 2569" */
const dayText = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return formatThaiDate(fromBangkok(y, m, d, 12, 0));
};
/** "27 ธ.ค. (อา.)", short enough for a button. */
const buttonText = (ymd: string) =>
  `${dayText(ymd).replace(/\s\d{4}$/, "")} (${weekdayShort(weekdayOf(ymd))})`;

/** "วันอาทิตย์ 27" when the nearest 27th is not a Sunday: which day did they mean? */
export function weekdayQuestion(m: WeekdayMismatch, id: string): LineMessage {
  const asked = weekdayName(m.asked);
  const isNot = t(
    "{0} เป็น{1} ไม่ใช่{2}นะ",
    dayText(m.nearest),
    weekdayName(weekdayOf(m.nearest)),
    asked,
  );
  const message = m.match
    ? t(
        "{0} {1}ที่ {2} ที่ใกล้ที่สุดคือ {3} ต้องการเตือนวันนั้นใช่ไหม ถ้าไม่ใช่ เลือกด้านล่าง หรือพิมพ์วันที่และเดือนใหม่ได้เลย",
        isNot,
        asked,
        ymdParts(m.match)[2],
        dayText(m.match),
      )
    : t(
        "{0} ต้องการเตือน {1} ใช่ไหม ถ้าไม่ใช่ พิมพ์วันที่และเดือนใหม่ได้เลย",
        isNot,
        dayText(m.nearest),
      );
  return choices(message, id, [
    ...(m.match ? [[`✅ ${buttonText(m.match)}`, `on:${m.match}`] as [string, string]] : []),
    [m.match ? buttonText(m.nearest) : `✅ ${buttonText(m.nearest)}`, `on:${m.nearest}`],
    [t("พิมพ์วันใหม่"), "retype"],
  ]);
}

const dayNumber = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * `at` moved to the day picked (`ymd`, one of the two offered in `m`), keeping its time of day and
 * how far it sits from the day it was set for (midnight is 00:00 of the next day). Null for any
 * other day: the value comes back from a button, so it is checked.
 */
export function onDay(at: Date, m: WeekdayMismatch, ymd: string): Date | null {
  if (ymd !== m.nearest && ymd !== m.match) return null;
  const [y, mo, d] = ymdParts(ymd);
  if (!isValidYmd(y, mo, d)) return null;
  const p = bangkokParts(at);
  const setFor = m.match ?? m.nearest;
  const shift = dayNumber(`${p.year}-${p.month}-${p.day}`) - dayNumber(setFor);
  const moved = fromBangkok(y, mo, d + shift, p.hour, p.minute);
  return moved.getTime() - Date.now() > MAX_AHEAD_DAYS * 86_400_000 ? null : moved;
}

/** A line for a card already saved (a group's): the weekday said did not fit the day used. */
export function weekdayNote(m: WeekdayMismatch): string {
  return t(
    "{0} เป็น{1} ไม่ใช่{2} พี่ฮูกเลยตั้งเป็น {3} ถ้าไม่ใช่ ยกเลิกแล้วพิมพ์วันที่และเดือนใหม่นะ",
    dayText(m.nearest),
    weekdayName(weekdayOf(m.nearest)),
    weekdayName(m.asked),
    dayText(m.match ?? m.nearest),
  );
}

export const REMINDER_RETYPE_TEXT = t(
  "ได้เลย พิมพ์ใหม่พร้อมวันที่และเดือนนะ เช่น “เตือน 27 ธ.ค. 8 โมงครึ่ง ไปกินข้าวกับเพื่อน”",
);
