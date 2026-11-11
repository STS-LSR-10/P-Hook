"use client";

import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { CHEAPEST_PACK, PASS_PACKS } from "@/lib/config";
import { cardClass, type Me } from "./types";
import { t } from "@/lib/i18n";

/** HookCoins traded for a Pro Pass. */
export function RedeemCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { api } = useLiff();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function redeem(pack: (typeof PASS_PACKS)[number]) {
    setBusy(true);
    setNotice(null);
    try {
      await api("/api/points/redeem", { method: "POST", body: JSON.stringify({ pack: pack.id }) });
      setNotice(t("แลกแล้ว +{0} วัน Pro", pack.days));
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
          {t("ตอนนี้มี")} {me.points} {t("ฮูกคอยน์")}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PASS_PACKS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => redeem(p)}
            disabled={busy || me.points < p.coins}
            className="rounded-2xl bg-primary px-2 py-2 text-surface disabled:opacity-50"
          >
            <span className="num block text-base font-bold">
              {p.days} {t("วัน")}
            </span>
            <span className="num block text-xs">
              {p.coins} {t("ฮูกคอยน์")}
            </span>
          </button>
        ))}
      </div>
      {me.points < CHEAPEST_PACK ? (
        <p className="text-xs text-muted">{t("สะสมครบ {0} ฮูกคอยน์ก็แลกได้แล้ว", CHEAPEST_PACK)}</p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
