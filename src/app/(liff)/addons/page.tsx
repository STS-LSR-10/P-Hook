"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { type AddonKind, type AddonSku, type Bonus } from "@/lib/addons";
import { formatBytes } from "@/lib/file";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface AddonsResponse {
  plan: string;
  canBuy: boolean;
  paymentsAvailable: boolean;
  catalog: AddonSku[];
  bonus: Bonus;
  active: { sku: string; expiresAt: string }[];
}

const GROUPS: { kind: AddonKind; title: string; unit: string }[] = [
  { kind: "storage", title: t("พื้นที่เก็บไฟล์ (Storage)"), unit: "GB" },
  { kind: "alerts", title: t("เตือนที่รออยู่ (Notification)"), unit: t("รายการ") },
  { kind: "slips", title: t("อ่านสลิปเพิ่ม (Smart OCR Slip)"), unit: t("ใบ") },
  { kind: "group_slots", title: t("กลุ่ม LINE เพิ่ม (Group Slot)"), unit: t("กลุ่ม LINE") },
];

type Method = "card" | "promptpay";

export default function AddonsPage() {
  const { api, openExternal } = useLiff();
  const data = useApi<AddonsResponse>("/api/addons");
  const [method, setMethod] = useState<Method>("card");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function buy(sku: string) {
    setBusy(sku);
    setNotice(null);
    try {
      const res = await api<{ available: boolean; message?: string; url?: string }>(
        "/api/addons/checkout",
        { method: "POST", body: JSON.stringify({ sku, method }) },
      );
      if (res.available && res.url) await openExternal(res.url);
      else setNotice(res.message ?? t("ยังไม่เปิดให้ชำระเงิน"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำรายการไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  }

  const d = data.data;
  const have = d
    ? [
        d.bonus.storageBytes > 0 && `${t("พื้นที่")} +${formatBytes(d.bonus.storageBytes)}`,
        d.bonus.alerts > 0 && `${t("เตือนที่รออยู่")} +${d.bonus.alerts}`,
        d.bonus.slips > 0 && `${t("สลิปเหลือ")} ${d.bonus.slips} ${t("ใบ")}`,
        d.bonus.groups > 0 && `${t("กลุ่ม LINE")} +${d.bonus.groups}`,
      ].filter(Boolean)
    : [];

  return (
    <main>
      <PageHeader title={t("ซื้อโควตาเพิ่ม")} />
      <div className="space-y-4 px-4 pb-24">
        {data.loading ? (
          <LoadingBlock rows={6} />
        ) : data.error || !d ? (
          <ErrorState message={data.error ?? t("โหลดไม่สำเร็จ")} onRetry={data.reload} />
        ) : (
          <>
            {have.length > 0 ? (
              <section
                aria-label={t("ที่คุณมีอยู่")}
                className="rounded-3xl border border-border bg-primary-soft p-4 text-sm"
              >
                <p className="font-semibold">{t("ที่คุณมีอยู่ตอนนี้")}</p>
                <p className="text-foreground/80">{have.join(" · ")}</p>
                {d.active.map((a) => (
                  <p key={`${a.sku}-${a.expiresAt}`} className="text-xs text-foreground/80">
                    {d.catalog.find((c) => c.sku === a.sku)?.label} · {t("ถึง")}{" "}
                    {formatThaiDate(new Date(a.expiresAt))}
                  </p>
                ))}
              </section>
            ) : null}

            {!d.canBuy ? (
              <p className="rounded-2xl bg-accent/15 px-4 py-3 text-sm">
                {t("แพ็กเกจเสริมสำหรับแผน Starter ขึ้นไป")}{" "}
                <Link href="/upgrade" className="font-semibold underline">
                  {t("ดูแผน")}
                </Link>
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label={t("ช่องทางชำระเงิน")}
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    ["card", t("บัตร (ต่ออายุเอง)")],
                    ["promptpay", t("พร้อมเพย์ (จ่ายครั้งเดียว)")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={method === value}
                    onClick={() => setMethod(value)}
                    className={cn(
                      "h-11 rounded-2xl border text-sm font-semibold",
                      method === value
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border bg-surface text-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {GROUPS.map((g) => (
              <section key={g.kind} aria-label={g.title} className="space-y-2">
                <h2 className="text-sm font-bold">{g.title}</h2>
                <ul className="space-y-2">
                  {d.catalog
                    .filter((a) => a.kind === g.kind)
                    .map((a) => (
                      <li
                        key={a.sku}
                        className="flex items-center justify-between gap-3 rounded-3xl border border-border bg-surface p-4"
                      >
                        <div className="min-w-0">
                          <p className="text-base font-bold">{a.label}</p>
                          <p className="flex items-center gap-1 text-sm text-foreground/80">
                            <Check className="h-4 w-4 text-primary" aria-hidden />+{a.units}{" "}
                            {g.unit}
                          </p>
                          <p className="num text-sm font-semibold">
                            ฿{a.baht}
                            {a.monthly ? ` / ${t("เดือน")}` : ` · ${t("ซื้อครั้งเดียว")}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => buy(a.sku)}
                          disabled={!d.canBuy || busy !== null}
                          aria-label={`${t("ซื้อ")} ${a.label}`}
                          className="h-11 shrink-0 rounded-2xl bg-primary px-5 text-sm font-semibold text-surface disabled:opacity-50"
                        >
                          {busy === a.sku ? t("กำลังเปิด…") : t("ซื้อ")}
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}

            <p className="text-xs text-foreground/80">
              {t(
                "แพ็กรายเดือน (พื้นที่ และกลุ่ม LINE) ต่ออายุเองเมื่อจ่ายด้วยบัตร ยกเลิกได้ที่ “จัดการการชำระเงิน” ส่วนแพ็กสลิปและแพ็กเตือนซื้อครั้งเดียวและไม่หมดอายุ",
              )}
            </p>
            {notice ? (
              <p role="status" className="rounded-2xl bg-accent/15 px-4 py-2 text-sm">
                {notice}
              </p>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
