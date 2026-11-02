"use client";

import { ArrowLeft, Crown, Lock } from "lucide-react";
import Link from "next/link";
import { useApi } from "@/components/liff/liff-provider";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { formatBytes } from "@/lib/file";
import { PLAN_LABEL, type Plan } from "@/lib/plan";
import type { QuotaItem, QuotaPeriod } from "@/lib/quota";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

interface QuotaResponse {
  plan: Plan;
  planExpiresAt: string | null;
  kept: QuotaItem[];
  counted: QuotaItem[];
}

const PERIOD_LABEL: Record<QuotaPeriod, string> = {
  total: "",
  day: "วันนี้",
  week: "สัปดาห์นี้",
  month: "เดือนนี้",
  once: "ตลอดการใช้งาน",
};

const amount = (item: QuotaItem, n: number) =>
  item.unit === "bytes" ? formatBytes(n) : n.toLocaleString("th-TH");

/** One quota: what is used of it, a bar, and a word when it is nearly or fully used. */
function QuotaRow({ item }: { item: QuotaItem }) {
  const locked = item.limit === 0;
  const pct =
    item.limit && item.limit > 0 ? Math.min(100, Math.round((item.used * 100) / item.limit)) : 0;
  const full = item.limit !== null && item.limit > 0 && item.used >= item.limit;
  const near = !full && pct >= 80;
  const period = PERIOD_LABEL[item.period];

  return (
    <li className="space-y-2 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{item.label}</p>
          {item.hint ? <p className="text-xs text-muted">{item.hint}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted">
              <Lock className="h-3 w-3" aria-hidden /> ต้องอัปเกรด
            </span>
          ) : item.limit === null ? (
            <p className="num text-sm font-semibold">
              {amount(item, item.used)} <span className="font-normal text-muted">· ไม่จำกัด</span>
            </p>
          ) : (
            <p className="num text-sm font-semibold">
              {amount(item, item.used)}{" "}
              <span className="font-normal text-muted">/ {amount(item, item.limit)}</span>
            </p>
          )}
          {period && !locked ? <p className="text-[11px] text-muted">{period}</p> : null}
        </div>
      </div>
      {!locked && item.limit !== null ? (
        <div>
          <div
            role="progressbar"
            aria-label={item.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 overflow-hidden rounded-full bg-border"
          >
            <div
              className={cn(
                "h-full rounded-full",
                full ? "bg-expense" : near ? "bg-accent" : "bg-primary",
              )}
              style={{ width: `${Math.max(pct, item.used > 0 ? 2 : 0)}%` }}
            />
          </div>
          {full || near ? (
            <p
              className={cn(
                "mt-1 text-xs font-semibold",
                full ? "text-expense" : "text-foreground",
              )}
            >
              {full ? "ใช้ครบแล้ว" : "ใกล้ครบแล้ว"}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function QuotaGroup({ title, sub, items }: { title: string; sub: string; items: QuotaItem[] }) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="px-1">
        <h2 className="text-sm font-bold">{title}</h2>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        {items.map((item) => (
          <QuotaRow key={item.key} item={item} />
        ))}
      </ul>
    </section>
  );
}

export default function QuotaPage() {
  const quota = useApi<QuotaResponse>("/api/quota");
  const data = quota.data;

  return (
    <main>
      <header className="flex items-center gap-2 px-4 pb-2 pt-5">
        <Link
          href="/settings"
          aria-label="กลับไปหน้าตั้งค่า"
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-xl font-bold">โควตาการใช้งาน</h1>
      </header>

      <div className="space-y-4 px-4 pb-4">
        {quota.loading && !data ? (
          <LoadingBlock rows={5} />
        ) : quota.error || !data ? (
          <ErrorState message={quota.error ?? "โหลดไม่สำเร็จ"} onRetry={quota.reload} />
        ) : (
          <>
            <section
              aria-label="แผนที่ใช้"
              className="flex items-center gap-3 rounded-2xl border border-border bg-primary-soft p-4"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary"
              >
                <Crown className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-primary">แผน {PLAN_LABEL[data.plan]}</p>
                <p className="text-xs text-muted">
                  {data.plan !== "free" && data.planExpiresAt
                    ? `ใช้ได้ถึง ${formatThaiDate(new Date(data.planExpiresAt))}`
                    : "โควตาด้านล่างเป็นของแผนนี้"}
                </p>
              </div>
            </section>

            <QuotaGroup
              title="ที่เก็บไว้ได้"
              sub="นับทั้งหมดที่มีอยู่ตอนนี้ ลบออกแล้วก็ได้ที่คืน"
              items={data.kept}
            />
            <QuotaGroup
              title="ที่นับใหม่ทุกรอบ"
              sub="เริ่มนับใหม่ทุกวัน ทุกสัปดาห์ หรือทุกเดือน ตามที่บอกไว้"
              items={data.counted}
            />

            {data.plan !== "ultimate" ? (
              <Link
                href="/upgrade"
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-surface"
              >
                {data.plan === "free" ? "อัปเกรดเพื่อเพิ่มโควตา" : "ดูแผน Elite"}
              </Link>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
