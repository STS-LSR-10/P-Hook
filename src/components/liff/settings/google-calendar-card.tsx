"use client";

import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass } from "./types";
import { t } from "@/lib/i18n";

interface GoogleStatus {
  available: boolean;
  linked: boolean;
  email: string | null;
}

/**
 * Which Google account reminders are added to, and signing out of it. Hidden while Google is not set
 * up here. Signing in happens from a reminder's "เพิ่มลงปฏิทิน" button (it needs the phone's browser).
 */
export function GoogleCalendarCard() {
  const status = useApi<GoogleStatus>("/api/google");
  const { api } = useLiff();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (status.loading || status.error || !status.data?.available) return null;
  const { linked, email } = status.data;

  async function unlink() {
    if (
      !window.confirm(
        t(
          "ยกเลิกการเชื่อม Google Calendar? เตือนที่เพิ่มไปแล้วยังอยู่ในปฏิทิน แต่จะไม่เปลี่ยนตามอีก",
        ),
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api("/api/google", { method: "DELETE" });
      setNotice(t("ยกเลิกการเชื่อมแล้ว"));
      status.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำไม่สำเร็จ ลองใหม่อีกครั้งนะ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-label="Google Calendar">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Google Calendar</h3>
          <p className="break-words text-xs text-muted">
            {linked
              ? t(
                  "เชื่อมกับ {0} เตือนที่เพิ่มลงปฏิทินจะเปลี่ยนตามเมื่อแก้หรือยกเลิก",
                  email ?? "Google",
                )
              : t("ยังไม่ได้เชื่อม กด เพิ่มลงปฏิทิน บนการ์ดเตือน เพื่อเชื่อม")}
          </p>
        </div>
        {linked ? (
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-50"
          >
            {busy ? t("กำลังยกเลิก…") : t("ยกเลิกการเชื่อม")}
          </button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="mt-2 text-xs text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
