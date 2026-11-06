"use client";

import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { cleanCallName, MAX_CALL_NAME } from "@/lib/personalize";
import { t as tr } from "@/lib/i18n";
import { PlusLock } from "./plus-lock";
import { cardClass, fieldClass, type Me, type Settings } from "./types";

const QUICK_NAMES = ["เจ้านาย", "พี่", "น้อง", "ตัวเอง"] as const;

/** The name พี่ฮูก calls the person by (Pro and above, with the manner). The bot's own name is fixed. */
export function CallNameCard({
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
  const saved = cleanCallName(settings.call_name) ?? "";
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = draft.trim();
  const tooLong = [...shown].length > MAX_CALL_NAME;
  const dirty = shown !== saved;

  async function save(value: string) {
    setBusy(true);
    setNotice(null);
    try {
      const next = await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ call_name: value.trim() === "" ? null : value.trim() }),
      });
      onSaved(next);
      setDraft(cleanCallName(next.call_name) ?? "");
      setNotice({ ok: true, text: tr("บันทึกแล้ว") });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : tr("บันทึกไม่สำเร็จ") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-label={tr("ชื่อที่ให้พี่ฮูกเรียกคุณ")}>
      <div>
        <h2 className="font-semibold">{tr("ชื่อที่ให้พี่ฮูกเรียกคุณ")}</h2>
        <p className="text-xs text-muted">
          {tr("พี่ฮูกจะใช้ชื่อนี้เวลาตอบและเตือนเรื่องงบในแชท LINE")}
        </p>
      </div>

      {locked ? <PlusLock>{tr("ตั้งชื่อที่ให้พี่ฮูกเรียกคุณ")}</PlusLock> : null}

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-3 py-2">
        <span aria-hidden className="text-2xl">
          🦉
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{tr("ชื่อบอทประจำระบบ")}</p>
          <p className="font-semibold">{tr("พี่ฮูก (P-Hook AI)")}</p>
        </div>
        <span className="rounded-lg border border-border px-2 py-1 text-xs text-muted">
          {tr("ถาวร")}
        </span>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">{tr("ให้พี่ฮูกเรียกคุณว่าอะไร?")}</span>
        <input
          type="text"
          value={draft}
          disabled={locked || busy}
          maxLength={MAX_CALL_NAME + 10}
          placeholder={tr("เช่น คุณบาส, พี่สุข, เจ้านาย")}
          onChange={(e) => {
            setDraft(e.target.value);
            setNotice(null);
          }}
          className={fieldClass}
          aria-invalid={tooLong}
        />
      </label>
      {tooLong ? (
        <p role="alert" className="text-xs text-danger">
          {tr("ไม่เกิน {0} ตัวอักษร", MAX_CALL_NAME)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{tr("กดเลือกด่วน:")}</span>
        {QUICK_NAMES.map((n) => (
          <button
            key={n}
            type="button"
            disabled={locked || busy}
            onClick={() => {
              setDraft(n);
              setNotice(null);
            }}
            className="min-h-9 rounded-xl bg-background px-3 text-sm disabled:opacity-50"
          >
            {n}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-primary-soft px-3 py-2 text-sm">
        <p className="text-xs font-semibold text-primary">{tr("ตัวอย่างข้อความของพี่ฮูก")}</p>
        <p data-testid="call-name-preview">
          “{tr("สวัสดีครับ")}
          {shown && !tooLong ? ` ${shown}` : ""}
          {tr("! วันนี้พี่ฮูกพร้อมช่วยจดบันทึกรายรับ-รายจ่ายแล้วครับ")} 🦉”
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={locked || busy || !dirty || tooLong}
          onClick={() => save(draft)}
          className="min-h-11 flex-1 rounded-2xl bg-primary px-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? tr("กำลังบันทึก…") : tr("บันทึกชื่อ")}
        </button>
        {saved ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => save("")}
            className="min-h-11 rounded-2xl border border-border px-4 disabled:opacity-50"
          >
            {tr("ลบชื่อ")}
          </button>
        ) : null}
      </div>

      {notice ? (
        <p
          role="status"
          className={
            notice.ok
              ? "rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              : "rounded-2xl bg-red-50 px-4 py-2 text-sm text-danger"
          }
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
