"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { DEFAULT_ZONE, ZONES, zoneLabel } from "@/lib/zone";
import type { Settings } from "./types";

/**
 * Pick the time zone: a search, then the zones west to east, the chosen one ticked. After a change the
 * page reloads, so it signs in again and every date on it is in the new zone.
 */
export function ZoneSheet({ current, onClose }: { current?: string; onClose: () => void }) {
  const { api } = useLiff();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = current ?? DEFAULT_ZONE;
  const now = useMemo(() => new Date(), []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = ZONES.map((z) => ({ ...z, label: zoneLabel(z.id, now) }));
    return q ? all.filter((z) => `${z.label} ${z.id}`.toLowerCase().includes(q)) : all;
  }, [query, now]);

  async function pick(zone: string) {
    if (zone === chosen) return onClose();
    setBusy(zone);
    setError(null);
    try {
      await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ timezone: zone }),
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้งนะ");
      setBusy(null);
    }
  }

  return (
    <Sheet title="โซนเวลา" onClose={onClose}>
      <label className="flex h-11 items-center gap-2 border-b border-border px-1">
        <Search className="h-4 w-4 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาโซนเวลา"
          aria-label="ค้นหาโซนเวลา"
          className="h-full w-full bg-transparent text-sm outline-none"
        />
      </label>
      <p className="text-xs text-muted">เวลาเตือน การตัดวัน รอบงบ และสรุป จะคิดตามโซนที่เลือก</p>
      {error ? (
        <p role="alert" className="text-sm text-expense">
          {error}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">ไม่พบโซนเวลาที่ค้นหา</p>
      ) : (
        <ul className="space-y-1" aria-label="โซนเวลา">
          {shown.map((z) => {
            const selected = z.id === chosen;
            return (
              <li key={z.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void pick(z.id)}
                  aria-pressed={selected}
                  className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${
                    selected ? "bg-primary-soft font-semibold text-primary" : ""
                  }`}
                >
                  <span>{busy === z.id ? "กำลังบันทึก…" : z.label}</span>
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
