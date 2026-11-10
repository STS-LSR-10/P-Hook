"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { DEFAULT_CURRENCY, HOME_CURRENCIES, currencyLabel } from "@/lib/currency";
import type { Settings } from "./types";
import { t } from "@/lib/i18n";

/**
 * Pick the currency the books are kept in: a search, then the currencies, the chosen one ticked.
 * Amounts already recorded keep their numbers (only the sign changes), which the sheet says first.
 * After a change the page reloads, so it signs in again and every amount shows the new sign.
 */
export function CurrencySheet({ current, onClose }: { current?: string; onClose: () => void }) {
  const { api } = useLiff();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = current ?? DEFAULT_CURRENCY;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = HOME_CURRENCIES.map((code) => ({ code, label: currencyLabel(code) }));
    return q ? all.filter((c) => `${c.label} ${c.code}`.toLowerCase().includes(q)) : all;
  }, [query]);

  async function pick(code: string) {
    if (code === chosen) return onClose();
    setBusy(code);
    setError(null);
    try {
      await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ currency: code }),
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("บันทึกไม่สำเร็จ ลองใหม่อีกครั้งนะ"));
      setBusy(null);
    }
  }

  return (
    <Sheet
      title={t("สกุลเงิน")}
      onClose={onClose}
      header={
        <>
          <label className="flex h-11 items-center gap-2 border-b border-border px-1">
            <Search className="h-4 w-4 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ค้นหาสกุลเงิน")}
              aria-label={t("ค้นหาสกุลเงิน")}
              className="h-full w-full bg-transparent text-sm outline-none"
            />
          </label>
          <p className="text-xs text-muted">
            {t(
              "เปลี่ยนแล้วตัวเลขของรายการเดิมจะเหมือนเดิม เปลี่ยนแค่สัญลักษณ์ ส่วนเงินสกุลอื่นที่จดหลังจากนี้จะแปลงเป็นสกุลนี้ให้",
            )}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-expense">
              {error}
            </p>
          ) : null}
        </>
      }
    >
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("ไม่พบสกุลเงินที่ค้นหา")}</p>
      ) : (
        <ul className="space-y-1" aria-label={t("สกุลเงิน")}>
          {shown.map((c) => {
            const selected = c.code === chosen;
            return (
              <li key={c.code}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void pick(c.code)}
                  aria-pressed={selected}
                  className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${
                    selected ? "bg-primary-soft font-semibold text-primary" : ""
                  }`}
                >
                  <span>{busy === c.code ? t("กำลังบันทึก…") : c.label}</span>
                  {selected ? <Check className="h-4 w-4" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
