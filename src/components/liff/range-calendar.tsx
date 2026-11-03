"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MONTHS_FULL,
  compareYmd,
  formatRange,
  monthGrid,
  presetRange,
  sameDay,
  ymdOf,
  type Preset,
  type Ymd,
} from "@/lib/date-range";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export interface DayRange {
  start: Ymd;
  end: Ymd;
}

const WEEKDAYS = [t("อา."), t("จ."), t("อ."), t("พ."), t("พฤ."), t("ศ."), t("ส.")];
const PRESETS: { value: Preset; label: string }[] = [
  { value: "month", label: t("เดือนนี้") },
  { value: "week", label: t("สัปดาห์นี้") },
  { value: "lastMonth", label: t("เดือนที่แล้ว") },
];

/**
 * A small calendar for choosing a stretch of days: tap the first day, then the last one (tapping
 * a day before the first starts again). "ทั้งหมด" clears the range.
 */
export function RangeCalendar({
  value,
  now,
  onApply,
  onClose,
}: {
  value: DayRange | null;
  now: Date;
  /** null = no range (every period). */
  onApply: (range: DayRange | null) => void;
  onClose: () => void;
}) {
  const today = ymdOf(now);
  const first = value?.start ?? today;
  const [view, setView] = useState({ year: first.year, month: first.month });
  const [start, setStart] = useState<Ymd | null>(value?.start ?? null);
  const [end, setEnd] = useState<Ymd | null>(value?.end ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pick(d: Ymd) {
    if (!start || end || compareYmd(d, start) < 0) {
      setStart(d);
      setEnd(null);
    } else {
      setEnd(d);
    }
  }

  function step(delta: number) {
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor((m - 1) / 12), month: ((m - 1 + 12) % 12) + 1 };
    });
  }

  function applyPreset(p: Preset) {
    const r = presetRange(p, now);
    setStart(r.start);
    setEnd(r.end);
    setView({ year: r.start.year, month: r.start.month });
  }

  const inRange = (d: Ymd) =>
    start !== null && end !== null && compareYmd(d, start) >= 0 && compareYmd(d, end) <= 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal
      aria-label={t("เลือกช่วงวันที่")}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm space-y-3 rounded-3xl border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <button
            type="button"
            aria-label={t("เดือนก่อนหน้า")}
            onClick={() => step(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="text-center">
            <h2 className="num text-sm font-bold">
              {MONTHS_FULL[view.month - 1]} {view.year + 543}
            </h2>
            <p className="text-[10px] text-muted">{t("เลือกช่วงวันที่ต้องการดูรายการ")}</p>
          </div>
          <button
            type="button"
            aria-label={t("เดือนถัดไป")}
            onClick={() => step(1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-muted"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
          {monthGrid(view.year, view.month).map((d) => {
            const isStart = start !== null && sameDay(d, start);
            const isEnd = end !== null && sameDay(d, end);
            const selected = isStart || isEnd;
            return (
              <button
                key={`${d.year}-${d.month}-${d.day}`}
                type="button"
                aria-label={`${d.day} ${MONTHS_FULL[d.month - 1]} ${d.year + 543}`}
                aria-pressed={selected}
                onClick={() => pick(d)}
                className={cn(
                  "num h-9",
                  !d.inMonth && !inRange(d) && "text-muted/50",
                  inRange(d) && !selected && "bg-primary-soft text-primary",
                  selected && "bg-primary font-bold text-surface",
                  isStart && "rounded-l-xl",
                  isEnd && "rounded-r-xl",
                  isStart && !end && "rounded-xl",
                  sameDay(d, today) && !selected && "font-bold text-primary",
                )}
              >
                {d.day}
              </button>
            );
          })}
        </div>

        <div className="flex gap-1.5 border-t border-border pt-3">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => applyPreset(p.value)}
              className="h-9 flex-1 rounded-lg border border-border bg-background text-[11px] font-medium text-primary"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onApply(null)}
            className="h-9 flex-1 rounded-lg border border-border bg-background text-[11px] font-medium text-muted"
          >
            {t("ทั้งหมด")}
          </button>
        </div>

        <p className="num text-center text-xs text-muted" aria-live="polite">
          {start && end
            ? formatRange(start, end)
            : start
              ? t("เลือกวันสุดท้ายของช่วง (หรือกดวันเดียวซ้ำ)")
              : t("ยังไม่ได้เลือกช่วงวันที่")}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl bg-background text-xs font-semibold text-muted"
          >
            {t("ยกเลิก")}
          </button>
          <button
            type="button"
            disabled={!start}
            onClick={() => start && onApply({ start, end: end ?? start })}
            className="h-11 flex-1 rounded-xl bg-primary text-xs font-semibold text-surface disabled:opacity-50"
          >
            {t("ตกลง")}
          </button>
        </div>
      </div>
    </div>
  );
}
