"use client";

import {
  ArrowLeft,
  ArrowUpCircle,
  Bell,
  Bot,
  CalendarSync,
  ChevronDown,
  CloudUpload,
  FileText,
  Flag,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Lock,
  Megaphone,
  MessageCircle,
  Mic,
  Receipt,
  Repeat,
  RotateCw,
  Sparkles,
  StickyNote,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { formatBytes } from "@/lib/file";
import { PLAN_LABEL, type Plan } from "@/lib/plan";
import type { QuotaIcon, QuotaItem, QuotaPeriod } from "@/lib/quota";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

interface QuotaResponse {
  plan: Plan;
  planExpiresAt: string | null;
  main: QuotaItem[];
  others: QuotaItem[];
}

const PLANS: Plan[] = ["free", "plus", "ultimate"];
const DAY_MS = 86_400_000;

const ICON: Record<QuotaIcon, { Icon: LucideIcon; tint: string; bar: string }> = {
  receipt: { Icon: Receipt, tint: "bg-emerald-500/10 text-emerald-600", bar: "bg-emerald-500" },
  pdf: { Icon: FileText, tint: "bg-amber-500/10 text-amber-600", bar: "bg-amber-500" },
  group: { Icon: Users, tint: "bg-indigo-500/10 text-indigo-600", bar: "bg-indigo-500" },
  bell: { Icon: Bell, tint: "bg-sky-500/10 text-sky-600", bar: "bg-sky-500" },
  repeat: { Icon: CalendarSync, tint: "bg-purple-500/10 text-purple-600", bar: "bg-purple-500" },
  megaphone: { Icon: Megaphone, tint: "bg-rose-500/10 text-rose-600", bar: "bg-rose-500" },
  storage: { Icon: HardDrive, tint: "bg-blue-500/10 text-blue-600", bar: "bg-blue-500" },
  owl: { Icon: Bot, tint: "bg-teal-500/10 text-teal-600", bar: "bg-teal-500" },
  voice: { Icon: Mic, tint: "bg-orange-500/10 text-orange-600", bar: "bg-orange-500" },
  photo: { Icon: ImageIcon, tint: "bg-pink-500/10 text-pink-600", bar: "bg-pink-500" },
  ai: { Icon: Sparkles, tint: "bg-violet-500/10 text-violet-600", bar: "bg-violet-500" },
  upload: { Icon: CloudUpload, tint: "bg-cyan-500/10 text-cyan-600", bar: "bg-cyan-500" },
  note: { Icon: StickyNote, tint: "bg-yellow-500/10 text-yellow-700", bar: "bg-yellow-500" },
  recurring: { Icon: Repeat, tint: "bg-lime-500/10 text-lime-700", bar: "bg-lime-600" },
  wallet: { Icon: Wallet, tint: "bg-emerald-500/10 text-emerald-600", bar: "bg-emerald-500" },
  goal: { Icon: Flag, tint: "bg-fuchsia-500/10 text-fuchsia-600", bar: "bg-fuchsia-500" },
};

/** When a quota starts over, said under its numbers. */
const PERIOD_TEXT: Record<QuotaPeriod, string> = {
  total: "นับทั้งหมดที่มีอยู่ตอนนี้ ลบออกแล้วได้ที่คืน",
  day: "นับใหม่ทุกวัน",
  week: "นับใหม่ทุกวันจันทร์",
  month: "นับใหม่ทุกวันที่ 1",
  once: "ใช้ได้ครั้งเดียวตลอดการใช้งาน",
};
const PER: Record<QuotaPeriod, string> = {
  total: "",
  day: "ต่อวัน",
  week: "ต่อสัปดาห์",
  month: "ต่อเดือน",
  once: "ครั้งเดียว",
};

const fmt = (item: QuotaItem, n: number) =>
  item.unit === "bytes" ? formatBytes(n) : n.toLocaleString("th-TH");
const withWord = (item: QuotaItem, n: number) =>
  item.word ? `${fmt(item, n)} ${item.word}` : fmt(item, n);

type Level = "locked" | "unlimited" | "ok" | "near" | "critical" | "full";

/** The word for a row's state, shown as a badge and read out with the row. */
const LEVEL_WORD: Partial<Record<Level, string>> = {
  near: "ใกล้เต็ม",
  critical: "วิกฤต",
  full: "เต็มแล้ว",
};

function levelOf(item: QuotaItem): { level: Level; pct: number } {
  if (item.limit === 0) return { level: "locked", pct: 0 };
  if (item.limit === null) return { level: "unlimited", pct: 0 };
  const pct = Math.min(100, Math.round((item.used * 100) / item.limit));
  if (item.used >= item.limit) return { level: "full", pct };
  return { level: pct >= 95 ? "critical" : pct >= 80 ? "near" : "ok", pct };
}

/** "142 / 300 ครั้ง (เหลือ 158)" */
function usageLine(item: QuotaItem): string {
  // after a downgrade some may still be there (groups kept from Elite): say how many
  if (item.limit === 0) {
    return item.used > 0
      ? `มีอยู่ ${withWord(item, item.used)} · แผนนี้เพิ่มไม่ได้`
      : "แผนนี้ยังใช้ไม่ได้";
  }
  if (item.limit === null) return `ใช้ไป ${withWord(item, item.used)} · ไม่จำกัด`;
  const left = Math.max(0, item.limit - item.used);
  const word = item.word ? ` ${item.word}` : "";
  const rest = left > 0 ? `เหลือ ${fmt(item, left)}` : "เต็มแล้ว";
  return `${fmt(item, item.used)} / ${fmt(item, item.limit)}${word} (${rest})`;
}

function QuotaRow({ item, onOpen }: { item: QuotaItem; onOpen: () => void }) {
  const { Icon, tint, bar } = ICON[item.icon];
  const { level, pct } = levelOf(item);
  const near = level === "near";
  const full = level === "full";
  // nearly or fully used: both shown in red
  const critical = level === "critical" || full;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={[item.label, LEVEL_WORD[level], usageLine(item)].filter(Boolean).join(": ")}
        className={cn(
          "w-full rounded-2xl border p-3 text-left shadow-sm transition active:scale-[0.99]",
          critical
            ? "border-rose-500/40 bg-rose-500/5"
            : near
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-border bg-surface",
        )}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                critical
                  ? "bg-rose-500/15 text-rose-600"
                  : near
                    ? "bg-amber-500/15 text-amber-700"
                    : tint,
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-bold">{item.label}</p>
                {near ? (
                  <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                    ใกล้เต็ม
                  </span>
                ) : critical ? (
                  <span className="shrink-0 rounded bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                    {full ? "เต็มแล้ว" : "วิกฤต"}
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "num text-[11px]",
                  critical
                    ? "font-medium text-rose-700 dark:text-rose-300"
                    : near
                      ? "font-medium text-amber-800 dark:text-amber-300"
                      : "text-muted",
                )}
              >
                {usageLine(item)}
              </p>
            </div>
          </div>
          {level === "locked" ? (
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-background px-2 py-0.5 text-[11px] font-bold text-muted">
              <Lock className="h-3 w-3" aria-hidden /> ต้องอัปเกรด
            </span>
          ) : level === "unlimited" ? (
            <span className="shrink-0 rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary">
              ไม่จำกัด
            </span>
          ) : (
            <span
              className={cn(
                "num shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold",
                critical
                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : near
                    ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    : "bg-background text-muted",
              )}
            >
              {pct}%
            </span>
          )}
        </div>
        {level === "locked" || level === "unlimited" ? null : (
          <div
            role="progressbar"
            aria-label={item.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${fmt(item, item.used)} จาก ${fmt(item, item.limit ?? 0)}`}
            className="h-1.5 w-full rounded-full bg-border"
          >
            <div
              className={cn(
                "h-1.5 rounded-full",
                critical ? "bg-rose-500" : near ? "bg-amber-500" : bar,
              )}
              style={{ width: `${Math.max(pct, item.used > 0 ? 2 : 0)}%` }}
            />
          </div>
        )}
      </button>
    </li>
  );
}

/** What a quota counts, when it starts over, and what each plan gets. */
function DetailSheet({
  item,
  plan,
  onClose,
}: {
  item: QuotaItem;
  plan: Plan;
  onClose: () => void;
}) {
  return (
    <Sheet title={item.label} onClose={onClose}>
      <p className="text-sm text-muted">{item.hint}</p>
      <div className="rounded-2xl bg-background p-3">
        <p className="num text-sm font-semibold">{usageLine(item)}</p>
        <p className="text-xs text-muted">{PERIOD_TEXT[item.period]}</p>
      </div>
      <div>
        <h3 className="mb-1.5 text-sm font-semibold">แต่ละแผนได้เท่าไร</h3>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {PLANS.map((p) => {
            const { limit, period } = item.plans[p];
            const value =
              limit === 0
                ? "ใช้ไม่ได้"
                : limit === null
                  ? "ไม่จำกัด"
                  : [withWord(item, limit), PER[period]].filter(Boolean).join(" ");
            return (
              <li
                key={p}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 text-sm",
                  p === plan && "bg-primary-soft font-semibold text-primary",
                )}
              >
                <span>
                  {PLAN_LABEL[p]}
                  {p === plan ? " (แผนของคุณ)" : ""}
                </span>
                <span className="num">{value}</span>
              </li>
            );
          })}
        </ul>
      </div>
      {plan !== "ultimate" ? (
        <Link
          href="/upgrade"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-surface"
        >
          <ArrowUpCircle className="h-4 w-4" aria-hidden /> อัปเกรดเพื่อเพิ่มโควตา
        </Link>
      ) : null}
    </Sheet>
  );
}

/** The ring of the overview card: the average use of the main quotas. */
function Ring({ pct }: { pct: number }) {
  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden>
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          strokeWidth="3.5"
          className="stroke-slate-700"
        />
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${pct}, 100`}
          className="stroke-emerald-400"
        />
      </svg>
      <span className="num absolute text-[11px] font-bold">{pct}%</span>
    </div>
  );
}

export default function QuotaPage() {
  const quota = useApi<QuotaResponse>("/api/quota");
  const data = quota.data;
  const [open, setOpen] = useState<QuotaItem | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (data) setLoadedAt(new Date());
  }, [data]);

  const measured = (data?.main ?? [])
    .map(levelOf)
    .filter((l) => l.level !== "locked" && l.level !== "unlimited");
  const average = measured.length
    ? Math.round(measured.reduce((sum, l) => sum + l.pct, 0) / measured.length)
    : 0;
  const count = (level: Level) => measured.filter((l) => l.level === level).length;
  const daysLeft =
    data && data.plan !== "free" && data.planExpiresAt
      ? Math.max(0, Math.ceil((new Date(data.planExpiresAt).getTime() - Date.now()) / DAY_MS))
      : null;

  async function backToChat() {
    try {
      const liff = (await import("@line/liff")).default;
      if (liff.isInClient()) liff.closeWindow();
    } catch {
      /* outside LINE there is no chat to go back to */
    }
  }

  return (
    <main className="pb-24">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href="/settings"
            aria-label="กลับไปหน้าตั้งค่า"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-tight">โควตาการใช้งาน</h1>
            <p className="flex items-center gap-1 text-[11px] text-muted">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {loadedAt
                ? `อัปเดตล่าสุด ${loadedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.`
                : "กำลังโหลด"}
            </p>
          </div>
        </div>
        {data ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-emerald-600 to-teal-700 px-2.5 py-1.5 text-[11px] font-semibold uppercase text-white">
            <Zap className="h-3.5 w-3.5" aria-hidden /> {PLAN_LABEL[data.plan]}
          </span>
        ) : null}
      </header>

      <div className="space-y-4 px-4 pt-3">
        {quota.loading && !data ? (
          <LoadingBlock rows={6} />
        ) : quota.error || !data ? (
          <ErrorState message={quota.error ?? "โหลดไม่สำเร็จ"} onRetry={quota.reload} />
        ) : (
          <>
            <section
              aria-label="ภาพรวมโควตา"
              className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-4 text-white"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Ring pct={average} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold">แผน {PLAN_LABEL[data.plan]}</span>
                      {daysLeft !== null ? (
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                          เหลือ {daysLeft} วัน
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-slate-300">
                      ใช้เฉลี่ย {average}% • ปกติ {count("ok")}
                      {count("full") > 0 ? (
                        <span className="font-medium text-rose-300"> • เต็ม {count("full")}</span>
                      ) : null}
                      {count("near") > 0 ? (
                        <span className="font-medium text-amber-300">
                          {" "}
                          • ใกล้เต็ม {count("near")}
                        </span>
                      ) : null}
                      {count("critical") > 0 ? (
                        <span className="font-medium text-rose-300">
                          {" "}
                          • เกือบหมด {count("critical")}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                {data.plan !== "ultimate" ? (
                  <Link
                    href="/upgrade"
                    className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-emerald-400/20 bg-white/10 px-2.5 text-[11px] font-medium text-emerald-300"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden /> อัปเกรด
                  </Link>
                ) : null}
              </div>
            </section>

            <div className="flex items-center justify-between pt-1">
              <h2 className="flex items-center gap-1.5 text-xs font-bold">
                <Layers className="h-4 w-4 text-primary" aria-hidden /> รายการโควตาหลัก (
                {data.main.length} รายการ)
              </h2>
              <span className="text-[11px] text-muted">แตะเพื่อดูรายละเอียด</span>
            </div>
            <ul className="space-y-2" aria-label="รายการโควตาหลัก">
              {data.main.map((item) => (
                <QuotaRow key={item.key} item={item} onOpen={() => setOpen(item)} />
              ))}
            </ul>

            <section className="space-y-2">
              <button
                type="button"
                aria-expanded={othersOpen}
                aria-controls="quota-others"
                onClick={() => setOthersOpen((o) => !o)}
                className="flex h-11 w-full items-center justify-between rounded-2xl border border-border bg-surface px-3 text-xs font-bold"
              >
                โควตาอื่น ๆ ({data.others.length} รายการ)
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted transition-transform",
                    othersOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              <ul
                id="quota-others"
                hidden={!othersOpen}
                className="space-y-2"
                aria-label="โควตาอื่น ๆ"
              >
                {data.others.map((item) => (
                  <QuotaRow key={item.key} item={item} onOpen={() => setOpen(item)} />
                ))}
              </ul>
            </section>

            <section className="space-y-2 rounded-2xl border border-border bg-surface p-4 text-center">
              <p className="text-xs text-muted">มีข้อสงสัยเรื่องโควตา ถามพี่ฮูกในแชทได้เลย</p>
              <button
                type="button"
                onClick={backToChat}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary-soft px-3.5 text-xs font-semibold text-primary"
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> กลับไปคุยกับพี่ฮูก
              </button>
            </section>
          </>
        )}
      </div>

      {data ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] text-muted">แผนปัจจุบัน</p>
            <p className="truncate text-xs font-bold">
              {PLAN_LABEL[data.plan]}
              {data.plan !== "free" && data.planExpiresAt
                ? ` · ถึง ${formatThaiDate(new Date(data.planExpiresAt))}`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={quota.reload}
              aria-label="รีเฟรชโควตา"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border"
            >
              <RotateCw className={cn("h-4 w-4", quota.loading && "animate-spin")} aria-hidden />
            </button>
            {data.plan !== "ultimate" ? (
              <Link
                href="/upgrade"
                className="flex h-10 items-center gap-1.5 rounded-xl bg-[#047A36] px-3.5 text-xs font-semibold text-white"
              >
                <ArrowUpCircle className="h-4 w-4" aria-hidden /> อัปเกรดแพ็กเกจ
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {open && data ? (
        <DetailSheet item={open} plan={data.plan} onClose={() => setOpen(null)} />
      ) : null}
    </main>
  );
}
