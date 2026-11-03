"use client";

import { Eraser } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { RESET_CONFIRM_PHRASE, monthDeletePhrase, phraseMatches } from "@/lib/account-confirm";
import { thaiMonthYear } from "@/lib/thai-date";
import { cardClass, fieldClass } from "./types";
import { t } from "@/lib/i18n";

interface Preview {
  entries: number;
  transfers: number;
  debts: number;
  goalDeposits: number;
  files: number;
  keptShared: number;
}
interface MonthRow {
  month: string;
  entries: number;
  transfers: number;
}

type Mode = { kind: "all" } | { kind: "month" };

/**
 * Start over without deleting the account: erase all financial history (keeping the account, plan
 * and set-up) or erase one month. Three deliberate steps: choose and see the numbers, then type the
 * phrase. Nothing is done before the last step.
 */
export function ResetCard() {
  const { api } = useLiff();
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [months, setMonths] = useState<MonthRow[] | null>(null);
  const [month, setMonth] = useState("");
  const [keepBalance, setKeepBalance] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const expected = mode?.kind === "month" ? monthDeletePhrase(month) : RESET_CONFIRM_PHRASE;
  const total = preview
    ? preview.entries + preview.transfers + preview.debts + preview.goalDeposits
    : 0;

  function close() {
    if (busy) return;
    setMode(null);
    setStep(1);
    setMonths(null);
    setMonth("");
    setPreview(null);
    setPhrase("");
    setError(null);
  }

  async function load(path: string): Promise<Preview | null> {
    setBusy(true);
    setError(null);
    try {
      return await api<Preview>(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("โหลดไม่สำเร็จ"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function open(next: Mode) {
    setDone(null);
    setMode(next);
    setStep(1);
    setPreview(null);
    if (next.kind === "all") {
      setPreview(await load("/api/account/erase?scope=all"));
    } else {
      setBusy(true);
      try {
        const res = await api<{ months: MonthRow[] }>("/api/account/erase");
        setMonths(res.months);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("โหลดไม่สำเร็จ"));
      } finally {
        setBusy(false);
      }
    }
  }

  async function pickMonth(value: string) {
    setMonth(value);
    setPreview(null);
    if (value) setPreview(await load(`/api/account/erase?scope=month&month=${value}`));
  }

  async function erase() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/erase", {
        method: "POST",
        body: JSON.stringify(
          mode.kind === "all"
            ? { scope: "all", keepBalance, confirm: phrase }
            : { scope: "month", month, confirm: phrase },
        ),
      });
      setDone(
        mode.kind === "all"
          ? t("ล้างประวัติการเงินแล้ว เริ่มจดใหม่ได้เลย")
          : t("ลบข้อมูลเดือน {0} แล้ว", thaiMonthYear(month)),
      );
      setBusy(false);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ลบไม่สำเร็จ"));
      setBusy(false);
    }
  }

  const lines = (p: Preview) => [
    t("รายการรับ/จ่าย {0} รายการ", p.entries.toLocaleString("en-US")),
    p.transfers > 0
      ? t("การโอนระหว่างกระเป๋า {0} รายการ", p.transfers.toLocaleString("en-US"))
      : null,
    p.debts > 0 ? t("หนี้ {0} รายการ (รวมประวัติการชำระ)", p.debts.toLocaleString("en-US")) : null,
    p.goalDeposits > 0
      ? t("ยอดที่หยอดกระปุกออม {0} ครั้ง", p.goalDeposits.toLocaleString("en-US"))
      : null,
    p.files > 0 ? t("รูปแนบและรูปสลิป {0} ไฟล์", p.files.toLocaleString("en-US")) : null,
  ];

  return (
    <section className={cardClass} aria-label={t("ล้างข้อมูลเพื่อเริ่มต้นใหม่")}>
      <h2 className="font-semibold">{t("ล้างข้อมูลเพื่อเริ่มต้นใหม่")}</h2>
      <p className="text-sm text-muted">
        {t("เก็บบัญชี แผน และการตั้งค่าไว้ ลบเฉพาะประวัติการเงิน (ลบแล้วกู้คืนไม่ได้)")}
      </p>
      {done ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {done}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={() => void open({ kind: "all" })}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-expense text-sm font-semibold text-expense"
        >
          <Eraser className="h-4 w-4" aria-hidden /> {t("ล้างประวัติการเงินทั้งหมด")}
        </button>
        <button
          type="button"
          onClick={() => void open({ kind: "month" })}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold"
        >
          <Eraser className="h-4 w-4" aria-hidden /> {t("ลบเฉพาะเดือน")}
        </button>
      </div>

      {mode && step === 1 ? (
        <Sheet
          title={mode.kind === "all" ? t("ล้างประวัติการเงินทั้งหมด?") : t("ลบเฉพาะเดือน")}
          onClose={close}
        >
          <div className="space-y-3">
            {mode.kind === "month" ? (
              months === null ? (
                <p className="text-sm text-muted" role="status">
                  {t("กำลังโหลด...")}
                </p>
              ) : months.length === 0 ? (
                <p className="text-sm text-muted">{t("ยังไม่มีเดือนที่มีข้อมูลให้ลบ")}</p>
              ) : (
                <select
                  value={month}
                  onChange={(e) => void pickMonth(e.target.value)}
                  aria-label={t("เดือนที่จะลบ")}
                  className={fieldClass}
                >
                  <option value="">{t("เลือกเดือน")}</option>
                  {months.map((m) => (
                    <option key={m.month} value={m.month}>
                      {thaiMonthYear(m.month)} ({m.entries.toLocaleString("en-US")} {t("รายการ)")}
                    </option>
                  ))}
                </select>
              )
            ) : null}

            {preview ? (
              <>
                <p className="text-sm">{t("จะถูกลบอย่างถาวร:")}</p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {lines(preview)
                    .filter(Boolean)
                    .map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                </ul>
                {preview.keptShared > 0 ? (
                  <p className="text-sm text-muted">
                    {t("รายการที่ลงใน")}
                    <strong>{t("กระเป๋าร่วม")}</strong> {preview.keptShared.toLocaleString("en-US")}{" "}
                    {t("รายการ")} <strong>{t("จะไม่ถูกลบ")}</strong> {t("เพราะอีกฝ่ายยังเห็นอยู่")}
                  </p>
                ) : null}
                <p className="text-sm text-muted">
                  {mode.kind === "all"
                    ? t(
                        "ที่เก็บไว้: บัญชีและแผน การตั้งค่า หมวด งบ กระเป๋า กระปุกออม บิล รายการประจำ โน้ต เหรียญสะสม",
                      )
                    : t(
                        "หนี้ กระปุกออม และยอดตั้งต้นของกระเป๋าไม่ถูกแตะ ยอดคงเหลือของกระเป๋าจะเปลี่ยนตามรายการที่ลบ",
                      )}
                </p>
                {mode.kind === "all" ? (
                  <label className="flex min-h-11 items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={keepBalance}
                      onChange={(e) => setKeepBalance(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="font-semibold">
                        {t("คงยอดเงินปัจจุบันของแต่ละกระเป๋าไว้")}
                      </span>
                      <span className="block text-xs text-muted">
                        {t(
                          "ใช้ยอดคงเหลือตอนนี้เป็นยอดตั้งต้นใหม่ ไม่ติ๊ก = ยอดกลับไปเท่ายอดตั้งต้นเดิม",
                        )}
                      </span>
                    </span>
                  </label>
                ) : null}
                <p className="text-sm text-muted">
                  {t("อยากเก็บสำเนาไว้ ส่งออกไฟล์ก่อนที่หน้า")}{" "}
                  <Link href="/transactions" className="font-medium text-primary underline">
                    {t("รายการ")}
                  </Link>{" "}
                  {t("(ไอคอนดาวน์โหลด)")}
                </p>
                <button
                  type="button"
                  disabled={total === 0}
                  onClick={() => setStep(2)}
                  className="h-12 w-full rounded-2xl bg-expense text-base font-semibold text-surface disabled:opacity-40"
                >
                  {total === 0 ? t("ไม่มีอะไรให้ลบ") : t("ดำเนินการต่อ")}
                </button>
              </>
            ) : busy && mode.kind === "all" ? (
              <p className="text-sm text-muted" role="status">
                {t("กำลังนับรายการ...")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-expense">
                {error}
              </p>
            ) : null}
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

      {mode && step === 2 ? (
        <Sheet title={t("ยืนยันอีกครั้ง")} onClose={close}>
          <div className="space-y-3">
            <label className="block text-sm" htmlFor="erase-phrase">
              {t("พิมพ์")} <strong>{expected}</strong> {t("เพื่อยืนยัน")}
            </label>
            <input
              id="erase-phrase"
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
              disabled={busy || !phraseMatches(phrase, expected)}
              onClick={() => void erase()}
              className="h-12 w-full rounded-2xl bg-expense text-base font-semibold text-surface disabled:opacity-40"
            >
              {busy ? t("กำลังลบ...") : t("ลบอย่างถาวร")}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={busy}
              className="h-12 w-full rounded-2xl border border-border text-base font-medium"
            >
              {t("ย้อนกลับ")}
            </button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
