"use client";

import { Sheet } from "@/components/liff/sheet";
import { formatBaht } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import type { PaymentItem } from "./types";
import { t } from "@/lib/i18n";

const STATUS: Record<PaymentItem["status"], { label: string; cls: string }> = {
  paid: { label: t("ชำระแล้ว"), cls: "bg-primary-soft text-primary" },
  pending: { label: t("รอชำระ"), cls: "bg-warn-soft text-warn" },
  failed: { label: t("ไม่สำเร็จ"), cls: "bg-expense/10 text-expense" },
  refunded: { label: t("คืนเงินแล้ว"), cls: "bg-background text-muted" },
};

/** The person's payments, newest first, as the payment provider reports them. */
export function PaymentHistorySheet({
  items,
  onClose,
}: {
  items: PaymentItem[];
  onClose: () => void;
}) {
  const sorted = [...items].sort((a, b) =>
    (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt),
  );
  return (
    <Sheet title={t("ประวัติการชำระเงิน")} onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("ยังไม่มีประวัติการชำระเงิน")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="num text-sm font-semibold">
                  {t("฿")}
                  {formatBaht(p.amountSatang)}
                </p>
                <p className="text-xs text-muted">
                  {formatThaiDate(new Date(p.paidAt ?? p.createdAt))}
                </p>
              </div>
              <span
                className={cn("rounded-lg px-2 py-0.5 text-xs font-medium", STATUS[p.status].cls)}
              >
                {STATUS[p.status].label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
