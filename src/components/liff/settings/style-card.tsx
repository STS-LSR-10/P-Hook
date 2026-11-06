"use client";

import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { LoadingBlock } from "@/components/liff/states";
import { Switch } from "./switch";
import { cardClass } from "./types";
import { t } from "@/lib/i18n";

interface StyleStatus {
  enabled: boolean;
  seen: number;
  habits: string[];
}

const LABELS: Record<string, () => string> = {
  amount_first: () => t("มักพิมพ์จำนวนเงินไว้หน้าชื่อ เช่น 50 กาแฟ"),
  amount_last: () => t("มักพิมพ์จำนวนเงินไว้หลังชื่อ เช่น กาแฟ 50"),
  thai_digits: () => t("มักพิมพ์เลขไทย"),
  k_word: () => t("ใช้ k แทนพัน เช่น 25k"),
  thousand_word: () => t("ใช้คำว่า พัน เช่น 12พัน"),
  baht: () => t("มักลงท้ายจำนวนเงินด้วย บาท"),
};

/**
 * What the bot noticed about how this person types an entry. Counts only, never their words. It can
 * be switched off (which forgets it) or cleared.
 */
export function StyleCard() {
  const status = useApi<StyleStatus>("/api/style");
  const { api } = useLiff();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(call: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      await call();
      setNotice(done);
      status.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำไม่สำเร็จ ลองใหม่อีกครั้งนะ"));
    } finally {
      setBusy(false);
    }
  }

  const data = status.data;
  return (
    <section className={cardClass} aria-label={t("จำสไตล์การพิมพ์")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t("จำสไตล์การพิมพ์")}</h3>
          <p className="break-words text-xs text-muted">
            {t(
              "บอทสังเกตวิธีที่คุณพิมพ์รายการ เก็บเป็นตัวเลขสรุปเท่านั้น ไม่เก็บข้อความของคุณ แล้วบอก AI ให้อ่านข้อความได้แม่นขึ้น",
            )}
          </p>
        </div>
        {data ? (
          <Switch
            checked={data.enabled}
            disabled={busy}
            label={t("จำสไตล์การพิมพ์ของฉัน")}
            onChange={(next) =>
              run(
                () => api("/api/style", { method: "PUT", body: JSON.stringify({ enabled: next }) }),
                next ? t("เปิดแล้ว") : t("ปิดและลืมที่จำไว้แล้ว"),
              )
            }
          />
        ) : null}
      </div>

      {status.loading && !data ? (
        <div className="mt-3">
          <LoadingBlock rows={1} />
        </div>
      ) : status.error && !data ? (
        <p role="alert" className="mt-3 text-xs text-danger">
          {status.error}{" "}
          <button type="button" onClick={status.reload} className="font-semibold underline">
            {t("ลองอีกครั้ง")}
          </button>
        </p>
      ) : data ? (
        <div className="mt-3 space-y-2">
          {data.enabled && data.habits.length === 0 ? (
            <p className="text-xs text-muted">
              {t("ยังเรียนรู้ไม่พอ พิมพ์จดไปอีกสักพัก แล้วจะเห็นที่นี่")}
            </p>
          ) : null}
          {data.habits.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.habits.map((h) => (
                <li key={h}>{LABELS[h]?.() ?? h}</li>
              ))}
            </ul>
          ) : null}
          {data.enabled && data.seen > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted">{t("สังเกตจาก {0} ข้อความ", data.seen)}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => api("/api/style", { method: "DELETE" }), t("ล้างแล้ว"))}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted disabled:opacity-50"
              >
                {t("ล้างที่จำไว้")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-2 text-xs text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
