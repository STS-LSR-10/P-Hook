import Link from "next/link";
import {
  FEEDBACK_PAGE_SIZE,
  type FeedbackItem,
  type FeedbackPage,
  type FeedbackQuery,
} from "@/lib/admin/dashboard-data";
import { AdminTabs } from "./tabs";
import { COLORS, Missing, Panel } from "./panels";

const PLAN_NAMES: Record<FeedbackItem["plan"], string> = {
  free: "Free",
  plus: "Pro",
  ultimate: "Elite",
};

/** The address of a list view: a filter that is "all" and the first page are left out. */
export function feedbackHref(query: FeedbackQuery): string {
  const p = new URLSearchParams();
  if (query.source !== "all") p.set("source", query.source);
  if (query.plan !== "all") p.set("plan", query.plan);
  if (query.page > 1) p.set("page", String(query.page));
  const qs = p.toString();
  return qs ? `/admin/feedback?${qs}` : "/admin/feedback";
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
        on
          ? "border-primary bg-primary-soft text-primary"
          : "border-border bg-surface text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

const SOURCES: { value: FeedbackQuery["source"]; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "line", label: "LINE" },
  { value: "app", label: "แอป" },
];
const PLANS: { value: FeedbackQuery["plan"]; label: string }[] = [
  { value: "all", label: "ทุกแพ็กเกจ" },
  { value: "free", label: "Free" },
  { value: "plus", label: "Pro" },
  { value: "ultimate", label: "Elite" },
];

/** The "ข้อเสนอแนะ" tab: what users wrote to us, 20 a page, with filters on where and from which plan. */
export function FeedbackView({
  query,
  page,
  counts,
  total,
}: {
  query: FeedbackQuery;
  page: FeedbackPage | null;
  counts: { all: number; line: number; app: number } | null;
  total: number | null;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{`
        @keyframes admin-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .admin-rise { animation: admin-rise .5s cubic-bezier(.2,.7,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .admin-rise { animation: none } }
      `}</style>
      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="admin-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            P-Hook · Admin
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">ข้อเสนอแนะจากผู้ใช้</h1>
        </header>

        <AdminTabs active="feedback" feedbackTotal={total} />

        <Panel
          title="รายการล่าสุดก่อน"
          tag="Feedback"
          color={COLORS.line}
          cost={page ? page.total.toLocaleString("th-TH") : "—"}
          costSub={page ? "รายการที่ตรงกับตัวกรอง" : undefined}
          delay={120}
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="ที่มา">
              {SOURCES.map((s) => (
                <Chip
                  key={s.value}
                  on={query.source === s.value}
                  href={feedbackHref({ ...query, source: s.value, page: 1 })}
                >
                  {s.label}
                  {counts ? (
                    <span className="tabular-nums text-muted">
                      {counts[s.value].toLocaleString("th-TH")}
                    </span>
                  ) : null}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="แพ็กเกจ">
              {PLANS.map((p) => (
                <Chip
                  key={p.value}
                  on={query.plan === p.value}
                  href={feedbackHref({ ...query, plan: p.value, page: 1 })}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
          </div>

          {page === null ? (
            <Missing reason="failed" />
          ) : page.items.length === 0 ? (
            <p className="text-sm text-muted">ไม่มีข้อเสนอแนะที่ตรงกับตัวกรองนี้</p>
          ) : (
            <ul className="divide-y divide-border">
              {page.items.map((f) => (
                <li key={f.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span
                      className="rounded-full px-2 py-0.5 font-semibold text-white"
                      style={{ background: f.source === "line" ? COLORS.line : COLORS.plan }}
                    >
                      {f.source === "line" ? "จาก LINE" : "จากแอป"}
                    </span>
                    <span className="font-semibold">{f.name ?? "ไม่ทราบชื่อ"}</span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-muted">
                      {PLAN_NAMES[f.plan]}
                    </span>
                    <time className="ml-auto text-muted tabular-nums" dateTime={f.createdAt}>
                      {new Date(f.createdAt).toLocaleString("th-TH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Bangkok",
                      })}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{f.body}</p>
                </li>
              ))}
            </ul>
          )}

          {page && page.pages > 1 ? (
            <nav
              aria-label="เปลี่ยนหน้า"
              className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm"
            >
              {page.page > 1 ? (
                <Link
                  className="font-semibold text-primary"
                  href={feedbackHref({ ...query, page: page.page - 1 })}
                >
                  ← ก่อนหน้า
                </Link>
              ) : (
                <span className="text-muted">← ก่อนหน้า</span>
              )}
              <span className="tabular-nums text-muted">
                หน้า {page.page} / {page.pages} · ครั้งละ {FEEDBACK_PAGE_SIZE} รายการ
              </span>
              {page.page < page.pages ? (
                <Link
                  className="font-semibold text-primary"
                  href={feedbackHref({ ...query, page: page.page + 1 })}
                >
                  ถัดไป →
                </Link>
              ) : (
                <span className="text-muted">ถัดไป →</span>
              )}
            </nav>
          ) : null}
        </Panel>
      </main>
    </div>
  );
}
