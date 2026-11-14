"use client";

import {
  ArrowLeftRight,
  ArrowUpDown,
  BarChart3,
  Bell,
  BellRing,
  CalendarClock,
  CalendarRange,
  Check,
  CreditCard,
  Crown,
  FileDown,
  FileSpreadsheet,
  Gift,
  Globe,
  HandCoins,
  Image as ImageIcon,
  LayoutDashboard,
  ListPlus,
  Lock,
  Mail,
  MessageSquareText,
  Mic,
  Minus,
  Palette,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  ScanLine,
  Search,
  Shapes,
  Sparkles,
  Store,
  Tag,
  Target,
  Trash2,
  TrendingUp,
  Undo2,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { Logo } from "@/components/logo";
import { PaySheet } from "@/components/liff/pay-sheet";
import { earlyBirdFits } from "@/lib/payments/pay-summary";
import { PageHeader } from "@/components/liff/states";
import { planAction, prepaidUpgradeFor } from "@/lib/payments/policy";
import { PLAN_LABEL, type Plan } from "@/lib/plan";
import {
  EARLY_BIRD_ENDS_AT,
  FEATURE_GROUPS,
  type Cell,
  type FeatureIcon,
  PLAN_HIGHLIGHTS,
  FAIR_USE_NOTE,
  pricingAt,
  yearlyPerDay,
  yearlySavingPercent,
  type PaidPlan,
  type Period,
  type PricingNow,
} from "@/lib/pricing";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface MeLite {
  plan: Plan;
  /** Prices as the server sees them now (launch or normal), so a wrong phone clock cannot mislead. */
  pricing?: PricingNow;
  /** Early Bird seats left, per plan and period (empty when none or already used). */
  earlyBird?: { plan: PaidPlan; period: Period; remaining: number | null; price: number }[];
  planExpiresAt: string | null;
  trial?: { days: number; available: Record<PaidPlan, boolean> };
  payments?: {
    available: boolean;
    canManage?: boolean;
    autoRenew?: boolean;
    prepaidRunning?: boolean;
    period?: Period | null;
    prepaidMonths?: number | null;
  };
}

type Method = "card" | "promptpay";

const PERIODS: { value: Period; label: string }[] = [
  { value: "monthly", label: t("รายเดือน") },
  { value: "yearly", label: t("รายปี") },
];

// Only the badge differs per tier. The card itself is neutral until it is the chosen one, then it
// gets the green frame and the green fill (so the choice is never ambiguous).
const TIER_STYLE: Record<Plan, { chip: string }> = {
  free: { chip: "bg-border text-foreground" },
  starter: { chip: "bg-primary-soft text-primary" },
  plus: { chip: "bg-primary text-surface" },
  ultimate: { chip: "bg-accent text-foreground" },
};

const PAID: PaidPlan[] = ["starter", "plus", "ultimate"];

export default function UpgradePage() {
  const { api, openExternal } = useLiff();
  const me = useApi<MeLite>("/api/me");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("yearly");
  const [picked, setPicked] = useState<PaidPlan>("plus");
  // the plan whose column is tinted in the comparison: follows the chosen plan card until a plan name is tapped
  const [mark, setMark] = useState<Plan | null>("plus");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const current: Plan = me.data?.plan ?? "free";
  const pricing: PricingNow = me.data?.pricing ?? pricingAt(new Date());
  // The same rules the server enforces (src/lib/payments/policy.ts), so the button explains itself.
  const autoRenew = me.data?.payments?.autoRenew === true;
  const prepaidRunning = me.data?.payments?.prepaidRunning === true;
  // Someone with a running plan can only continue the way they pay, so the method is not a choice.
  const fixedMethod: Method | null = autoRenew ? "card" : prepaidRunning ? "promptpay" : null;
  const payWith: Method = fixedMethod ?? "card";
  const billing = {
    plan: current,
    customerId: null,
    subscriptionRunning: autoRenew,
    subscriptionId: autoRenew ? "running" : null,
    period: autoRenew ? (me.data?.payments?.period ?? "monthly") : null,
    prepaidRunning,
    prepaidMonths: prepaidRunning ? (me.data?.payments?.prepaidMonths ?? 1) : null,
    expiresAt: me.data?.planExpiresAt ? new Date(me.data.planExpiresAt) : null,
    trialsUsed: [],
  };
  const action = planAction(billing, { plan: picked, period, method: payWith });
  const blockMessage = action.kind === "blocked" ? action.message : null;
  const topUp = action.kind === "checkout" && current === picked;
  // prepaid time can also be raised to a higher tier by paying only the difference
  const quote = action.kind === "checkout" ? prepaidUpgradeFor(billing, picked) : null;
  const trialDays = me.data?.trial?.days ?? 7;
  const canTry = me.data?.trial?.available[picked] === true;

  async function startTrial() {
    setBusy(true);
    setNotice(null);
    try {
      await api("/api/plan/trial", { method: "POST", body: JSON.stringify({ plan: picked }) });
      setNotice(t("เริ่มทดลองใช้ {0} ฟรี {1} วันแล้ว", PLAN_LABEL[picked], trialDays));
      me.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("เริ่มทดลองใช้ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }
  async function changePlan() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ available: boolean; message?: string }>("/api/plan/change", {
        method: "POST",
        body: JSON.stringify({ plan: picked, period }),
      });
      if (res.available) {
        setNotice(t("เปลี่ยนแผนเรียบร้อย ตัดเฉพาะส่วนต่างจากบัตรที่ใช้สมัครไว้แล้ว"));
        me.reload();
      } else {
        setNotice(res.message ?? t("เปลี่ยนแผนไม่สำเร็จ"));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำรายการไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }
  /** `showedEarly`: the person was shown an Early Bird price, so a page at the normal price must not open unannounced. */
  async function checkout(upgrade = false, method: Method = payWith, showedEarly = false) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{
        available: boolean;
        message?: string;
        url?: string;
        earlyBird?: boolean;
      }>("/api/plan/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: picked, period, method, upgrade }),
      });
      // Stripe opens in the phone browser: PromptPay needs a banking app, and the LINE in-app
      // browser cannot always hand over to one.
      if (res.available && res.url && showedEarly && res.earlyBird !== true) {
        // the last seat went while the person was looking: say so and show the normal price, do not open it
        setNotice(
          t("ที่นั่ง Early Bird หมดไปแล้ว ตอนนี้เป็นราคาปกติ กดชำระเงินอีกครั้งถ้ายังต้องการ"),
        );
        me.reload();
      } else if (res.available && res.url) await openExternal(res.url);
      else setNotice(res.message ?? t("ยังไม่เปิดให้ชำระเงิน"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำรายการไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function manage() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ available: boolean; message?: string; url?: string }>(
        "/api/plan/portal",
        { method: "POST", body: "{}" },
      );
      if (res.available && res.url) await openExternal(res.url);
      else setNotice(res.message ?? t("เปิดหน้าจัดการไม่สำเร็จ"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำรายการไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <PageHeader title={t("อัปเกรด")} />

      <div className="space-y-4 px-4 pb-24">
        <section
          aria-label={t("แนะนำแผน")}
          className="flex items-center gap-3 rounded-3xl border border-border bg-gradient-to-br from-primary-soft via-surface to-accent/15 p-4"
        >
          <Logo size={64} />
          <div className="min-w-0">
            <p className="text-base font-bold">{t("พี่ฮูกได้เต็มที่ขึ้น")}</p>
            <p className="text-sm text-muted">
              {t("แผนของคุณตอนนี้:")} <span className="font-semibold">{PLAN_LABEL[current]}</span>
            </p>
          </div>
        </section>

        <div role="radiogroup" aria-label={t("รอบชำระเงิน")} className="grid grid-cols-2 gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "relative h-11 rounded-2xl border text-sm font-semibold",
                period === p.value
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-muted",
              )}
            >
              {p.label}
              {p.value === "yearly" ? (
                <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-foreground">
                  {t("คุ้มสุด")}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div role="radiogroup" aria-label={t("เลือกแผน")} className="space-y-3">
          <PlanCard plan="free" current={current} pricing={pricing} />
          {PAID.map((plan) => (
            <PlanCard
              key={plan}
              plan={plan}
              current={current}
              pricing={pricing}
              period={period}
              early={
                earlyBirdFits(payWith, period)
                  ? me.data?.earlyBird?.find(
                      (o) =>
                        o.plan === plan &&
                        o.period === period &&
                        (o.remaining === null || o.remaining > 0),
                    )
                  : undefined
              }
              selected={picked === plan}
              onSelect={() => {
                setPicked(plan);
                setMark(plan);
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={action.kind === "change" ? changePlan : () => setSheetOpen(true)}
          disabled={busy || !me.data || action.kind === "blocked"}
          className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
        >
          {busy
            ? t("กำลังดำเนินการ...")
            : action.kind === "change"
              ? t(
                  "อัปเกรดแผน · {0} ({1})",
                  PLAN_LABEL[picked],
                  period === "yearly" ? t("รายปี") : t("รายเดือน"),
                )
              : `${topUp ? t("ต่ออายุ") : t("ชำระเงิน")} · ${PLAN_LABEL[picked]}`}
        </button>
        {quote ? (
          <button
            type="button"
            onClick={() => checkout(true)}
            disabled={busy}
            className="h-12 w-full rounded-2xl border border-primary text-base font-semibold text-primary disabled:opacity-60"
          >
            {t("อัปเกรดส่วนที่เหลือ · จ่ายส่วนต่าง ฿")}
            {quote.amountBaht}
          </button>
        ) : null}
        {quote ? (
          <p className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-foreground">
            {t("ใช้")} {PLAN_LABEL[picked]} {t("ต่อจนถึงวันหมดอายุเดิม (อีก")} {quote.days}{" "}
            {t("วัน)")}
            {t(
              "โดยจ่ายเฉพาะส่วนต่างของราคา ถ้าอยากต่อเวลาเพิ่ม ให้กดปุ่มด้านบน (ซื้อรอบใหม่เต็มราคา",
            )}
            {t("ต่อท้ายเวลาที่เหลือ)")}
          </p>
        ) : null}
        {canTry ? (
          <button
            type="button"
            onClick={startTrial}
            disabled={busy}
            className="h-12 w-full rounded-2xl border-2 border-accent bg-accent/15 text-base font-semibold text-foreground disabled:opacity-60"
          >
            {t("ทดลองใช้")} {PLAN_LABEL[picked]} {t("ฟรี")} {trialDays} {t("วัน")}
          </button>
        ) : null}
        {canTry ? (
          <p className="text-xs text-foreground/80">
            {t("ไม่ต้องใช้บัตร ครบ")} {trialDays}{" "}
            {t("วันแผนจะกลับเป็น Free เอง (ทดลองได้ครั้งเดียวต่อแผน)")}
          </p>
        ) : null}
        {action.kind === "change" ? (
          <p className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-foreground">
            {t(
              "จ่ายเฉพาะส่วนต่าง: Stripe หักเวลาที่ยังไม่ได้ใช้ของแผนเดิม แล้วคิดแผนใหม่ ตัดจากบัตรที่ใช้สมัครไว้ทันที",
            )}
          </p>
        ) : null}
        {blockMessage ? (
          <p className="rounded-2xl bg-accent/15 px-4 py-2 text-sm text-foreground">
            {blockMessage}
          </p>
        ) : null}
        {me.data?.payments?.canManage ? (
          <button
            type="button"
            onClick={manage}
            disabled={busy}
            className="h-11 w-full rounded-2xl border border-primary text-sm font-semibold text-primary disabled:opacity-60"
          >
            {t("จัดการการชำระเงิน (ยกเลิกต่ออายุ / เปลี่ยนบัตร)")}
          </button>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
            {notice}
          </p>
        ) : null}
        <p className="flex items-start gap-1 text-xs text-muted">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {t("ยังไม่มีเงินสด? สะสมเหรียญจากการจดทุกวันแล้วแลกเป็นวันใช้ Pro ได้ที่หน้าตั้งค่า")}
        </p>

        <Comparison mark={mark} onMark={(p) => setMark((m) => (m === p ? null : p))} />
      </div>
      {sheetOpen ? (
        <PaySheet
          plan={picked}
          period={period}
          price={pricing.prices[picked]}
          earlyBaht={
            me.data?.earlyBird?.find(
              (o) =>
                o.plan === picked &&
                o.period === period &&
                (o.remaining === null || o.remaining > 0),
            )?.price ?? null
          }
          fixedMethod={fixedMethod}
          expiresAt={me.data?.planExpiresAt ? new Date(me.data.planExpiresAt) : null}
          busy={busy}
          onPay={async (m, showedEarly) => {
            await checkout(false, m, showedEarly);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </main>
  );
}

function PlanCard({
  plan,
  current,
  pricing,
  period,
  early,
  selected,
  onSelect,
}: {
  plan: Plan;
  current: Plan;
  pricing: PricingNow;
  period?: Period;
  early?: { remaining: number | null; price: number };
  selected?: boolean;
  onSelect?: () => void;
}) {
  const style = TIER_STYLE[plan];
  const price = plan === "free" ? null : pricing.prices[plan];
  const listPrice = plan === "free" ? null : pricing.list[plan];
  const isCurrent = current === plan;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-base font-bold">
          {plan === "ultimate" ? <Crown className="h-4 w-4" aria-hidden /> : null}
          {PLAN_LABEL[plan]}
        </p>
        {isCurrent ? (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", style.chip)}>
            {t("แผนของคุณ")}
          </span>
        ) : null}
      </div>

      {price && period ? (
        <div>
          {pricing.launch && listPrice ? (
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-accent/20 px-2 py-0.5 font-semibold text-foreground">
                {t("ราคาเปิดตัว ถึง")} {pricing.endsText}
              </span>
              <span className="num text-foreground/80 line-through">
                <span className="sr-only">{t("ราคาปกติ")} </span>
                {t("฿")}
                {listPrice[period]}
              </span>
            </p>
          ) : null}
          <p className="num text-2xl font-extrabold">
            ฿{price[period]}
            <span className="ml-1 text-sm font-medium text-foreground/80">
              /{period === "monthly" ? t("เดือน") : t("ปี")}
            </span>
          </p>
          {early && period ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-accent/20 px-2 py-0.5 font-semibold text-foreground">
                Early Bird {period === "yearly" ? t("ปีแรก") : t("เดือนแรก")} ฿{early.price}
              </span>
              {early.remaining !== null ? (
                <span className="text-foreground/80">
                  {t("เหลือ")} {early.remaining} {t("สิทธิ์")}
                </span>
              ) : null}
              <span className="text-foreground/80">
                {t("ถึง {0}", formatThaiDate(new Date(Date.parse(EARLY_BIRD_ENDS_AT) - 1)))}
              </span>
            </p>
          ) : null}
          {period === "yearly" ? (
            <p className="text-xs text-foreground/80">
              {t("≈ ฿")}
              {yearlyPerDay(price)} {t("ต่อวัน · ประหยัด")} {yearlySavingPercent(price)}%
            </p>
          ) : (
            <p className="text-xs text-foreground/80">
              {t("หรือรายปี ฿")}
              {price.yearly}
            </p>
          )}
        </div>
      ) : (
        <p className="num text-2xl font-extrabold">{t("฿0")}</p>
      )}

      <ul className="space-y-1 text-sm">
        {PLAN_HIGHLIGHTS[plan].map((h) => (
          <li key={h} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            {h}
          </li>
        ))}
      </ul>
    </>
  );

  const base = "block w-full space-y-2 rounded-3xl border-2 p-4 text-left";
  if (!onSelect) return <div className={cn(base, "border-border bg-background")}>{body}</div>;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        base,
        selected ? "border-primary bg-primary-soft shadow-card" : "border-border bg-surface",
      )}
    >
      {body}
    </button>
  );
}

const ICONS: Record<FeatureIcon, LucideIcon> = {
  text: MessageSquareText,
  shapes: Shapes,
  undo: Undo2,
  slip: ScanLine,
  calendar: CalendarClock,
  list: ListPlus,
  tag: Tag,
  image: ImageIcon,
  receipt: Receipt,
  sparkles: Sparkles,
  mic: Mic,
  globe: Globe,
  repeat: Repeat,
  bell: Bell,
  bellring: BellRing,
  store: Store,
  wallet: Wallet,
  transfer: ArrowLeftRight,
  card: CreditCard,
  users: Users,
  debt: HandCoins,
  target: Target,
  piggy: PiggyBank,
  plane: Plane,
  group: UsersRound,
  chart: BarChart3,
  range: CalendarRange,
  search: Search,
  compare: ArrowUpDown,
  dashboard: LayoutDashboard,
  trend: TrendingUp,
  mail: Mail,
  download: FileDown,
  sheet: FileSpreadsheet,
  lock: Lock,
  palette: Palette,
  trash: Trash2,
  gift: Gift,
};

function CellView({ cell, tone }: { cell: Cell; tone: "pro" | "plain" }) {
  if (typeof cell === "string") {
    return (
      <span
        className={cn(
          "block text-xs font-semibold leading-tight",
          tone === "pro" ? "text-primary" : "text-foreground",
        )}
      >
        {cell}
      </span>
    );
  }
  if (!cell) {
    return (
      <>
        <Minus className="mx-auto h-4 w-4 text-muted" aria-hidden />
        <span className="sr-only">{t("ไม่มี")}</span>
      </>
    );
  }
  return (
    <>
      <Check
        className={cn("mx-auto h-5 w-5", tone === "pro" ? "text-primary" : "text-foreground")}
        aria-hidden
      />
      <span className="sr-only">{t("มี")}</span>
    </>
  );
}

/** What each plan can do: short rows, a tick where the plan has it and a dash where it does not. */
const COMPARE_PLANS: Plan[] = ["free", "starter", "plus", "ultimate"];

/** `mark`: the plan whose whole column is tinted (tap a plan name to move or clear it). */
function Comparison({ mark, onMark }: { mark: Plan | null; onMark: (plan: Plan) => void }) {
  // a thin divider between plans, and the marked plan's cells tinted top to bottom
  const col = (i: number) =>
    cn(i > 0 && "border-l border-border", mark === COMPARE_PLANS[i] && "bg-primary-soft");
  return (
    <section
      aria-label={t("เปรียบเทียบแผน")}
      // relative: the sr-only labels in the table are absolute, and without it they sit against the page and widen it
      className="relative overflow-hidden rounded-3xl border border-border bg-surface"
    >
      <h2 id="compare-title" className="px-4 pb-1 pt-4 text-base font-bold">
        {t("ทำอะไรได้บ้าง?")}
      </h2>
      {/* only the table scrolls sideways: the title above, and the group names and feature names
          inside, stay at the left edge. Focusable so a keyboard can scroll it. */}
      <div role="group" aria-labelledby="compare-title" tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-[436px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[132px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
          </colgroup>
          <thead>
            <tr className="text-xs">
              {/* a real blank cell at the left edge, like the feature names below it, so a plan name
                  that scrolls under it is hidden with its column instead of floating over it */}
              <th scope="col" className="sticky left-0 z-10 border-r border-border bg-surface">
                <span className="sr-only">{t("ฟีเจอร์")}</span>
              </th>
              {COMPARE_PLANS.map((p, i) => (
                <th key={p} scope="col" className={cn("px-1 py-2", col(i))}>
                  <button
                    type="button"
                    aria-pressed={mark === p}
                    aria-label={`${t("ไฮไลต์แผน")} ${PLAN_LABEL[p]}`}
                    onClick={() => onMark(p)}
                    className={cn(
                      "h-8 rounded-full px-2.5 text-xs font-semibold",
                      mark === p
                        ? "bg-primary text-surface"
                        : p === "plus"
                          ? "text-primary"
                          : "text-foreground",
                    )}
                  >
                    {PLAN_LABEL[p]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          {FEATURE_GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr>
                <th
                  colSpan={5}
                  scope="colgroup"
                  className="pb-1 pt-4 text-left text-xs font-bold text-muted"
                >
                  <span className="sticky left-4 inline-block">{group.title}</span>
                </th>
              </tr>
              {group.rows.map((row) => {
                const Icon = ICONS[row.icon];
                return (
                  <tr key={row.label} className="border-t border-border">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-border bg-surface py-3 pl-3 pr-1 text-left text-sm font-normal"
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                        <span>{row.label}</span>
                      </span>
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className={cn("px-1 py-3 text-center", col(i))}>
                        <CellView cell={cell} tone={i === 2 ? "pro" : "plain"} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-muted">{FAIR_USE_NOTE}</p>
    </section>
  );
}
