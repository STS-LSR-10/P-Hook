"use client";

import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { MAX_FEEDBACK_LENGTH } from "@/lib/feedback";
import { t } from "@/lib/i18n";

/** Write a suggestion or comment for the team. They know who sent it, so no contact details are asked. */
export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const { api } = useLiff();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/feedback", { method: "POST", body: JSON.stringify({ body }) });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ส่งไม่สำเร็จ ลองใหม่อีกครั้งนะ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t("💡 เสนอแนะ")} onClose={onClose}>
      {sent ? (
        <>
          <p role="status" className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
            {t("ขอบคุณที่ช่วยพี่ฮูกพัฒนา 🦉")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface"
          >
            {t("ปิด")}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            {t(
              "บอกทีมงานได้เลยว่าอยากให้มีหรือปรับอะไร ทีมงานเห็นว่าใครส่ง จึงตอบกลับทาง LINE ได้",
            )}
          </p>
          <label className="block">
            <span className="sr-only">{t("ข้อเสนอแนะ")}</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_FEEDBACK_LENGTH}
              rows={6}
              placeholder={t("เช่น อยากให้มีโหมดมืด")}
              className="w-full rounded-2xl border border-border bg-background p-4 outline-none focus:border-primary"
            />
          </label>
          <p className="num text-right text-xs text-muted">
            {body.length}/{MAX_FEEDBACK_LENGTH}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-expense">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || body.trim() === ""}
            onClick={send}
            className="h-12 w-full rounded-2xl bg-primary font-semibold text-surface disabled:opacity-40"
          >
            {busy ? t("กำลังส่ง…") : t("ส่งข้อเสนอแนะ")}
          </button>
        </>
      )}
    </Sheet>
  );
}
