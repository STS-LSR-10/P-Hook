"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Lightbulb, Lock, Repeat } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/liff/states";
import { TxCard } from "@/components/liff/tx-card";
import { useApi } from "@/components/liff/liff-provider";
import { sliceColor } from "@/components/liff/slice-color";
import type { TxDto } from "@/lib/dto";
import { money } from "@/lib/money";
import { PLAN_LABEL } from "@/lib/plan";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

// the charting library is only downloaded when a ring is drawn
const MiniDonut = dynamic(() => import("@/components/liff/charts").then((m) => m.MiniDonut), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-full" />,
});

interface SummaryResponse {
  range: { from: string; to: string };
  cycle: "monthly" | "weekly";
  incomeSatang: number;
  expenseSatang: number;
  balanceSatang: number;
  accumulatedSatang: number;
  count: number;
  offset: number;
  budgetSatang: number | null;
  /** Null when the plan has no category chart (Free). */
  categories:
    { categoryId: string | null; name: string; color: string | null; totalSatang: number }[] | null;
  recent: TxDto[];
}

interface MeResponse {
  displayName: string | null;
  pictureUrl: string | null;
  plan: "free" | "plus" | "ultimate";
  features: Record<string, boolean>;
}

interface GoalsResponse {
  items: {
    id: string;
    name: string;
    emoji: string | null;
    percent: number;
    targetSatang: number;
    archived: boolean;
    done: boolean;
  }[];
}

const MAX_BACK = 24;

const TIPS = [
  t('พิมพ์ "กาแฟ 60" ในแชท บอทจะจดและจัดหมวดให้ทันที'),
  t('พิมพ์ "เมื่อวาน ข้าว 80" เพื่อจดย้อนหลัง (Pro ขึ้นไป)'),
  t('พิมพ์ "สรุปเดือนนี้" ในแชท เพื่อดูภาพรวมได้ทุกเมื่อ'),
  t("ส่งรูปสลิปโอนเงินในแชท บอทอ่านยอดให้โดยไม่ต้องพิมพ์"),
];

