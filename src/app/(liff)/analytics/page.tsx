"use client";

import { ChevronLeft, ChevronRight, Hand } from "lucide-react";
import { useState } from "react";
import { CategoryDonutChart, FlowBarChart } from "@/components/liff/lazy-charts";
import { ProTeaser } from "@/components/liff/pro-teaser";
import { SavingsPanel } from "@/components/liff/savings-panel";
import { Segmented } from "@/components/liff/segmented";
import { sliceColor } from "@/components/liff/slice-color";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/liff/states";
import { useApi } from "@/components/liff/liff-provider";
import { emojiOf } from "@/lib/category-emoji";
import { formatBaht } from "@/lib/money";
import type { SeriesPoint } from "@/lib/series";
import {
  addLocalDays,
  bangkokParts,
  formatThaiDayMonth,
  formatThaiMonthShort,
} from "@/lib/thai-date";

type View = "month" | "week" | "day";
type Scope = "cycle" | "all";

interface AnalyticsResponse {
  view: View;
  scope: Scope;
  offset: number;
  series: SeriesPoint[];
  categories: {
    categoryId: string | null;
    name: string;
    color: string | null;
    icon: string | null;
    totalSatang: number;
  }[];
  categoriesTotalSatang: number;
}

const VIEWS: { value: View; label: string }[] = [
  { value: "month", label: "6 เดือน" },
  { value: "week", label: "รายสัปดาห์" },
  { value: "day", label: "รายวัน" },
];
/** "average per …" in the unit of one bar. */
const PER: Record<View, string> = { month: "เดือน", week: "สัปดาห์", day: "วัน" };
const MAX_BACK = 12;

