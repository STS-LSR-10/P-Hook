"use client";

import { ArrowLeft, Copy, Link2, Share2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass, type Me } from "@/components/liff/settings/types";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import {
  DAILY_POINT,
  FIRST_BUDGET_BONUS,
  FIRST_SLIP_BONUS,
  PAID_REFERRAL_COINS,
  PAID_REFERRAL_DAYS,
  PAID_REFERRAL_MONTHLY_CAP,
  PASS_PACKS,
  REFERRAL_BONUS_REFEREE,
  REFERRAL_BONUS_REFERRER,
  REFERRAL_MONTHLY_CAP,
  SHARE_BONUS,
  STREAK_MONTH_BONUS,
  STREAK_MONTH_DAYS,
  STREAK_WEEK_BONUS,
  STREAK_WEEK_DAYS,
  addFriendUrl,
} from "@/lib/config";
import { t } from "@/lib/i18n";
import { buildInviteFlex, inviteText } from "@/lib/line/invite-flex";

// The add-friend page, not the LIFF app: a friend who is not yet a friend of the bot must land on "add".
const LINK = addFriendUrl();

const STEPS = [
  { n: 1, title: t("ส่งคำชวนให้เพื่อน"), sub: t("กดแชร์ผ่าน LINE") },
  { n: 2, title: t("เพื่อนเพิ่มเพื่อน"), sub: t("แล้วพิมพ์ “ใช้รหัส” ของคุณ") },
  { n: 3, title: t("รับฮูกคอยน์ทั้งคู่"), sub: t("เมื่อเพื่อนจดรายการแรก") },
] as const;

/** How HookCoins are earned: what you do, how many coins, and the limit that goes with it. */
const EARN_ROWS = [
  { what: t("จดรายการแรกของวัน"), coins: DAILY_POINT, rule: t("วันละ 1 ครั้ง") },
  {
    what: t("จดครบ {0} วันติดกัน", STREAK_WEEK_DAYS),
    coins: STREAK_WEEK_BONUS,
    rule: t("ทุกสัปดาห์ ถ้าขาดวันไหนเริ่มนับใหม่"),
  },
  {
    what: t("จดครบ {0} วันติดกัน", STREAK_MONTH_DAYS),
    coins: STREAK_MONTH_BONUS,
    rule: t("ถ้าขาดวันไหนเริ่มนับใหม่"),
  },
  { what: t("สแกนสลิปสำเร็จครั้งแรก"), coins: FIRST_SLIP_BONUS, rule: t("ครั้งเดียวต่อบัญชี") },
  {
    what: t("ตั้งงบประมาณรายเดือนครั้งแรก"),
    coins: FIRST_BUDGET_BONUS,
    rule: t("ครั้งเดียวต่อบัญชี"),
  },
  {
    what: t("ชวนเพื่อน (เมื่อเพื่อนจดรายการแรก)"),
    coins: REFERRAL_BONUS_REFERRER,
    rule: t(
      "เดือนละไม่เกิน {0} คน เพื่อนได้ด้วย +{1}",
      REFERRAL_MONTHLY_CAP,
      REFERRAL_BONUS_REFEREE,
    ),
  },
  {
    what: t("เพื่อนที่ชวนซื้อแผน (จ่ายเงินครั้งแรก)"),
    coins: PAID_REFERRAL_COINS,
    rule: t(
      "คุณได้ Pro เพิ่ม {0} วัน เพื่อนก็ได้ Pro เพิ่ม {0} วันด้วย (เดือนละไม่เกิน {1} คน)",
      PAID_REFERRAL_DAYS,
      PAID_REFERRAL_MONTHLY_CAP,
    ),
  },
  {
    what: t("แชร์สรุปประจำเดือนลงโซเชียล"),
    coins: SHARE_BONUS,
    rule: t("เดือนละ 1 ครั้ง (กดปุ่มแชร์ในหน้าสรุป)"),
  },
];

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
            <span className="block text-foreground">{t("รับฮูกคอยน์ฟรี!")}</span>
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

  const shareText = inviteText(me.referralCode, LINK);

  const shareHref = `https://line.me/R/share?text=${encodeURIComponent(shareText)}`;

  // The card (picture + button) when the LINE app allows it; otherwise the plain-text link.
  const [sending, setSending] = useState(false);
  async function sendInvite(textHref: string) {
    if (sending) return; // a second tap while the picker is open
    setSending(true);
    try {
      const liff = (await import("@line/liff")).default;
      if (liff.isApiAvailable("shareTargetPicker")) {
        await liff.shareTargetPicker(
          [
            buildInviteFlex({
              code: me.referralCode,
              addFriendLink: LINK,
              imageUrl: `${window.location.origin}/phook-invite-card.jpg`,
            }) as never,
          ],
          { isMultiple: true },
        );
        setSending(false);
        return;
      }
    } catch {
      // not in the LINE app, or the picker failed: fall through to the text link
    }
    setSending(false);
    window.location.assign(textHref);
  }

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
            <dt className="text-muted">{t("ฮูกคอยน์ของคุณ")}</dt>
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

      <section className={cardClass} aria-label={t("วิธีสะสมฮูกคอยน์")}>
        <h2 className="font-semibold">{t("วิธีสะสมฮูกคอยน์")}</h2>
        <ul className="divide-y divide-border">
          {EARN_ROWS.map((r) => (
            <li key={r.what} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{r.what}</p>
                <p className="text-xs text-muted">{r.rule}</p>
              </div>
              <span className="num shrink-0 rounded-full bg-primary-soft px-3 py-1 text-sm font-bold text-primary">
                +{r.coins}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={cardClass} aria-label={t("แลกฮูกคอยน์เป็น Pro Pass")}>
        <h2 className="font-semibold">{t("แลกฮูกคอยน์เป็น Pro Pass")}</h2>
        <ul className="divide-y divide-border">
          {PASS_PACKS.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm font-semibold">{t("Pro Pass {0} วัน", p.days)}</span>
              <span className="num text-sm font-bold text-warn">
                {p.coins} {t("ฮูกคอยน์")}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/settings" className="block text-center text-sm font-semibold text-primary">
          {t("ไปแลกที่หน้าตั้งค่า")}
        </Link>
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
          href={shareHref}
          onClick={(e) => {
            e.preventDefault();
            void sendInvite(shareHref);
          }}
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
            {t("ใช้ได้ภายในไม่กี่วันแรกหลังเริ่มใช้งาน พอจดรายการแรก ทั้งคู่ได้โบนัสฮูกคอยน์")}
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
