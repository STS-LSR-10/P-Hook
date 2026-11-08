"use client";

import { Check } from "lucide-react";
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
  cleanCallName,
  isThemeId,
  withName,
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
  const chosen = PERSONAS[persona];
  const name = cleanCallName(settings.call_name);

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
        <p className="text-xs text-muted">
          {tr("เลือกสีการ์ดสรุปในแชท และน้ำเสียงที่พี่ฮูกใช้คุยกับคุณ")}
        </p>
      </div>

      {locked ? <PlusLock>{tr("เปลี่ยนสีการ์ดและนิสัยบอท")}</PlusLock> : null}

      <div className="rounded-2xl border border-border bg-background p-3">
        <p className="mb-2 text-xs text-muted">{tr("ตัวอย่างการ์ดตอบกลับใน LINE")}</p>
        <div
          className="overflow-hidden rounded-2xl border border-border bg-surface text-sm"
          aria-label={tr("ตัวอย่างการ์ด")}
        >
          <div
            className="flex items-start justify-between gap-2 px-4 py-3"
            style={{ backgroundColor: palette.soft }}
          >
            <div className="min-w-0">
              <p className="font-bold" style={{ color: palette.headTitle }}>
                {tr("สรุปวันนี้")}
              </p>
              <p className="text-xs" style={{ color: palette.headSub }}>
                {tr("ตัวอย่างหัวการ์ดในแชท")}
              </p>
            </div>
            <span
              className="num shrink-0 rounded-full bg-white/70 dark:bg-white/10 px-2.5 py-0.5 text-xs font-semibold"
              style={{ color: palette.headTitle }}
            >
              ฿ 350.00
            </span>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted">{tr("รายการล่าสุด: ชาเขียวมัทฉะ")}</span>
              <span className="num font-bold">-65 ฿</span>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-border bg-background p-2.5">
              <span aria-hidden className="text-lg leading-none">
                🦉
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold">
                  {tr("พี่ฮูก")}{" "}
                  <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {chosen.label} {chosen.emoji}
                  </span>
                </p>
                <p className="mt-0.5 text-xs italic" data-testid="persona-quote">
                  “{withName(chosen.sample, name)}”
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{tr("บันทึกอัตโนมัติแล้ว")}</span>
              <span
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: palette.primary }}
              >
                {tr("ดูรายละเอียด")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-sm font-semibold">{tr("สีธีมการ์ด")}</p>
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
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border"
                style={{ backgroundColor: t.palette.primary }}
              >
                {theme === id ? <Check className="h-3 w-3 text-white" aria-hidden /> : null}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{tr("น้ำเสียงและนิสัยของพี่ฮูก")}</p>
        <p className="text-xs text-muted">{tr("เลือกได้ 1 แบบ")}</p>
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
                "block min-h-11 w-full rounded-2xl border px-3 py-3 text-left text-sm disabled:opacity-50",
                persona === id ? "border-primary bg-primary-soft" : "border-border",
              )}
            >
              <span className="flex items-start gap-2">
                <span aria-hidden className="text-xl leading-none">
                  {p.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {p.label}
                    {p.badge ? (
                      <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {p.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted">{p.desc}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    persona === id
                      ? "border-primary bg-primary text-white dark:text-surface"
                      : "border-border",
                  )}
                >
                  {persona === id ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
                </span>
              </span>
              <span
                className={cn(
                  "mt-2 block rounded-xl bg-background px-2.5 py-1.5 text-xs",
                  persona === id ? "text-primary" : "text-muted",
                )}
              >
                “{withName(p.sample, name)}”
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