export default function SummaryPage() {
  const [offset, setOffset] = useState(0);
  const summary = useApi<SummaryResponse>(`/api/summary?offset=${offset}`);
  const me = useApi<MeResponse>("/api/me");
  const goals = useApi<GoalsResponse>(me.data?.features.savingsGoal ? "/api/goals" : null);
  const [accumulated, setAccumulated] = useState(false);
  const [open, setOpen] = useState(false);
  const tip = useMemo(() => TIPS[Math.floor(Date.now() / 86_400_000) % TIPS.length], []);

  const data = summary.data;
  const rangeLabel = data
    ? `${formatThaiDate(new Date(data.range.from))} – ${formatThaiDate(
        new Date(new Date(data.range.to).getTime() - 1),
      )}`
    : null;

  // the goal closest to done (an unfinished one)
  const goal = (goals.data?.items ?? [])
    .filter((g) => !g.archived && !g.done)
    .sort((a, b) => b.percent - a.percent)[0];

  return (
    <main>
      <PageHeader title={t("สรุปภาพรวม")} />

      <div className="space-y-4 px-4 pb-4 wide:px-0">
        <div className="space-y-4 wide:grid wide:grid-cols-2 wide:gap-4 wide:space-y-0">
          <section
            aria-label={t("โปรไฟล์")}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card"
          >
            {me.data?.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.data.pictureUrl}
                alt=""
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            )}
            {me.data ? (
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{me.data.displayName}</p>
                <span className="mt-0.5 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
                  {PLAN_LABEL[me.data.plan]}
                </span>
              </div>
            ) : (
              <div className="flex-1 space-y-2" aria-hidden>
                <Skeleton className="h-4 w-32 rounded-lg" />
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
            )}
          </section>

          <section
            aria-label={t("ช่วงเวลา")}
            className="flex items-center justify-between rounded-2xl border border-border bg-surface p-1.5"
          >
            <button
              type="button"
              aria-label={t("รอบก่อนหน้า")}
              disabled={offset <= -MAX_BACK}
              onClick={() => setOffset((o) => o - 1)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            {rangeLabel ? (
              <p className="num text-sm font-semibold" aria-live="polite">
                {rangeLabel}
              </p>
            ) : (
              <Skeleton className="h-4 w-40 rounded-lg" />
            )}
            <button
              type="button"
              aria-label={t("รอบถัดไป")}
              disabled={offset >= 0}
              onClick={() => setOffset((o) => o + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </section>
        </div>

        {summary.loading && !data ? (
          <SummarySkeleton />
        ) : summary.error && !data ? (
          <ErrorState message={summary.error} onRetry={summary.reload} />
        ) : data ? (
          <div className="space-y-4 wide:grid wide:grid-cols-2 wide:items-start wide:gap-4 wide:space-y-0">
            <div className="space-y-4">
              <Hero
                data={data}
                accumulated={accumulated}
                onToggle={() => setAccumulated((v) => !v)}
                goal={goal}
              />
              <IncomeExpense data={data} />
              <Spending data={data} open={open} onToggle={() => setOpen((v) => !v)} />
            </div>

            <div className="space-y-4">
              <section aria-label={t("รายการล่าสุด")}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-base font-semibold">{t("รายการล่าสุด")}</h2>
                  <Link href="/transactions" className="text-sm font-medium text-primary">
                    {t("ดูทั้งหมด")}
                  </Link>
                </div>
                {data.recent.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-surface shadow-card">
                    <EmptyState
                      title={t("ยังไม่มีรายการเลย")}
                      hint={t('ลองพิมพ์ "กาแฟ 30" ในแชท หรือกดเพิ่มที่หน้ารายการได้เลย')}
                    />
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {data.recent.map((tx) => (
                      <TxCard key={tx.id} tx={tx} showDate />
                    ))}
                  </ul>
                )}
              </section>

              <section
                aria-label={t("ทิป")}
                className="flex items-start gap-3 rounded-2xl border border-border bg-primary-soft p-3.5"
              >
                <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="text-sm">
                  <p className="font-semibold">{t("ทิปน่ารู้")}</p>
                  <p className="text-primary">{tip}</p>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Hero({
  data,
  accumulated,
  onToggle,
  goal,
}: {
  data: SummaryResponse;
  accumulated: boolean;
  onToggle: () => void;
  goal: GoalsResponse["items"][number] | undefined;
}) {
  const value = accumulated ? data.accumulatedSatang : data.balanceSatang;
  return (
    <section
      aria-label={t("ภาพรวม")}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-5 text-[var(--hero-ink)] shadow-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/50 dark:bg-white/10 blur-2xl"
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--hero-ink-soft)]">
            {accumulated ? t("เหลือเก็บสะสม") : t("เหลือเก็บรอบนี้")}
          </p>
          <button
            type="button"
            aria-pressed={accumulated}
            onClick={onToggle}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/70 dark:border-white/15 bg-white/60 dark:bg-white/10 px-3 text-xs font-semibold text-[var(--hero-ink)]"
          >
            <Repeat className="h-3.5 w-3.5 text-[var(--hero-ink)]" aria-hidden />
            {accumulated ? t("รอบนี้") : t("สะสม")}
          </button>
        </div>
        <p
          className={cn(
            "num my-2 text-3xl font-bold",
            value < 0 ? "text-expense" : "text-[var(--hero-ink)]",
          )}
        >
          {money(value)}
        </p>
        <p className="text-xs text-[var(--hero-ink-soft)]">
          {accumulated
            ? t("รายรับ − รายจ่ายทั้งหมดตั้งแต่เริ่มจดจนถึงสิ้นรอบนี้")
            : t("รายรับ − รายจ่ายของรอบนี้")}
        </p>
        {goal ? (
          <div className="mt-4 border-t border-white/70 dark:border-white/15 pt-3">
            <div className="mb-1.5 flex justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-[var(--hero-ink-soft)]">
                {t("เป้าหมาย")} {goal.emoji ?? "🎯"} {goal.name}
              </span>
              <span className="num shrink-0 font-semibold text-[var(--hero-ink)]">
                {goal.percent}% ({money(goal.targetSatang)})
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t("ความคืบหน้าเป้าหมาย {0}", goal.name)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, goal.percent)}
              className="h-2 overflow-hidden rounded-full bg-white/70 dark:bg-white/10 p-0.5"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, goal.percent)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function IncomeExpense({ data }: { data: SummaryResponse }) {
  const share =
    data.incomeSatang > 0 ? Math.round((data.expenseSatang / data.incomeSatang) * 1000) / 10 : null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <p className="text-xs text-muted">{t("รายจ่าย")}</p>
        <p className="num text-lg font-bold text-expense">{money(data.expenseSatang)}</p>
        <p className="mt-1 text-[11px] text-muted">
          {share === null ? (
            t("ยังไม่มีรายรับ")
          ) : (
            <>
              <span className="font-semibold text-expense">{share}%</span> {t("ของรายรับ")}
            </>
          )}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <p className="text-xs text-muted">{t("รายรับ")}</p>
        <p className="num text-lg font-bold text-income">{money(data.incomeSatang)}</p>
        <p className="mt-1 text-[11px] text-muted">
          <span className="num font-semibold">{data.count}</span> {t("รายการในรอบนี้")}
        </p>
      </div>
    </div>
  );
}

function Spending({
  data,
  open,
  onToggle,
}: {
  data: SummaryResponse;
  open: boolean;
  onToggle: () => void;
}) {
  const budget = data.budgetSatang;
  const remaining = budget === null ? null : budget - data.expenseSatang;
  const usedPct =
    budget !== null
      ? Math.round((data.expenseSatang / budget) * 100)
      : data.incomeSatang > 0
        ? Math.round((data.expenseSatang / data.incomeSatang) * 100)
        : null;
  const status =
    budget === null
      ? null
      : data.expenseSatang > budget
        ? { text: t("เกินงบ"), cls: "bg-expense/10 text-expense" }
        : data.expenseSatang >= budget * 0.8
          ? { text: t("ใกล้เต็มงบ"), cls: "bg-warn-soft text-warn" }
          : { text: t("อยู่ในงบ"), cls: "bg-income/10 text-income" };

  const cats = data.categories;
  const total = (cats ?? []).reduce((s, c) => s + c.totalSatang, 0);
  const slices = (cats ?? []).map((c) => ({
    key: c.categoryId ?? c.name,
    name: c.name,
    value: c.totalSatang / 100,
    color: null, // the pastel palette, in rank order
  }));

  return (
    <section
      aria-label={t("สัดส่วนการใช้จ่ายและงบ")}
      className="rounded-3xl border border-border bg-surface p-5 shadow-card"
    >
      <h2 className="text-sm font-semibold">{t("สัดส่วนการใช้จ่ายและงบ")}</h2>
      <p className="mb-4 text-xs text-muted">{t("แยกตามหมวดหมู่ของรอบนี้")}</p>

      <div className="grid grid-cols-12 items-center gap-3">
        <div className="col-span-5">
          {cats && slices.length > 0 ? (
            <div className="relative mx-auto h-28 w-28">
              <MiniDonut slices={slices} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] text-muted">
                  {budget === null ? t("ของรายรับ") : t("ใช้ไปแล้ว")}
                </span>
                <span className="num text-sm font-bold">
                  {usedPct === null ? "–" : `${usedPct}%`}
                </span>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex h-28 w-28 flex-col items-center justify-center rounded-full border-4 border-border text-center">
              <span className="text-[10px] text-muted">
                {budget === null ? t("ของรายรับ") : t("ใช้ไปแล้ว")}
              </span>
              <span className="num text-sm font-bold">
                {usedPct === null ? "–" : `${usedPct}%`}
              </span>
            </div>
          )}
        </div>

        <dl className="col-span-7 space-y-2 border-l border-border pl-3 text-xs">
          <Row label={t("จำนวนรายการ")} value={t("{0} รายการ", data.count)} />
          <Row
            label={t("งบที่ตั้งไว้")}
            value={budget === null ? t("ยังไม่ตั้ง") : `${money(budget)}`}
          />
          {remaining !== null ? (
            <Row
              label={t("งบคงเหลือ")}
              value={`${remaining < 0 ? "-" : "+"}${money(Math.abs(remaining))}`}
              tone={remaining < 0 ? "text-expense" : "text-income"}
            />
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted">{t("สถานะงบ")}</dt>
            <dd>
              {status ? (
                <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", status.cls)}>
                  {status.text}
                </span>
              ) : (
                <Link href="/budgets" className="font-semibold text-primary">
                  {t("ตั้งงบ")}
                </Link>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {cats === null ? (
        <Link
          href="/upgrade"
          className="mt-4 flex items-center gap-3 rounded-2xl border border-dashed border-border bg-background px-4 py-3"
        >
          <Lock className="h-5 w-5 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("กราฟสัดส่วนตามหมวด")}</span>
            <span className="block text-xs text-muted">{t("ใช้ได้ในแผน Pro ขึ้นไป")}</span>
          </span>
          <span className="text-sm font-semibold text-primary">{t("ดูแผน")}</span>
        </Link>
      ) : cats.length === 0 ? (
        <p className="mt-4 text-center text-xs text-muted">{t("ยังไม่มีรายจ่ายในรอบนี้")}</p>
      ) : (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-background text-xs font-medium text-muted"
          >
            {open ? t("ย่อลง") : t("ดูรายละเอียดหมวดหมู่")}
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </button>
          {open ? (
            <ul className="mt-3 space-y-2.5">
              {cats.map((c, i) => (
                <li
                  key={c.categoryId ?? c.name}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: sliceColor(null, i) }}
                      aria-hidden
                    />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="num text-muted">
                      {total > 0 ? Math.round((c.totalSatang / total) * 1000) / 10 : 0}%
                    </span>
                    <span className="num font-semibold">{money(c.totalSatang)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("num font-semibold", tone)}>{value}</dd>
    </div>
  );
}

/** The shape of the page while its numbers load: the same cards, with pale bars where the text goes. */
function SummarySkeleton() {
  const card = "rounded-2xl border border-border bg-surface p-4 shadow-card";
  return (
    <div role="status" aria-label={t("กำลังโหลด")} className="space-y-4">
      <div className="rounded-3xl border border-border bg-primary-soft p-5 shadow-card">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28 rounded-lg bg-primary/15" />
          <Skeleton className="h-8 w-16 rounded-full bg-primary/15" />
        </div>
        <Skeleton className="my-3 h-9 w-44 rounded-xl bg-primary/15" />
        <Skeleton className="h-3 w-52 rounded-lg bg-primary/15" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className={card}>
            <Skeleton className="h-3 w-12 rounded-lg" />
            <Skeleton className="mt-2 h-6 w-24 rounded-lg" />
            <Skeleton className="mt-2 h-3 w-20 rounded-lg" />
          </div>
        ))}
      </div>
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-card">
        <Skeleton className="h-4 w-44 rounded-lg" />
        <Skeleton className="mb-4 mt-2 h-3 w-32 rounded-lg" />
        <div className="grid grid-cols-12 items-center gap-3">
          <div className="col-span-5">
            <Skeleton className="mx-auto h-28 w-28 rounded-full" />
          </div>
          <div className="col-span-7 space-y-3 pl-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-3 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
      <div>
        <Skeleton className="mb-3 h-5 w-28 rounded-lg" />
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-3 shadow-card">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-3/5 rounded-lg" />
                <Skeleton className="h-3 w-2/5 rounded-lg" />
              </div>
              <Skeleton className="h-4 w-14 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
