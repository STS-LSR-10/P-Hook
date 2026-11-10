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
import { PageHeader } from "@/components/liff/states";
import { planAction, prepaidUpgradeFor } from "@/lib/payments/policy";
import { PLAN_LABEL, type Plan } from "@/lib/plan";
import {
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

const METHODS: { value: Method; label: string; hint: string }[] = [
  {
    value: "card",
    label: t("บัตรเครดิต/เดบิต"),
    hint: t("บัตรในประเทศและต่างประเทศ ต่ออายุอัตโนมัติ ยกเลิกได้ทุกเมื่อ"),
  },
  {
    value: "promptpay",
    label: t("พร้อมเพย์ (QR)"),
    hint: t("จ่ายครั้งเดียวต่อรอบ สแกน QR ผ่านแอปธนาคาร ไม่ต่ออายุอัตโนมัติ"),
  },
];

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
  const [method, setMethod] = useState<Method>("card");
  const [period, setPeriod] = useState<Period>("yearly");
  const [picked, setPicked] = useState<PaidPlan>("plus");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const current: Plan = me.data?.plan ?? "free";
  const pricing: PricingNow = me.data?.pricing ?? pricingAt(new Date());
  // The same rules the server enforces (src/lib/payments/policy.ts), so the button explains itself.
  const autoRenew = me.data?.payments?.autoRenew === true;
  const prepaidRunning = me.data?.payments?.prepaidRunning === true;
  // Someone with a running plan can only continue the way they pay, so the method is not a choice.
  const payWith: Method = autoRenew ? "card" : prepaidRunning ? "promptpay" : method;
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
  async function checkout(upgrade = false) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ available: boolean; message?: string; url?: string }>(
        "/api/plan/checkout",
        {
          method: "POST",
          body: JSON.stringify({ plan: picked, period, method: payWith, upgrade }),
        },
      );
      // Stripe opens in the phone browser: PromptPay needs a banking app, and the LINE in-app
      // browser cannot always hand over to one.
      if (res.available && res.url) await openExternal(res.url);
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
                method === "card" || period === "yearly"
                  ? me.data?.earlyBird?.find(
                      (o) =>
                        o.plan === plan &&
                        o.period === period &&
                        (o.remaining === null || o.remaining > 0),
                    )
                  : undefined
              }
              selected={picked === plan}
              onSelect={() => setPicked(plan)}
            />
          ))}
        </div>

        {autoRenew || prepaidRunning ? null : (
          <div role="radiogroup" aria-label={t("ช่องทางชำระเงิน")} className="space-y-2">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                onClick={() => setMethod(m.value)}
                className={cn(
                  "block w-full rounded-2xl border p-3 text-left",
                  method === m.value
                    ? "border-primary bg-primary-soft"
                    : "border-border bg-surface",
                )}
              >
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-foreground/80">{m.hint}</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={action.kind === "change" ? changePlan : () => checkout(false)}
          disabled={busy || action.kind === "blocked"}
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

        <Comparison />
      </div>
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
function Comparison() {
  return (
    <section
      aria-label={t("เปรียบเทียบแผน")}
      className="overflow-hidden rounded-3xl border border-border bg-surface"
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
              <th scope="col" className="sr-only">
                {t("ฟีเจอร์")}
              </th>
              <th scope="col" className="py-2 font-semibold">
                Free
              </th>
              <th scope="col" className="py-2 font-semibold">
                Starter
              </th>
              <th scope="col" className="py-2 font-semibold text-primary">
                Pro
              </th>
              <th scope="col" className="py-2 font-semibold">
                Elite
              </th>
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
                      className="sticky left-0 border-r border-border bg-surface py-3 pl-3 pr-1 text-left text-sm font-normal"
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                        <span>{row.label}</span>
                      </span>
                    </th>
                    {row.cells.map((cell, i) => (
                      <td key={i} className="px-1 py-3 text-center">
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
