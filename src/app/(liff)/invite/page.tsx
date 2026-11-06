"use client";

import { ArrowLeft, Copy, Link2, Share2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass, type Me } from "@/components/liff/settings/types";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { REFERRAL_BONUS_REFEREE, REFERRAL_BONUS_REFERRER } from "@/lib/config";
import { t } from "@/lib/i18n";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;
const LINK = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

const STEPS = [
  { n: 1, title: t("ส่งคำชวนให้เพื่อน"), sub: t("กดแชร์ผ่าน LINE") },
  { n: 2, title: t("เพื่อนเพิ่มเพื่อน"), sub: t("แล้วพิมพ์ “ใช้รหัส” ของคุณ") },
  { n: 3, title: t("รับเหรียญสะสมทั้งคู่"), sub: t("เมื่อเพื่อนจดรายการแรก") },
] as const;

export default function InvitePage() {
  const me = useApi<Me>("/api/me");

  return (
    <main className="pb-28">
      <header className="relative overflow-hidden bg-gradient-to-b from-warn-soft to-primary-soft px-4 pb-12 pt-4">
        <Link
          href="/settings"
          aria-label={t("กลับไปหน้าตั้งค่า")}
          className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-surface/80"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="mt-1 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/phook-invite.png"
            alt=""
            aria-hidden
            width={120}
            height={116}
            className="h-[116px] w-[120px] shrink-0 object-contain"
          />
          <h1 className="text-xl font-extrabold leading-snug text-primary">
            {t("ชวนเพื่อนมาจดใช้งาน")}
            <span className="block text-foreground">{t("รับเหรียญสะสมฟรี!")}</span>
          </h1>
        </div>
      </header>

      <div className="relative -mt-10 space-y-4 px-4">
        {me.loading && !me.data ? <LoadingBlock rows={4} /> : null}
        {me.error && !me.data ? <ErrorState message={me.error} onRetry={me.reload} /> : null}
        {me.data ? <Content me={me.data} onChanged={me.reload} /> : null}
      </div>
    </main>
  );
}

function Content({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { api } = useLiff();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const shareText =
    t(
      'มาจดรายรับรายจ่ายง่าย ๆ ในไลน์กับพี่ฮูก (P\'Hook) ด้วยกันนะ เพิ่มเพื่อนแล้วพิมพ์ "ใช้รหัส {0}" ทั้งคู่ได้โบนัสเหรียญสะสม',
      me.referralCode,
    ) + (LINK ? `\n${LINK}` : "");

  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(done);
    } catch {
      setNotice(t("คัดลอกอัตโนมัติไม่ได้ ลองกดค้างที่ข้อความเพื่อคัดลอกนะ"));
    }
  }

  async function apply() {
    if (!code.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ message: string }>("/api/referral", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setNotice(res.message);
      setCode("");
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ใช้รหัสไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        aria-label={t("สถิติการชวนเพื่อน")}
        className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card"
      >
        {me.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.pictureUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
          >
            <Users className="h-5 w-5" />
          </span>
        )}
        <dl className="min-w-0 flex-1 space-y-0.5 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("เพื่อนที่ชวนสำเร็จแล้ว")}</dt>
            <dd className="num font-bold">
              {me.referrals} {t("คน")}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("เหรียญสะสมของคุณ")}</dt>
            <dd className="num font-bold">{me.points}</dd>
          </div>
        </dl>
      </section>

      <section className={cardClass} aria-label={t("สิทธิประโยชน์ที่ได้รับ")}>
        <h2 className="mx-auto rounded-full bg-warn-soft px-5 py-1.5 text-center font-semibold text-warn">
          {t("สิทธิประโยชน์ที่ได้รับ")}
        </h2>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-2xl bg-primary-soft p-3">
            <p className="text-xs text-muted">{t("คุณได้รับ")}</p>
            <p className="num text-lg font-bold text-primary">
              +{REFERRAL_BONUS_REFERRER} {t("เหรียญ")}
            </p>
          </div>
          <div className="rounded-2xl bg-warn-soft p-3">
            <p className="text-xs text-muted">{t("เพื่อนได้รับ")}</p>
            <p className="num text-lg font-bold text-warn">
              +{REFERRAL_BONUS_REFEREE} {t("เหรียญ")}
            </p>
          </div>
        </div>
      </section>

      <section aria-label={t("ชวนเพื่อนง่าย ๆ ใน 3 ขั้นตอน")} className="space-y-3">
        <h2 className="text-center font-bold">{t("ชวนเพื่อนง่าย ๆ ใน 3 ขั้นตอน")}</h2>
        <ol className="grid grid-cols-3 gap-2 text-center">
          {STEPS.map((s) => (
            <li key={s.n} className="space-y-1">
              <span className="num mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
                {s.n}
              </span>
              <p className="text-xs font-semibold">{s.title}</p>
              <p className="text-[11px] leading-snug text-muted">{s.sub}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={cardClass} aria-label={t("รหัสชวนเพื่อนของคุณ")}>
        <div className="space-y-2 rounded-2xl bg-primary-soft p-3">
          <p className="text-sm font-semibold">{t("รหัสชวนของคุณ")}</p>
          <div className="flex items-center gap-2">
            <p
              className="num min-w-0 flex-1 select-all rounded-xl bg-surface px-3 py-2 text-center text-xl font-bold tracking-widest"
              aria-label={t("รหัสชวนเพื่อนของคุณ")}
            >
              {me.referralCode}
            </p>
            <button
              type="button"
              onClick={() => copy(me.referralCode, t("คัดลอกรหัสแล้ว"))}
              aria-label={t("คัดลอกรหัส")}
              className="flex h-11 shrink-0 items-center gap-1 rounded-xl bg-surface px-3 text-sm font-semibold text-primary"
            >
              <Copy className="h-4 w-4" aria-hidden />
              {t("คัดลอก")}
            </button>
          </div>
        </div>

        <a
          href={`https://line.me/R/share?text=${encodeURIComponent(shareText)}`}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary font-semibold text-surface"
        >
          <Share2 className="h-4 w-4" aria-hidden />
          {t("ส่งคำชวนผ่าน LINE")}
        </a>
        <button
          type="button"
          onClick={() => copy(shareText, t("คัดลอกข้อความชวนแล้ว"))}
          className="flex h-11 w-full items-center justify-center gap-2 text-sm font-semibold"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          {t("คัดลอกลิงก์ชวนเพื่อน")}
        </button>
      </section>

      {!me.referred ? (
        <section className={cardClass} aria-label={t("กรอกรหัสจากเพื่อน")}>
          <h2 className="font-semibold">{t("มีรหัสจากเพื่อน?")}</h2>
          <p className="text-xs text-muted">
            {t("ใช้ได้ภายในไม่กี่วันแรกหลังเริ่มใช้งาน พอจดรายการแรก ทั้งคู่ได้โบนัสเหรียญสะสม")}
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={16}
              placeholder={t("เช่น ABCD1234")}
              aria-label={t("รหัสของเพื่อน")}
              autoCapitalize="characters"
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={apply}
              disabled={busy || code.trim().length < 4}
              className="h-12 rounded-2xl bg-primary px-4 text-sm font-semibold text-surface disabled:opacity-60"
            >
              {t("ใช้รหัส")}
            </button>
          </div>
        </section>
      ) : (
        <p className="text-center text-xs text-muted">{t("คุณใช้รหัสชวนเพื่อนแล้ว")}</p>
      )}

      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
    </>
  );
}
