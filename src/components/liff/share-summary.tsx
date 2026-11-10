"use client";

import { Download, Lock, MessageCircle, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/liff/sheet";
import { Switch } from "@/components/liff/settings/switch";
import { buildShareFlex } from "@/lib/line/share-flex";
import { THEME_IDS, THEMES, type ThemeId } from "@/lib/personalize";
import { buildShareCard, type ShareSummary } from "@/lib/share-card";
import { drawShareCard } from "@/lib/share-card-draw";
import { t } from "@/lib/i18n";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;
const LINK = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;
const FILE_NAME = "phook-summary.png";

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Share the summary as a picture: a card for a story (9:16) drawn on the phone, with the figures
 * hidden unless the person turns them on, and an invitation (QR and referral code) at the bottom.
 */
export function ShareSummarySheet({
  summary,
  previous,
  code,
  canTheme,
  onClose,
}: {
  summary: ShareSummary;
  /** The period before (null while it loads, or when there is none). */
  previous: ShareSummary | null;
  code: string | null;
  /** The plan lets the person pick the card's colours (Starter and above); Free has mint. */
  canTheme: boolean;
  onClose: () => void;
}) {
  const [hideAmounts, setHideAmounts] = useState(true);
  const [theme, setTheme] = useState<ThemeId>("mint");
  const [sending, setSending] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // a plan that no longer has the colours (it ended while this was open) goes back to mint
  useEffect(() => {
    if (!canTheme) setTheme("mint");
  }, [canTheme]);

  const model = useMemo(
    () => buildShareCard(summary, previous, { hideAmounts }),
    [summary, previous, hideAmounts],
  );

  useEffect(() => {
    let alive = true;
    setFailed(false);
    // the old picture goes at once, so the save link never points at one that is being replaced
    setUrl(null);
    setBlob(null);
    drawShareCard({
      model,
      code,
      link: LINK,
      theme,
      fontFamily: getComputedStyle(document.body).fontFamily || "sans-serif",
    })
      .then(async (b) => {
        // a data: URL, not a blob: one: the LINE app's browser saves and long-presses those more reliably
        const data = await toDataUrl(b);
        if (!alive) return;
        setBlob(b);
        setUrl(data);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [model, code, theme]);

  const file = useMemo(
    () => (blob ? new File([blob], FILE_NAME, { type: "image/png" }) : null),
    [blob],
  );
  const canShare =
    file !== null &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  async function share() {
    if (!file) return;
    setNotice(null);
    try {
      await navigator.share({ files: [file], title: t("สรุปของฉันกับพี่ฮูก") });
    } catch (e) {
      // closing the share menu is not a failure
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setNotice(t("แชร์ไม่สำเร็จ ลองบันทึกรูปแล้วโพสต์เองได้เลยนะ"));
      }
    }
  }

  async function sendToChat() {
    if (sending) return;
    setSending(true);
    setNotice(null);
    try {
      const liff = (await import("@line/liff")).default;
      let ready = false;
      try {
        ready = liff.isApiAvailable("shareTargetPicker");
      } catch {
        ready = false; // not signed in to LIFF here (a plain browser)
      }
      if (!ready) {
        setNotice(t("ส่งเข้าแชทไม่ได้ตอนนี้ ลองเปิดสรุปนี้ในแอป LINE นะ"));
        return;
      }
      const sent = await liff.shareTargetPicker(
        [buildShareFlex(model, { link: LINK, code, theme }) as never],
        { isMultiple: true },
      );
      // nothing comes back when the person closes the picker without sending
      if (sent) setNotice(t("ส่งเข้าแชทแล้ว"));
    } catch {
      setNotice(t("ส่งเข้าแชทไม่สำเร็จ ลองใหม่อีกครั้งนะ"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet title={t("แชร์สรุปของฉัน")} onClose={onClose}>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-primary-soft px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("ซ่อนยอดเงิน")}</p>
          <p className="text-xs text-muted">
            {t("แสดงเป็นเปอร์เซ็นต์แทนตัวเลข จะได้แชร์ได้สบายใจ")}
          </p>
        </div>
        <Switch checked={hideAmounts} onChange={setHideAmounts} label={t("ซ่อนยอดเงิน")} />
      </div>

      <div role="radiogroup" aria-label={t("สีการ์ด")} className="flex flex-wrap gap-2">
        {THEME_IDS.map((id) => {
          const locked = !canTheme && id !== "mint";
          const on = theme === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={locked}
              aria-describedby={locked ? "share-theme-note" : undefined}
              onClick={() => setTheme(id)}
              className={`flex h-11 items-center gap-2 rounded-2xl border px-3 text-xs font-semibold disabled:opacity-50 ${on ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-foreground"}`}
            >
              <span
                aria-hidden
                className="h-4 w-4 rounded-full border border-border"
                style={{ background: id === "night" ? "#1E293B" : THEMES[id].palette.primary }}
              />
              {THEMES[id].label}
              {locked ? <Lock className="h-3 w-3" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      {!canTheme ? (
        <p id="share-theme-note" className="text-xs text-muted">
          {t("สีอื่นสำหรับแผน Starter ขึ้นไป")}{" "}
          <Link href="/upgrade" className="font-semibold text-primary underline">
            {t("ดูแผน")}
          </Link>
        </p>
      ) : null}

      {failed ? (
        <p role="alert" className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {t("สร้างรูปไม่สำเร็จ ลองใหม่อีกครั้งนะ")}
        </p>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={t("ตัวอย่างการ์ดสรุปที่จะแชร์")}
          className="mx-auto max-h-[52vh] w-auto rounded-2xl border border-border shadow-card"
        />
      ) : (
        <div
          role="status"
          className="mx-auto flex h-64 items-center justify-center text-sm text-muted"
        >
          {t("กำลังสร้างรูป…")}
        </div>
      )}

      <p className="text-center text-xs text-muted">{t("กดค้างที่รูปเพื่อบันทึกลงเครื่องได้")}</p>
      {notice ? (
        <p role="status" className="rounded-2xl bg-accent/15 px-4 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      <button
        type="button"
        onClick={sendToChat}
        disabled={sending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#06C755] text-sm font-semibold text-white"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {t("ส่งเข้าแชท LINE")}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <a
          href={url ?? undefined}
          download={FILE_NAME}
          aria-disabled={!url}
          className={`flex h-12 items-center justify-center gap-2 rounded-2xl border border-primary text-sm font-semibold text-primary ${url ? "" : "pointer-events-none opacity-50"}`}
        >
          <Download className="h-4 w-4" aria-hidden />
          {t("บันทึกรูป")}
        </a>
        {canShare ? (
          <button
            type="button"
            onClick={share}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-surface"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            {t("แชร์")}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
