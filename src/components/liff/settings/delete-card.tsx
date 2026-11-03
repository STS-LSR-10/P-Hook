"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { DELETE_CONFIRM_PHRASE, isDeleteConfirmed } from "@/lib/account-confirm";
import { cardClass, fieldClass } from "./types";
import { t } from "@/lib/i18n";

/** Delete-everything flow: warning -> type the phrase -> done. Two deliberate steps. */
export function DeleteCard() {
  const { api } = useLiff();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function close() {
    if (busy) return;
    setStep(0);
    setPhrase("");
    setError(null);
  }

  async function erase() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/delete", {
        method: "POST",
        body: JSON.stringify({ confirm: phrase }),
      });
      setStep(0);
      setDone(true);
      try {
        const liff = (await import("@line/liff")).default;
        if (liff.isInClient()) setTimeout(() => liff.closeWindow(), 2500);
      } catch {
        // the confirmation text stays on screen
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ลบไม่สำเร็จ"));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className={cardClass} role="status">
        <p className="font-semibold">{t("ลบข้อมูลทั้งหมดแล้ว")}</p>
        <p className="text-sm text-muted">
          {t("ขอบคุณที่ใช้พี่ฮูก ถ้าอยากกลับมาใช้ใหม่ แค่พิมพ์ข้อความในแชทได้เลย")}
        </p>
      </section>
    );
  }

  return (
    <section className={cardClass} aria-label={t("ข้อมูลและความเป็นส่วนตัว")}>
      <h2 className="font-semibold">{t("ข้อมูลและความเป็นส่วนตัว")}</h2>
      <p className="text-sm text-muted">
        {t("อ่าน")}{" "}
        <Link href="/privacy" className="font-medium text-primary underline">
          {t("นโยบายความเป็นส่วนตัว")}
        </Link>{" "}
        {t("และ")}{" "}
        <Link href="/terms" className="font-medium text-primary underline">
          {t("ข้อกำหนดการใช้งาน")}
        </Link>
      </p>
      <button
        type="button"
        onClick={() => setStep(1)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-expense text-sm font-semibold text-expense"
      >
        <Trash2 className="h-4 w-4" aria-hidden /> {t("ลบข้อมูลทั้งหมด")}
      </button>

      {step === 1 ? (
        <Sheet title={t("ลบข้อมูลทั้งหมด?")} onClose={close}>
          <div className="space-y-3">
            <p className="text-sm">
              {t("ระบบจะลบ")}{" "}
              <strong>
                {t("รายการ หมวด งบ รายการประจำ สลิป (รวมรูป) แต้ม และการตั้งค่าทั้งหมด")}
              </strong>{" "}
              {t("ของคุณอย่างถาวร")} <strong>{t("กู้คืนไม่ได้")}</strong>
            </p>
            <p className="text-sm text-muted">
              {t('ถ้าอยากเก็บสำเนาไว้ ให้ส่งออกไฟล์ก่อนที่หน้า "รายการ" (ไอคอนดาวน์โหลด)')}
            </p>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="h-12 w-full rounded-2xl bg-expense text-base font-semibold text-surface"
            >
              {t("ดำเนินการต่อ")}
            </button>
            <button
              type="button"
              onClick={close}
              className="h-12 w-full rounded-2xl border border-border text-base font-medium"
            >
              {t("ยกเลิก")}
            </button>
          </div>
        </Sheet>
      ) : null}

      {step === 2 ? (
        <Sheet title={t("ยืนยันอีกครั้ง")} onClose={close}>
          <div className="space-y-3">
            <label className="block text-sm" htmlFor="delete-phrase">
              {t("พิมพ์")} <strong>{DELETE_CONFIRM_PHRASE}</strong> {t("เพื่อยืนยัน")}
            </label>
            <input
              id="delete-phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              className={fieldClass}
            />
            {error ? (
              <p role="alert" className="text-sm text-expense">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              onClick={erase}
              disabled={busy || !isDeleteConfirmed(phrase)}
              className="h-12 w-full rounded-2xl bg-expense text-base font-semibold text-surface disabled:opacity-40"
            >
              {busy ? t("กำลังลบ...") : t("ลบข้อมูลทั้งหมดถาวร")}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="h-12 w-full rounded-2xl border border-border text-base font-medium"
            >
              {t("ยกเลิก")}
            </button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
