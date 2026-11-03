"use client";

import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { cardClass, type Me } from "./types";
import { t } from "@/lib/i18n";

/** Coins traded for days of Pro. */
export function RedeemCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { api } = useLiff();
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const maxDays = Math.min(me.redeem.days, 365);

  async function redeem() {
    setBusy(true);
    setNotice(null);
    try {
      await api("/api/points/redeem", { method: "POST", body: JSON.stringify({ days }) });
      setNotice(t("แลกแล้ว +{0} วัน Pro", days));
      setDays(1);
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("แลกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-label={t("แลกเหรียญเป็นวันใช้ Pro")}>
      <div>
        <h3 className="text-sm font-semibold">{t("แลกเหรียญเป็นวันใช้ Pro")}</h3>
        <p className="text-xs text-muted">
          {t("สะสมครบ")} {me.redeem.pointsPerDay}{" "}
          {t("แต้มแลกได้ 1 วัน · ทุกวันที่จดรายการได้ 1 แต้ม")}
        </p>
      </div>
      {maxDays > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label={t("จำนวนวันที่จะแลก")}
            className="num h-11 w-28 rounded-2xl border border-border bg-background px-3"
          >
            {Array.from({ length: Math.min(maxDays, 30) }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} {t("วัน")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={redeem}
            disabled={busy}
            className="h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-surface disabled:opacity-60"
          >
            {t("แลก (")}
            {days * me.redeem.pointsPerDay} {t("แต้ม)")}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">
          {t("ตอนนี้มี")} {me.points} {t("แต้ม ยังไม่พอแลก")}
        </p>
      )}
      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
