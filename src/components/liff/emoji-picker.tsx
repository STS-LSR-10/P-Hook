"use client";

import { EMOJI_CHOICES, isSingleEmoji } from "@/lib/category-emoji";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Pick one emoji from the grid, or type your own; empty means none. */
export function EmojiPicker({
  value,
  onChange,
  label = t("อีโมจิ (ไม่บังคับ)"),
}: {
  value: string;
  onChange: (e: string) => void;
  label?: string;
}) {
  const valid = value === "" || isSingleEmoji(value);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{label}</p>
      <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label={t("เลือกอีโมจิ")}>
        {EMOJI_CHOICES.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={value === e}
            aria-label={t("อีโมจิ {0}", e)}
            onClick={() => onChange(value === e ? "" : e)}
            className={cn(
              "flex h-10 items-center justify-center rounded-xl border text-xl",
              value === e ? "border-primary bg-primary-soft" : "border-transparent",
            )}
          >
            <span aria-hidden>{e}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={16}
          placeholder={t("หรือพิมพ์อีโมจิเอง")}
          aria-label={t("อีโมจิ (พิมพ์เอง)")}
          aria-invalid={!valid}
          className="h-11 w-full rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="h-11 shrink-0 rounded-2xl border border-border px-3 text-sm text-muted"
          >
            {t("ล้าง")}
          </button>
        ) : null}
      </div>
      {!valid ? (
        <p className="text-xs text-expense">{t("ใส่ได้เป็นอีโมจิตัวเดียวเท่านั้นนะ")}</p>
      ) : null}
    </div>
  );
}
