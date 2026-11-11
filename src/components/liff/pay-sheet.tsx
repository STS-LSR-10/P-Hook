"use client";

import { ArrowLeft, CalendarClock, CreditCard, QrCode } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/liff/sheet";
import { paySummary, type PayMethod } from "@/lib/payments/pay-summary";
import { PLAN_LABEL, type Plan } from "@/lib/plan";
import type { PaidPlan, Period, PlanPrice } from "@/lib/pricing";
import { formatThaiDate } from "@/lib/thai-date";
import { t } from "@/lib/i18n";

const PERIOD_LABEL: Record<Period, string> = { monthly: t("รายเดือน"), yearly: t("รายปี") };
const UNIT: Record<Period, string> = { monthly: t("เดือน"), yearly: t("ปี") };

const METHODS: { value: PayMethod; label: string; note: string; Icon: typeof CreditCard }[] = [
  {
    value: "card",
    label: t("บัตรเครดิต/เดบิต"),
    note: t("ต่ออายุอัตโนมัติ ยกเลิกได้ทุกเมื่อ"),
    Icon: CreditCard,
  },
  {
    value: "promptpay",
    label: t("พร้อมเพย์ (QR)"),
    note: t("จ่ายครั้งเดียวต่อรอบ ไม่ต่ออายุอัตโนมัติ"),
    Icon: QrCode,
  },
];

/**
 * What happens when "pay" is pressed: pick how to pay (each way with its own price), then see what
 * will be charged and until when, then go to the payment page. A person who already pays one way has
 * no choice, so the sheet opens on the summary.
 */
export function PaySheet({
  plan,
  period,
  price,
  earlyBaht,
  fixedMethod,
  expiresAt,
  busy,
  onPay,
  onClose,
}: {
  plan: PaidPlan;
  period: Period;
  price: PlanPrice;
  /** The Early Bird price for this plan and period when a seat is left. */
  earlyBaht: number | null;
  /** Set when the person is already paying one way and can only continue it. */
  fixedMethod: PayMethod | null;
  expiresAt: Date | null;
  busy: boolean;
  /** `showedEarly`: the price on the summary was an Early Bird one. */
  onPay: (method: PayMethod, showedEarly: boolean) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<PayMethod | null>(fixedMethod);
  const now = new Date();
  const summaryOf = (method: PayMethod) =>
    paySummary({ method, period, price, earlyBaht, expiresAt, now });

  if (!picked) {
    return (
      <Sheet title={t("เลือกช่องทางชำระเงิน")} onClose={onClose}>
        <p className="text-sm text-muted">
          {PLAN_LABEL[plan as Plan]} · {PERIOD_LABEL[period]}
        </p>
        {METHODS.map(({ value, label, note, Icon }) => {
          const s = summaryOf(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => setPicked(value)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-foreground/80">{note}</span>
              </span>
              <span className="num shrink-0 text-right">
                <span className="block text-lg font-bold">฿{s.payBaht}</span>
                <span className="block text-[11px] text-foreground/80">
                  {s.early ? `${t("ปกติ ฿")}${s.regularBaht}` : `/${UNIT[period]}`}
                </span>
              </span>
            </button>
          );
        })}
      </Sheet>
    );
  }

  const s = summaryOf(picked);
  const method = METHODS.find((m) => m.value === picked)!;
  const row = "flex items-baseline justify-between gap-3 py-2";
  return (
    <Sheet title={t("สรุปก่อนชำระเงิน")} onClose={onClose}>
      {fixedMethod ? null : (
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="flex h-11 items-center gap-1 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("เปลี่ยนช่องทาง")}
        </button>
      )}
      <dl className="divide-y divide-border rounded-2xl border border-border px-3">
        <div className={row}>
          <dt className="text-sm text-muted">{t("แผน")}</dt>
          <dd className="text-sm font-semibold">
            {PLAN_LABEL[plan as Plan]} · {PERIOD_LABEL[period]}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-sm text-muted">{t("ช่องทาง")}</dt>
          <dd className="text-sm font-semibold">{method.label}</dd>
        </div>
        <div className={row}>
          <dt className="text-sm text-muted">{t("ยอดที่ชำระวันนี้")}</dt>
          <dd className="num text-xl font-extrabold">฿{s.payBaht}</dd>
        </div>
        {picked === "promptpay" ? (
          <div className={row}>
            <dt className="text-sm text-muted">{t("ใช้งานได้ถึง")}</dt>
            <dd className="text-sm font-semibold">{formatThaiDate(s.until)}</dd>
          </div>
        ) : (
          <div className={row}>
            <dt className="text-sm text-muted">{t("ตัดบัตรครั้งถัดไป (โดยประมาณ)")}</dt>
            <dd className="text-right text-sm font-semibold">
              {formatThaiDate(s.until)}
              <span className="num block text-xs font-normal text-foreground/80">
                ฿{s.regularBaht}/{UNIT[period]}
              </span>
            </dd>
          </div>
        )}
      </dl>
      <p className="flex items-start gap-2 text-xs text-foreground/80">
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {picked === "promptpay"
          ? t("จ่ายครั้งเดียว ไม่ต่ออายุอัตโนมัติ ต่อท้ายเวลาที่เหลืออยู่")
          : t("ต่ออายุอัตโนมัติ ยกเลิกได้ทุกเมื่อ ใช้ได้จนครบรอบที่จ่ายแล้ว")}
      </p>
      <button
        type="button"
        onClick={() => onPay(picked, s.early)}
        disabled={busy}
        className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
      >
        {busy ? t("กำลังดำเนินการ...") : t("ไปชำระเงิน")}
      </button>
      <p className="text-center text-xs text-muted">
        {t("ระบบจะพาไปหน้าชำระเงินที่ปลอดภัยของ Stripe")}
      </p>
    </Sheet>
  );
}
