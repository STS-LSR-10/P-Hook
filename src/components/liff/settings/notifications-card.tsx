"use client";

import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { PlusLock } from "./plus-lock";
import { Switch } from "./switch";
import { cardClass, type Me, type Settings } from "./types";
import { t } from "@/lib/i18n";

const DEFAULT_TIME = "20:00";

type Key = "weekly_summary_enabled" | "monthly_summary_enabled";

/**
 * The daily "you have not recorded today" reminder and the weekly / monthly summaries pushed to the
 * chat, in one card (Pro and above; turning them off is always allowed).
 */
export function NotificationsCard({
  me,
  settings,
  onSaved,
}: {
  me: Me;
  settings: Settings;
  onSaved: (s: Settings) => void;
}) {
  const { api } = useLiff();
  const reminderLocked = !me.features.dailyReminder;
  const summaryLocked = !me.features.autoSummary;
  const reminderOn = settings.daily_reminder_enabled;
  const time = (settings.daily_reminder_time ?? DEFAULT_TIME).slice(0, 5);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const monthlyDay =
    settings.budget_cycle === "weekly"
      ? t("วันที่ 1 ของเดือน")
      : t("วันที่ {0} ของเดือน", settings.cycle_start_day);

  async function save(patch: Partial<Settings>) {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onSaved(saved);
      setNotice(t("บันทึกแล้ว"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  const summaries: { key: Key; label: string; hint: string }[] = [
    {
      key: "weekly_summary_enabled",
      label: t("สรุปรายสัปดาห์"),
      hint: t("ส่งทุกวันจันทร์ 09:00 น. สรุปสัปดาห์ที่ผ่านมา"),
    },
    {
      key: "monthly_summary_enabled",
      label: t("สรุปรายเดือน"),
      hint: t("ส่ง{0} 09:00 น. สรุปรอบงบที่ผ่านมา", monthlyDay),
    },
  ];

  return (
    <section className={cardClass} aria-label={t("การแจ้งเตือนและสรุปอัตโนมัติ")}>
      <h2 className="font-semibold">{t("การแจ้งเตือนและสรุปอัตโนมัติ")}</h2>

      <div className="divide-y divide-border">
        <div className="space-y-2 py-2.5 first:pt-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("เตือนจดประจำวัน")}</p>
              <p className="text-xs text-muted">{t("ส่งข้อความเตือนในแชตถ้าวันนั้นยังไม่ได้จด")}</p>
            </div>
            <Switch
              checked={reminderOn}
              label={t("เปิดเตือนจดประจำวัน")}
              disabled={busy || (reminderLocked && !reminderOn)}
              onChange={(on) =>
                save(
                  on
                    ? { daily_reminder_enabled: true, daily_reminder_time: time }
                    : { daily_reminder_enabled: false },
                )
              }
            />
          </div>
          {!reminderLocked && reminderOn ? (
            <label className="flex items-center justify-between gap-3 text-xs text-muted">
              <span>{t("เวลาที่เตือน")}</span>
              <input
                type="time"
                value={time}
                disabled={busy}
                onChange={(e) => e.target.value && save({ daily_reminder_time: e.target.value })}
                className="num h-10 w-28 rounded-lg border border-border bg-background px-2 text-sm font-semibold text-primary"
              />
            </label>
          ) : null}
        </div>

        {summaries.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-3 py-2.5 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted">{hint}</p>
            </div>
            <Switch
              checked={settings[key]}
              label={t("เปิด{0}", label)}
              disabled={busy || (summaryLocked && !settings[key])}
              onChange={(on) => save({ [key]: on })}
            />
          </div>
        ))}
      </div>

      {reminderLocked || summaryLocked ? (
        <PlusLock>{t("เตือนจดประจำวันตามเวลาที่ตั้ง และรับสรุปรายสัปดาห์/รายเดือนในแชต")}</PlusLock>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
