"use client";

import { useState } from "react";
import { SavingsChart } from "@/components/liff/lazy-charts";
import { useApi } from "@/components/liff/liff-provider";
import { Segmented } from "@/components/liff/segmented";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/liff/states";
import { money } from "@/lib/money";
import type { SeriesPoint } from "@/lib/series";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "day";

interface Response {
  series: SeriesPoint[];
  categories: { name: string; totalSatang: number }[];
}

const SAVINGS_CATEGORY = "ออม/ลงทุน";

const VIEWS: { value: View; label: string }[] = [
  { value: "month", label: "6 เดือน" },
  { value: "week", label: "รายสัปดาห์" },
  { value: "day", label: "รายวัน" },
];

/**
 * Savings view (Plus): money kept per period (income - expense), the running total, how much
 * of income was kept, and what went to the "ออม/ลงทุน" category this budget cycle.
 */
export function SavingsPanel() {
  const [view, setView] = useState<View>("month");
  const data = useApi<Response>(`/api/analytics?view=${view}&scope=cycle`);

  const series = data.data?.series ?? [];
  let running = 0;
  const points = series.map((p) => {
    const net = p.incomeSatang - p.expenseSatang;
    running += net;
    return { label: p.label, net: net / 100, total: running / 100 };
  });
  const totalIncome = series.reduce((s, p) => s + p.incomeSatang, 0);
  const totalNet = series.reduce((s, p) => s + (p.incomeSatang - p.expenseSatang), 0);
  const rate = totalIncome > 0 ? Math.round((totalNet * 100) / totalIncome) : null;
  const invested = data.data?.categories.find((c) => c.name === SAVINGS_CATEGORY)?.totalSatang ?? 0;
  const hasData = series.some((p) => p.incomeSatang > 0 || p.expenseSatang > 0);

  return (
    <div className="space-y-4">
      <Segmented label="ช่วงเวลา" value={view} onChange={setView} options={VIEWS} />

      {data.loading ? (
        <LoadingBlock rows={3} />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !hasData ? (
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <EmptyState
            title="ยังไม่มีข้อมูลพอจะดูเงินออม"
            hint="จดรายรับและรายจ่ายสักพัก แล้วกราฟเก็บออมจะขึ้นมานะ"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
              <p className="text-xs text-muted">เก็บได้ในช่วงนี้</p>
              <p
                className={cn(
                  "num text-lg font-bold",
                  totalNet < 0 ? "text-expense" : "text-income",
                )}
              >
                {money(totalNet)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
              <p className="text-xs text-muted">เก็บได้ % ของรายรับ</p>
              <p className="num text-lg font-bold">{rate === null ? "-" : `${rate}%`}</p>
            </div>
          </div>

          <section
            aria-label="กราฟเงินเก็บออม"
            className="rounded-2xl border border-border bg-surface p-4 shadow-card"
          >
            <p className="mb-2 text-xs text-muted">
              แท่ง = เก็บได้ในแต่ละช่วง (รายรับ − รายจ่าย) · เส้น = เก็บสะสม
            </p>
            <SavingsChart points={points} />
          </section>

          <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
            <p className="text-xs text-muted">ใส่หมวด &quot;{SAVINGS_CATEGORY}&quot; ในรอบงบนี้</p>
            <p className="num text-lg font-bold">{money(invested)}</p>
          </div>
        </>
      )}
    </div>
  );
}
