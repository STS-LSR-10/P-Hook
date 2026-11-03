"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { switchLocale, useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { Settings } from "./types";

/** Each language by its own name, so a person who cannot read the other one still finds theirs. */
const CHOICES = [
  { id: "th", label: "ไทย" },
  { id: "en", label: "English" },
] as const;

/** Pick the app's language. The page reloads in it after a change. */
export function LanguageSheet({ current, onClose }: { current?: string; onClose: () => void }) {
  const { api } = useLiff();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = current ?? DEFAULT_LOCALE;

  async function pick(locale: string) {
    if (locale === chosen) return onClose();
    setBusy(locale);
    setError(null);
    try {
      await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ locale }),
      });
      switchLocale(locale);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("บันทึกไม่สำเร็จ ลองใหม่อีกครั้งนะ"));
      setBusy(null);
    }
  }

  return (
    <Sheet title={t("ภาษา")} onClose={onClose}>
      <p className="text-xs text-muted">
        {t("ตอนนี้เปลี่ยนภาษาของหน้าเว็บ ข้อความในแชทยังเป็นภาษาไทย")}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-expense">
          {error}
        </p>
      ) : null}
      <ul className="space-y-1" aria-label={t("ภาษา")}>
        {CHOICES.map((c) => {
          const selected = c.id === chosen;
          return (
            <li key={c.id}>
              <button
                type="button"
                lang={c.id}
                disabled={busy !== null}
                onClick={() => void pick(c.id)}
                aria-pressed={selected}
                className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${
                  selected ? "bg-primary-soft font-semibold text-primary" : ""
                }`}
              >
                <span>{busy === c.id ? "…" : c.label}</span>
                {selected ? <Check className="h-4 w-4" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