/** "พ.ค. – ต.ค. 2569" / "6 ต.ค. – 26 ต.ค. 2569": the stretch of time the bars cover. */
function rangeLabel(series: SeriesPoint[], view: View): string | null {
  const first = series[0];
  const last = series.at(-1);
  if (!first || !last) return null;
  const a = new Date(first.start);
  const b = new Date(last.start);
  const year = bangkokParts(b).year + 543;
  if (view === "month") return `${formatThaiMonthShort(a)} – ${formatThaiMonthShort(b)} ${year}`;
  const end = view === "week" ? addLocalDays(b, 6) : b;
  return `${formatThaiDayMonth(a)} – ${formatThaiDayMonth(end)} ${year}`;
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<"flow" | "saving">("flow");
  const [view, setView] = useState<View>("month");
  const [scope, setScope] = useState<Scope>("cycle");
  const [offset, setOffset] = useState(0);
  const me = useApi<{ features: Record<string, boolean> }>("/api/me");
  const savingsUnlocked = me.data?.features.savingsChart === true;
  const dashboardUnlocked = me.data?.features.dashboard === true;
  // Free never calls the (Pro) analytics API: it sees the locked page below instead
  const data = useApi<AnalyticsResponse>(
    tab === "flow" && dashboardUnlocked
      ? `/api/analytics?view=${view}&scope=${scope}&offset=${offset}`
      : null,
  );

  const series = data.data?.series ?? [];
  const chartData = series.map((p) => ({
    label: p.label,
    income: p.incomeSatang / 100,
    expense: p.expenseSatang / 100,
  }));
  const hasSeries = chartData.some((p) => p.income > 0 || p.expense > 0);
  const totalIncome = series.reduce((s, p) => s + p.incomeSatang, 0);
  const totalExpense = series.reduce((s, p) => s + p.expenseSatang, 0);
  const avgIncome = series.length > 0 ? Math.round(totalIncome / series.length) : 0;
  const avgExpense = series.length > 0 ? Math.round(totalExpense / series.length) : 0;

  const cats = data.data?.categories ?? [];
  const slices = cats.map((c) => ({
    key: c.categoryId ?? c.name,
    name: c.name,
    value: c.totalSatang / 100,
    color: null, // the pastel palette, in rank order, on every chart of the page
  }));
  const catTotal = data.data?.categoriesTotalSatang ?? 0;

  return (
    <main>
      <PageHeader title="วิเคราะห์" />
      <div className="space-y-4 px-4 pb-4">
        <Segmented
          label="หมวดวิเคราะห์"
          value={tab}
          onChange={setTab}
          options={[
            { value: "flow", label: "รายรับรายจ่าย" },
            {
              value: "saving",
              label: (
                <span className="inline-flex items-center justify-center gap-1.5">
                  เก็บออม
                  <span className="rounded-full border border-warn/30 bg-warn-soft px-1.5 text-[10px] font-bold text-warn">
                    ★ PRO
                  </span>
                </span>
              ),
            },
          ]}
        />

        {me.loading ? (
          <AnalyticsSkeleton />
        ) : me.error ? (
          <ErrorState message={me.error} onRetry={me.reload} />
        ) : tab === "saving" ? (
          savingsUnlocked ? (
            <SavingsPanel />
          ) : (
            <ProTeaser variant="saving" />
          )
        ) : !dashboardUnlocked ? (
          <ProTeaser variant="flow" />
        ) : (
          <>
            <Segmented
              label="ช่วงเวลา"
              value={view}
              onChange={(v) => {
                setView(v);
                setOffset(0);
              }}
              options={VIEWS}
            />

            {data.loading && !data.data ? (
              <AnalyticsSkeleton />
            ) : data.error && !data.data ? (
              <ErrorState message={data.error} onRetry={data.reload} />
            ) : data.data ? (
              <>
                <section
                  aria-label="กราฟรายรับรายจ่าย"
                  className="space-y-3 rounded-3xl border border-border bg-surface p-4 shadow-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold">ประวัติรายรับรายจ่าย</h2>
                      <p className="text-[11px] text-muted">เปรียบเทียบกระแสเงินเข้า-ออก</p>
                    </div>
                    <div className="flex shrink-0 items-center rounded-xl border border-border bg-background text-xs">
                      <button
                        type="button"
                        aria-label="ช่วงก่อนหน้า"
                        disabled={offset <= -MAX_BACK}
                        onClick={() => setOffset((o) => o - 1)}
                        className="flex h-9 w-8 items-center justify-center text-muted disabled:opacity-30"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden />
                      </button>
                      <span className="num px-0.5 text-[11px] font-medium" aria-live="polite">
                        {rangeLabel(series, view)}
                      </span>
                      <button
                        type="button"
                        aria-label="ช่วงถัดไป"
                        disabled={offset >= 0}
                        onClick={() => setOffset((o) => o + 1)}
                        className="flex h-9 w-8 items-center justify-center text-muted disabled:opacity-30"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-b border-border pb-2 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-income" aria-hidden />
                      <span className="text-muted">รายรับ:</span>
                      <span className="num font-bold text-income">฿{formatBaht(totalIncome)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-expense" aria-hidden />
                      <span className="text-muted">รายจ่าย:</span>
                      <span className="num font-bold text-expense">
                        ฿{formatBaht(totalExpense)}
                      </span>
                    </span>
                  </div>

                  {hasSeries ? (
                    <>
                      <FlowBarChart data={chartData} />
                      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
                        <Hand className="h-3.5 w-3.5 text-primary" aria-hidden />
                        แตะที่แท่งกราฟเพื่อดูรายละเอียดยอดเงินของแต่ละช่วง
                      </p>
                    </>
                  ) : (
                    <EmptyState
                      title="ยังไม่มีรายการในช่วงนี้"
                      hint={'ลองจดรายการสักอัน เช่น "กาแฟ 30" แล้วกราฟจะขึ้นมา'}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-2.5 border-t border-border pt-3">
                    <div className="rounded-2xl border border-income/30 bg-income/10 p-3">
                      <p className="text-[11px] font-medium text-muted">
                        รายรับเฉลี่ย / {PER[view]}
                      </p>
                      <p className="num text-base font-bold text-income">
                        ฿{formatBaht(avgIncome)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-expense/30 bg-expense/10 p-3">
                      <p className="text-[11px] font-medium text-muted">
                        รายจ่ายเฉลี่ย / {PER[view]}
                      </p>
                      <p className="num text-base font-bold text-expense">
                        ฿{formatBaht(avgExpense)}
                      </p>
                    </div>
                  </div>
                </section>

                <section
                  aria-label="สัดส่วนรายจ่ายตามหมวด"
                  className="space-y-4 rounded-3xl border border-border bg-surface p-4 shadow-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold">รายจ่ายตามหมวด</h2>
                      <p className="text-[11px] text-muted">สัดส่วนค่าใช้จ่ายทั้งหมด</p>
                    </div>
                  </div>
                  <Segmented
                    label="ขอบเขต"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: "cycle", label: "รอบนี้" },
                      { value: "all", label: "สะสมทั้งหมด" },
                    ]}
                  />
                  {cats.length === 0 ? (
                    <EmptyState title="ยังไม่มีรายจ่าย" />
                  ) : (
                    <>
                      <div className="relative mx-auto h-44 w-44">
                        <CategoryDonutChart slices={slices} />
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                          <span className="text-[11px] font-medium text-muted">รวมรายจ่าย</span>
                          <span className="num mt-0.5 text-lg font-bold">
                            ฿{formatBaht(catTotal)}
                          </span>
                          <span className="mt-0.5 rounded-full border border-primary/20 bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
                            {cats.length} หมวดหมู่
                          </span>
                        </div>
                      </div>
                      <ul className="space-y-3 border-t border-border pt-3">
                        {cats.map((c, i) => {
                          const pct =
                            catTotal > 0 ? Math.round((c.totalSatang * 100) / catTotal) : 0;
                          const color = sliceColor(null, i);
                          const emoji = emojiOf(c.icon);
                          return (
                            <li key={c.categoryId ?? c.name} className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span
                                    aria-hidden
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs"
                                    style={{ backgroundColor: `${color}26` }}
                                  >
                                    {emoji ?? (
                                      <span
                                        className="h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: color }}
                                      />
                                    )}
                                  </span>
                                  <span className="truncate font-medium">{c.name}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="num font-bold">
                                    ฿{formatBaht(c.totalSatang)}
                                  </span>
                                  <span className="num ml-1 text-[10px] text-muted">({pct}%)</span>
                                </span>
                              </div>
                              <div
                                role="progressbar"
                                aria-label={`${c.name} ${pct}%`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={pct}
                                className="h-2 overflow-hidden rounded-full bg-border"
                              >
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${pct}%`, backgroundColor: color }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

/** The cards while the numbers load. */
function AnalyticsSkeleton() {
  return (
    <div role="status" aria-label="กำลังโหลด" className="space-y-4">
      <div className="space-y-3 rounded-3xl border border-border bg-surface p-4 shadow-card">
        <Skeleton className="h-4 w-40 rounded-lg" />
        <Skeleton className="h-52 w-full" />
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <div className="space-y-3 rounded-3xl border border-border bg-surface p-4 shadow-card">
        <Skeleton className="h-4 w-32 rounded-lg" />
        <Skeleton className="mx-auto h-44 w-44 rounded-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
