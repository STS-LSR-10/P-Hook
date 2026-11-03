"use client";

import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import {
  DEFAULT_PERSONA,
  DEFAULT_THEME,
  PERSONAS,
  PERSONA_IDS,
  THEMES,
  THEME_IDS,
  isPersonaId,
  isThemeId,
} from "@/lib/personalize";
import { cn } from "@/lib/utils";
import { PlusLock } from "./plus-lock";
import { cardClass, type Me, type Settings } from "./types";
import { t as tr } from "@/lib/i18n";

/** Pick the colour of the cards the bot sends and the way it talks (Pro and above). */
export function PersonalizeCard({
  me,
  settings,
  onSaved,
}: {
  me: Me;
  settings: Settings;
  onSaved: (s: Settings) => void;
}) {
  const { api } = useLiff();
  const locked = !me.features.personalize;
  const theme = isThemeId(settings.card_theme) ? settings.card_theme : DEFAULT_THEME;
  const persona = isPersonaId(settings.bot_persona) ? settings.bot_persona : DEFAULT_PERSONA;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const palette = THEMES[theme].palette;

  async function save(patch: Partial<Settings>) {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onSaved(saved);
      setNotice(tr("บันทึกแล้ว"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : tr("บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-label={tr("ธีมการ์ดและนิสัยบอท")}>
      <div>
        <h2 className="font-semibold">{tr("ธีมการ์ดและนิสัยบอท")}</h2>
        <p className="text-xs text-muted">{tr("เลือกสีการ์ดในแชทและน้ำเสียงที่บอทคุยกับคุณ")}</p>
      </div>

      {locked ? <PlusLock>{tr("เปลี่ยนสีการ์ดและนิสัยบอท")}</PlusLock> : null}

      <div
        className="overflow-hidden rounded-2xl border border-border text-sm"
        aria-label={tr("ตัวอย่างการ์ด")}
      >
        <div className="px-4 py-3" style={{ backgroundColor: palette.soft }}>
          <p className="font-bold" style={{ color: palette.headTitle }}>
            {tr("สรุปวันนี้")}
          </p>
          <p className="text-xs" style={{ color: palette.headSub }}>
            {tr("ตัวอย่างหัวการ์ด")}
          </p>
        </div>
        <div className="flex items-center justify-between bg-surface px-4 py-3">
          <span className="text-muted">{tr("รายจ่าย")}</span>
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: palette.primary }}
          >
            {tr("ดูรายละเอียด")}
          </span>
        </div>
      </div>

      <div role="radiogroup" aria-label={tr("ธีมสีการ์ด")} className="grid grid-cols-2 gap-2">
        {THEME_IDS.map((id) => {
          const t = THEMES[id];
          const disabled = busy || (locked && id !== DEFAULT_THEME);
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              disabled={disabled}
              onClick={() => theme !== id && save({ card_theme: id })}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm disabled:opacity-50",
                theme === id ? "border-primary bg-primary-soft font-semibold" : "border-border",
              )}
            >
              <span
                aria-hidden
                className="h-5 w-5 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: t.palette.primary }}
              />
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="radiogroup" aria-label={tr("นิสัยบอท")} className="space-y-2">
        {PERSONA_IDS.map((id) => {
          const p = PERSONAS[id];
          const disabled = busy || (locked && id !== DEFAULT_PERSONA);
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={persona === id}
              disabled={disabled}
              onClick={() => persona !== id && save({ bot_persona: id })}
              className={cn(
                "block min-h-11 w-full rounded-2xl border px-4 py-2 text-left text-sm disabled:opacity-50",
                persona === id ? "border-primary bg-primary-soft" : "border-border",
              )}
            >
              <span className="block font-semibold">{p.label}</span>
              <span className={cn("block text-xs", persona === id ? "text-primary" : "text-muted")}>
                “{p.sample}”
              </span>
            </button>
          );
        })}
      </div>

      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
