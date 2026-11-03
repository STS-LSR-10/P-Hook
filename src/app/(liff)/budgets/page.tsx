"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MiniBarChart } from "@/components/liff/lazy-charts";
import { PlusLock } from "@/components/liff/settings/plus-lock";
import { ProgressBar } from "@/components/liff/progress-bar";
import { Sheet } from "@/components/liff/sheet";
import { sliceColor } from "@/components/liff/slice-color";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/liff/states";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { budgetState, percentUsed } from "@/lib/budget";
import { MAX_START_DAY } from "@/lib/budget-cycle";
import { EMOJI_CHOICES, isSingleEmoji } from "@/lib/category-emoji";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { currencySymbol, currencyUnit, formatBaht, money } from "@/lib/money";
import { formatThaiMonthShort } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { t as tr } from "@/lib/i18n";

type Kind = "expense" | "income";

interface CategoryItem {
  id: string;
  type: Kind;
  name: string;
  own: boolean;
  keywords: string[];
  color: string | null;
  /** One emoji shown in front of the name (custom categories only). */
  emoji: string | null;
  isHidden: boolean;
  sortOrder: number;
  isFallback: boolean;
}

interface BudgetsResponse {
  mode: "overall" | "category";
  cycle: "monthly" | "weekly";
  cycleStartDay?: number;
  overall: { amountSatang: number | null; spentSatang: number };
  /** The limit for one day (Pro and above) and today's spending. */
  daily?: { amountSatang: number | null; spentSatang: number };
  /** What came in this cycle, per income category. */
  income?: { categoryId: string; receivedSatang: number }[];
  categories: {
    categoryId: string;
    name: string;
    color: string | null;
    amountSatang: number | null;
    spentSatang: number;
  }[];
}

const SWATCHES = [
  "#0F766E",
  "#0369A1",
  "#7C3AED",
  "#DB2777",
  "#E11D48",
  "#D97706",
  "#CA8A04",
  "#059669",
  "#475569",
];
const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;
const QUICK_ADD = [500, 1000, 3000, 5000];
const TIP_KEY = "jt_budget_tip_off";

function parseAmount(input: string): { ok: true; value: string | null } | { ok: false } {
  const text = normalizeThaiDigits(input).replace(/,/g, "").trim();
  if (text === "") return { ok: true, value: null };
  if (!AMOUNT_PATTERN.test(text)) return { ok: false };
  return { ok: true, value: text };
}

function keywordsFromText(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  );
}

/** A category's tile colour: its own pick when it is a custom one, else the pastel palette by place. */
function tileColor(c: CategoryItem, index: number): string {
  return c.own && c.color ? c.color : sliceColor(null, index);
}

function Tile({ c, index }: { c: CategoryItem; index: number }) {
  const color = tileColor(c, index);
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
      style={{ backgroundColor: `${color}26` }}
    >
      {c.emoji ?? <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />}
    </span>
  );
}

function QuickAmounts({ onAdd }: { onAdd: (amount: number) => void }) {
  return (
    <div className="flex gap-1.5" aria-label={tr("เพิ่มยอดอย่างเร็ว")} role="group">
      {QUICK_ADD.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onAdd(n)}
          className="num h-9 flex-1 rounded-lg bg-background text-[11px] font-medium"
        >
          +{currencySymbol()}
          {n.toLocaleString("th-TH")}
        </button>
      ))}
    </div>
  );
}

/** The amount in a text box (satang in, plain baht text out) plus the quick "+500" buttons. */
function addToAmount(text: string, add: number): string {
  const parsed = parseAmount(text);
  const current = parsed.ok && parsed.value ? Number(parsed.value) : 0;
  return String(current + add);
}

/** What Free sees instead of the add form: the feature is Pro and above. */
function CustomCategoryLockedSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={tr("หมวดของตัวเอง")} onClose={onClose}>
      <div className="space-y-3 text-center">
        <p className="text-base font-semibold">{tr("สร้างหมวดของตัวเองสำหรับแผน Pro")}</p>
        <p className="text-sm text-muted">
          {tr(
            "เพิ่มหมวดเฉพาะตัว เช่น “ค่าอาหารแมว” พร้อมเลือกอีโมจิ ลองใช้ฟรี 7 วันได้ที่หน้าอัปเกรด",
          )}
          {tr("ตอนนี้ใช้หมวดมาตรฐานและปรับคำค้นได้ตามเดิม")}
        </p>
        <Link
          href="/upgrade"
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-surface"
        >
          {tr("ดูแผน Pro")}
        </Link>
      </div>
    </Sheet>
  );
}

/** Pick one emoji from the grid, or type your own; empty means none. */
function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const valid = value === "" || isSingleEmoji(value);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{tr("อีโมจิ (ไม่บังคับ)")}</p>
      <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label={tr("เลือกอีโมจิ")}>
        {EMOJI_CHOICES.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={value === e}
            aria-label={tr("อีโมจิ {0}", e)}
            onClick={() => onChange(value === e ? "" : e)}
            className={cn(
              "flex h-10 items-center justify-center rounded-xl border text-xl",
              value === e ? "border-primary bg-primary-soft" : "border-transparent",
            )}
          >
            <span aria-hidden>{e}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={16}
          placeholder={tr("หรือพิมพ์อีโมจิเอง")}
          aria-label={tr("อีโมจิ (พิมพ์เอง)")}
          aria-invalid={!valid}
          className="h-11 w-full rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="h-11 shrink-0 rounded-2xl border border-border px-3 text-sm text-muted"
          >
            {tr("ล้าง")}
          </button>
        ) : null}
      </div>
      {!valid ? (
        <p className="text-xs text-expense">{tr("ใส่ได้เป็นอีโมจิตัวเดียวเท่านั้นนะ")}</p>
      ) : null}
    </div>
  );
}

function DailyBudgetCard({
  daily,
  locked,
  onSave,
}: {
  daily: { amountSatang: number | null; spentSatang: number };
  locked: boolean;
  onSave: (value: string | null) => void;
}) {
  const initial = daily.amountSatang ? formatBaht(daily.amountSatang).replace(/,/g, "") : "";
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function save() {
    const parsed = parseAmount(text);
    if (!parsed.ok) return setError(tr("จำนวนเงินไม่ถูกต้อง (เช่น 500 หรือ 500.50)"));
    setError(null);
    onSave(parsed.value);
  }

  return (
    <section
      aria-label={tr("งบรายวัน")}
      className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{tr("งบรายวัน")}</h2>
        <span className="text-xs text-muted">{tr("ทุกหมวดรวมกัน")}</span>
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={locked}
          inputMode="decimal"
          placeholder={tr("วันหนึ่งใช้ไม่เกิน ({0})", currencyUnit())}
          aria-label={tr("งบรายวัน")}
          className="num h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary disabled:opacity-60"
        />
        <button
          type="button"
          onClick={save}
          disabled={locked}
          className="h-11 rounded-2xl bg-primary px-4 text-sm font-semibold text-surface disabled:opacity-40"
        >
          {tr("บันทึก")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-expense">
          {error}
        </p>
      ) : null}
      {daily.amountSatang ? (
        <>
          <p className="text-xs text-muted">{tr("วันนี้")}</p>
          <ProgressBar
            spentSatang={daily.spentSatang}
            limitSatang={daily.amountSatang}
            label={tr("การใช้งบวันนี้")}
          />
        </>
      ) : (
        <p className="text-xs text-muted">
          {tr("ยังไม่ได้ตั้งงบรายวัน วันนี้ใช้ไปแล้ว")} {money(daily.spentSatang)}
        </p>
      )}
      {locked ? (
        <PlusLock>{tr("บอทเตือนทันทีเมื่อวันนี้ใช้เกินวงเงินที่ตั้งไว้")}</PlusLock>
      ) : (
        <p className="text-xs text-muted">
          {tr("ถ้าวันนี้ใช้เกิน บอทจะเตือนในแชททันที เว้นว่างเพื่อปิด")}
        </p>
      )}
    </section>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("สี")}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn(
            "h-9 w-9 rounded-full border-2",
            value === c ? "border-foreground" : "border-transparent",
          )}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

const fieldClass =
  "h-12 w-full rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary";

function AddSheet({
  kind,
  onClose,
  onSaved,
}: {
  kind: Kind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [color, setColor] = useState(SWATCHES[0] ?? "#0F766E");
  const [emoji, setEmoji] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(tr("ใส่ชื่อหมวดด้วยนะ"));
    if (emoji !== "" && !isSingleEmoji(emoji))
      return setError(tr("ใส่ได้เป็นอีโมจิตัวเดียวเท่านั้นนะ"));
    setSaving(true);
    setError(null);
    try {
      await api("/api/categories", {
        method: "POST",
        body: JSON.stringify({
          type: kind,
          name: name.trim(),
          keywords: keywordsFromText(keywords),
          color,
          emoji: emoji || null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("บันทึกไม่สำเร็จ"));
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={tr("เพิ่มหมวด{0}", kind === "expense" ? tr("รายจ่าย") : tr("รายรับ"))}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          placeholder={tr("ชื่อหมวด เช่น สัตว์เลี้ยง")}
          aria-label={tr("ชื่อหมวด")}
          className={fieldClass}
        />
        <textarea
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder={tr("คำค้นสำหรับจัดหมวดอัตโนมัติ คั่นด้วยคอมมา เช่น อาหารแมว, ทราย")}
          aria-label={tr("คำค้น")}
          rows={3}
          className="w-full rounded-2xl border border-border bg-background p-4 outline-none focus:border-primary"
        />
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <ColorPicker value={color} onChange={setColor} />
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
        >
          {saving ? tr("กำลังบันทึก...") : tr("เพิ่มหมวด")}
        </button>
      </form>
    </Sheet>
  );
}

export default function BudgetsPage() {
  const { api } = useLiff();
  const [kind, setKind] = useState<Kind>("expense");
  const cats = useApi<{ items: CategoryItem[] }>("/api/categories?all=1");
  const budgets = useApi<BudgetsResponse>("/api/budgets");
  const me = useApi<{ features: Record<string, boolean> }>("/api/me");
  // Pro and above create and edit their own categories; the server checks it too.
  const locked = !me.loading && me.data !== null && me.data?.features.customCategory !== true;
  // Per-category budgets and the 80% / 100% warnings are Pro and above too.
  const budgetLocked = !me.loading && me.data !== null && me.data?.features.categoryBudget !== true;
  const dailyLocked = !me.loading && me.data !== null && me.data?.features.dailyBudget !== true;
  const alertsOff = !me.loading && me.data !== null && me.data?.features.budgetAlert !== true;
  const historyOn = me.data?.features.dashboard === true;
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [totalOpen, setTotalOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [search, setSearch] = useState("");
  const [tipOff, setTipOff] = useState(true); // hidden until we know (no flash for people who closed it)

  useEffect(() => {
    try {
      setTipOff(window.localStorage.getItem(TIP_KEY) === "1");
    } catch {
      setTipOff(false);
    }
  }, []);

  const all = useMemo(
    () =>
      (cats.data?.items ?? [])
        .filter((c) => c.type === kind)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [cats.data, kind],
  );
  const term = search.trim().toLowerCase();
  const list = term
    ? all.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.keywords.some((k) => k.toLowerCase().includes(term)),
      )
    : all;

  function refresh() {
    cats.reload();
    budgets.reload();
  }

  async function run(action: () => Promise<unknown>, done?: string) {
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : tr("ทำรายการไม่สำเร็จ"));
    }
  }

  const putBudget = (body: Record<string, unknown>, done?: string) =>
    run(() => api("/api/budgets", { method: "PUT", body: JSON.stringify(body) }), done);

  const move = (id: string, delta: -1 | 1) => {
    const index = all.findIndex((c) => c.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= all.length) return;
    const ids = all.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(target, 0, moved);
    void run(() =>
      api("/api/categories/reorder", { method: "POST", body: JSON.stringify({ ids }) }),
    );
  };

  const budgetOf = (categoryId: string) =>
    budgets.data?.categories.find((b) => b.categoryId === categoryId);
  const receivedOf = (categoryId: string) =>
    budgets.data?.income?.find((r) => r.categoryId === categoryId)?.receivedSatang ?? 0;

  const loading = cats.loading || (kind === "expense" && budgets.loading && !budgets.data);
  const error = cats.error ?? (kind === "expense" ? budgets.error : null);

  return (
    <main>
      <PageHeader title={tr("จัดการหมวดและงบ")} />

      <div className="space-y-4 px-4 pb-4">
        <div
          role="tablist"
          aria-label={tr("ประเภทหมวด")}
          className="flex rounded-2xl border border-border bg-background p-1"
        >
          {(["expense", "income"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setSearch("");
                setOrdering(false);
              }}
              className={cn(
                "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs",
                kind === k ? "bg-surface font-semibold text-primary shadow-card" : "text-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 rounded-full",
                  k === "expense" ? "bg-expense" : "bg-primary",
                )}
              />
              {k === "expense" ? tr("หมวดรายจ่าย") : tr("หมวดรายรับ")}
            </button>
          ))}
        </div>

        {notice ? (
          <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
            {notice}
          </p>
        ) : null}

        {loading ? (
          <BudgetsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <>
            {kind === "expense" && budgets.data ? (
              <>
                <BudgetHero
                  data={budgets.data}
                  categoryLocked={budgetLocked}
                  alertsOff={alertsOff}
                  onMode={(mode) => putBudget({ mode })}
                  onAdjust={() => setTotalOpen(true)}
                  onCycle={() => setCycleOpen(true)}
                />
                {budgets.data.daily ? (
                  <DailyBudgetCard
                    daily={budgets.data.daily}
                    locked={dailyLocked}
                    onSave={(value) =>
                      putBudget(
                        { daily: value },
                        value ? tr("ตั้งงบรายวันแล้ว") : tr("ล้างงบรายวันแล้ว"),
                      )
                    }
                  />
                ) : null}
                {tipOff ? null : (
                  <section
                    aria-label={tr("คำแนะนำการตั้งงบ")}
                    className="relative flex items-start gap-3 rounded-2xl border border-border bg-primary-soft p-3.5"
                  >
                    <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                    <div className="flex-1 pr-6">
                      <p className="text-xs font-bold">{tr("คำแนะนำการตั้งงบ 50-30-20")}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-primary">
                        {tr(
                          "ลองจัดงบ 50% สำหรับของจำเป็น (ที่พัก อาหาร) 30% สำหรับความสุข และ 20%",
                        )}
                        {tr("สำหรับเงินออม ช่วยให้คุมค่าใช้จ่ายได้สบายใจขึ้น")}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={tr("ปิดคำแนะนำ")}
                      onClick={() => {
                        setTipOff(true);
                        try {
                          window.localStorage.setItem(TIP_KEY, "1");
                        } catch {
                          /* it just comes back next time */
                        }
                      }}
                      className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </section>
                )}
              </>
            ) : null}

            <section aria-label={tr("จัดการรายการหมวด")} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={tr("ค้นหาหมวดหมู่...")}
                    aria-label={tr("ค้นหาหมวดหมู่")}
                    className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                <button
                  type="button"
                  aria-pressed={ordering}
                  onClick={() => setOrdering((v) => !v)}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-xs font-medium",
                    ordering
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border bg-surface text-muted",
                  )}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
                  {tr("จัดเรียง")}
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex h-11 shrink-0 items-center gap-1 rounded-xl bg-primary px-3 text-xs font-semibold text-surface"
                >
                  {locked ? (
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {tr("เพิ่มหมวด")}
                </button>
              </div>
              <div className="flex items-center justify-between px-1 text-[11px]">
                <span className="text-muted">
                  {tr(
                    "ทั้งหมด {0} หมวดหมู่{1}",
                    all.length,
                    kind === "expense" ? tr("รายจ่าย") : tr("รายรับ"),
                  )}
                </span>
                <span className="font-medium text-primary">
                  {ordering ? tr("กดลูกศรเพื่อเลื่อนลำดับ") : tr("แตะหมวดหมู่เพื่อแก้ไขหรือตั้งงบ")}
                </span>
              </div>
            </section>

            {list.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface shadow-card">
                <EmptyState
                  title={term ? tr("ไม่พบหมวดที่ค้นหา") : tr("ยังไม่มีหมวด")}
                  hint={
                    term ? tr("ลองใช้คำอื่นดูนะ") : tr("กด “เพิ่มหมวด” เพื่อสร้างหมวดของคุณเอง")
                  }
                />
              </div>
            ) : (
              <ul className="space-y-2.5">
                {list.map((c) => {
                  const index = all.findIndex((x) => x.id === c.id);
                  const b = budgetOf(c.id);
                  const showBudget =
                    kind === "expense" && budgets.data?.mode === "category" && !c.isHidden;
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        "rounded-2xl border border-border bg-surface shadow-card",
                        c.isHidden && "opacity-60",
                      )}
                    >
                      <div className="flex items-center">
                        <button
                          type="button"
                          aria-label={tr("แก้ไข {0}", c.name)}
                          disabled={ordering}
                          onClick={() => setEditing(c)}
                          className="min-w-0 flex-1 p-3.5 text-left"
                        >
                          <span className="flex items-center gap-3">
                            <Tile c={c} index={index} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-bold">
                                {c.name}
                                {c.own ? (
                                  <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                                    {tr("ของฉัน")}
                                  </span>
                                ) : null}
                              </span>
                              <span className="block truncate text-[11px] text-muted">
                                {c.isHidden
                                  ? tr("ซ่อนอยู่")
                                  : c.keywords.length
                                    ? c.keywords.join(", ")
                                    : tr("ยังไม่มีคำค้น")}
                              </span>
                            </span>
                            <CategoryAmount
                              kind={kind}
                              showBudget={showBudget}
                              budget={b}
                              received={receivedOf(c.id)}
                              spent={b?.spentSatang ?? 0}
                            />
                            {ordering ? null : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                            )}
                          </span>
                          {showBudget && b?.amountSatang ? (
                            <MiniBar spent={b.spentSatang} limit={b.amountSatang} name={c.name} />
                          ) : null}
                        </button>
                        {ordering ? (
                          <div className="flex shrink-0 pr-1.5">
                            <IconButton
                              label={tr("เลื่อน {0} ขึ้น", c.name)}
                              onClick={() => move(c.id, -1)}
                              disabled={index === 0 || term !== ""}
                            >
                              <ArrowUp className="h-4 w-4" aria-hidden />
                            </IconButton>
                            <IconButton
                              label={tr("เลื่อน {0} ลง", c.name)}
                              onClick={() => move(c.id, 1)}
                              disabled={index === all.length - 1 || term !== ""}
                            >
                              <ArrowDown className="h-4 w-4" aria-hidden />
                            </IconButton>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {editing ? (
        <CategorySheet
          category={editing}
          index={all.findIndex((c) => c.id === editing.id)}
          locked={locked}
          budget={
            kind === "expense" && budgets.data?.mode === "category"
              ? { amountSatang: budgetOf(editing.id)?.amountSatang ?? null, locked: budgetLocked }
              : null
          }
          cycle={budgets.data?.cycle ?? "monthly"}
          historyOn={historyOn && kind === "expense"}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            refresh();
          }}
        />
      ) : null}
      {totalOpen && budgets.data ? (
        <TotalBudgetSheet
          amountSatang={budgets.data.overall.amountSatang}
          onClose={() => setTotalOpen(false)}
          onSave={(value) => {
            setTotalOpen(false);
            void putBudget({ overall: value }, value ? tr("ตั้งงบแล้ว") : tr("ล้างงบแล้ว"));
          }}
        />
      ) : null}
      {cycleOpen && budgets.data ? (
        <CycleSheet
          cycle={budgets.data.cycle}
          startDay={budgets.data.cycleStartDay ?? 1}
          onClose={() => setCycleOpen(false)}
          onSaved={() => {
            setCycleOpen(false);
            setNotice(tr("บันทึกรอบงบแล้ว"));
            refresh();
          }}
        />
      ) : null}
      {adding && locked ? <CustomCategoryLockedSheet onClose={() => setAdding(false)} /> : null}
      {adding && !locked ? (
        <AddSheet
          kind={kind}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setNotice(tr("เพิ่มหมวดแล้ว"));
            refresh();
          }}
        />
      ) : null}
    </main>
  );
}

/** The pastel green card at the top: budget, how much is used, the budget mode and the cycle. */
function BudgetHero({
  data,
  categoryLocked,
  alertsOff,
  onMode,
  onAdjust,
  onCycle,
}: {
  data: BudgetsResponse;
  categoryLocked: boolean;
  alertsOff: boolean;
  onMode: (mode: "overall" | "category") => void;
  onAdjust: () => void;
  onCycle: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const total =
    data.mode === "overall"
      ? data.overall.amountSatang
      : data.categories.reduce((s, c) => s + (c.amountSatang ?? 0), 0) || null;
  const spent = data.overall.spentSatang;
  const pct = total ? percentUsed(spent, total) : 0;
  const state = total ? budgetState(spent, total) : "ok";
  const remaining = total ? total - spent : null;
  const per = data.cycle === "weekly" ? tr("สัปดาห์") : tr("เดือน");
  const modeText = data.mode === "overall" ? tr("รวมก้อนเดียว") : tr("แยกตามหมวด");

  return (
    <section
      aria-label={tr("งบประมาณ")}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--hero-from)] to-[var(--hero-to)] p-5 text-[var(--hero-ink)] shadow-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/50 blur-2xl"
      />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-[var(--hero-ink-soft)]">
            {tr("งบประมาณประจำ{0}", per)}
          </p>
          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-white/70 bg-white/60 px-3 text-xs font-medium text-[var(--hero-ink)]"
            >
              {modeText}
              <ChevronDown className="h-3 w-3 text-[var(--hero-ink)]" aria-hidden />
            </button>
            {menu ? (
              <div
                role="menu"
                aria-label={tr("รูปแบบงบ")}
                className="absolute right-0 z-20 mt-1.5 w-40 overflow-hidden rounded-xl border border-border bg-surface py-1 text-xs text-foreground shadow-card"
              >
                {(
                  [
                    ["category", tr("แยกตามหมวด")],
                    ["overall", tr("รวมก้อนเดียว")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={data.mode === value}
                    disabled={value === "category" && categoryLocked && data.mode !== "category"}
                    onClick={() => {
                      setMenu(false);
                      if (data.mode !== value) onMode(value);
                    }}
                    className="flex h-10 w-full items-center justify-between px-3 text-left disabled:opacity-40"
                  >
                    {label}
                    {data.mode === value ? (
                      <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-[var(--hero-ink-soft)]">{tr("ยอดงบที่ตั้งไว้ทั้งหมด")}</p>
            <p className="num mt-0.5 truncate text-2xl font-bold">
              {total ? `${money(total)}` : tr("ยังไม่ตั้ง")}
              {total ? (
                <span className="ml-1.5 text-xs font-normal text-[var(--hero-ink-soft)]">
                  / {per}
                </span>
              ) : null}
            </p>
          </div>
          {data.mode === "overall" ? (
            <button
              type="button"
              onClick={onAdjust}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-surface"
            >
              {total ? tr("ปรับงบ") : tr("ตั้งงบ")}
            </button>
          ) : null}
        </div>

        {total ? (
          <div className="space-y-1.5">
            <div className="flex justify-between gap-2 text-[11px] text-[var(--hero-ink-soft)]">
              <span className="num">
                {tr("ใช้ไปแล้ว")} {money(spent)} ({pct}%)
              </span>
              <span className="num font-semibold text-[var(--hero-ink)]">
                {remaining !== null && remaining < 0
                  ? tr("เกินงบ {0}", money(-remaining))
                  : tr("เหลือ {0}", money(remaining ?? 0))}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={tr("การใช้งบ")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(pct, 100)}
              className="h-2.5 overflow-hidden rounded-full bg-white/70 p-0.5"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            {state !== "ok" ? (
              <p className="text-[11px] font-semibold text-[var(--hero-ink)]">
                {state === "over" ? tr("ครบงบแล้ว") : tr("ใกล้ครบงบ")}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-[var(--hero-ink-soft)]">
            {data.mode === "overall"
              ? tr("ยังไม่ได้ตั้งงบ ใช้ไปแล้ว {0} ในรอบนี้", money(spent))
              : tr("ตั้งงบของแต่ละหมวดได้ที่การ์ดด้านล่าง เว้นว่างไว้ถ้าไม่ต้องการจำกัด")}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-white/70 pt-2 text-xs text-[var(--hero-ink-soft)]">
          <span>
            {tr("รอบงบ:")}{" "}
            <strong className="font-semibold text-[var(--hero-ink)]">
              {data.cycle === "weekly"
                ? tr("ทุกวันจันทร์")
                : tr(
                    "ทุกวันที่ {0} ของเดือน{1}",
                    data.cycleStartDay ?? 1,
                    (data.cycleStartDay ?? 1) > 28 ? tr(" (หรือวันสุดท้าย)") : "",
                  )}
            </strong>
          </span>
          <button
            type="button"
            onClick={onCycle}
            aria-label={tr("ตั้งค่ารอบงบ")}
            className="flex h-8 items-center gap-1 font-semibold text-[var(--hero-ink)] underline underline-offset-2"
          >
            {tr("ตั้งค่า")}
            <Settings2 className="h-3 w-3" aria-hidden />
          </button>
        </div>

        {alertsOff || categoryLocked ? (
          <div className="rounded-2xl bg-surface text-foreground">
            <PlusLock>
              {tr("งบแยกหมวดและการแจ้งเตือนในแชทเมื่อใช้ถึง 80% / เกินงบ")}
              {data.mode === "category" ? tr(" (งบที่เคยตั้งไว้ยังอยู่ แก้ไขได้เมื่ออัปเกรด)") : ""}
            </PlusLock>
          </div>
        ) : (
          <p className="text-[11px] text-[var(--hero-ink-soft)]">
            {tr("จะแจ้งเตือนในแชทเมื่อใช้ถึง 80% และเมื่อเกินงบ")}
          </p>
        )}
      </div>
    </section>
  );
}

/** The figures on the right of a category card. */
function CategoryAmount({
  kind,
  showBudget,
  budget,
  received,
  spent,
}: {
  kind: Kind;
  showBudget: boolean;
  budget: BudgetsResponse["categories"][number] | undefined;
  received: number;
  spent: number;
}) {
  if (kind === "income") {
    return received > 0 ? (
      <span className="shrink-0 text-right">
        <span className="num block text-xs font-bold text-income">+{money(received)}</span>
        <span className="block text-[10px] text-muted">{tr("รอบนี้")}</span>
      </span>
    ) : (
      <span className="shrink-0 text-[10px] text-muted">{tr("ยังไม่มีรายรับ")}</span>
    );
  }
  if (showBudget && budget?.amountSatang) {
    const limit = budget.amountSatang;
    const left = limit - spent;
    const state = budgetState(spent, limit);
    const chip =
      left < 0
        ? { text: tr("เกินงบ {0}", money(-left)), cls: "bg-expense/10 text-expense" }
        : left === 0
          ? { text: tr("เต็มงบแล้ว"), cls: "bg-expense/10 text-expense" }
          : {
              text: tr("เหลือ {0}", money(left)),
              cls: state === "warn" ? "bg-warn-soft text-warn" : "bg-primary-soft text-primary",
            };
    return (
      <span className="shrink-0 space-y-0.5 text-right">
        <span className="num block text-xs font-bold">
          {money(spent)}{" "}
          <span className="text-[10px] font-normal text-muted">/ {money(limit)}</span>
        </span>
        <span
          className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", chip.cls)}
        >
          {chip.text}
        </span>
      </span>
    );
  }
  return (
    <span className="shrink-0 text-right">
      <span className="num block text-xs font-semibold">{money(spent)}</span>
      <span className="block text-[10px] text-muted">
        {showBudget ? tr("ไม่ได้ตั้งงบ") : tr("รอบนี้")}
      </span>
    </span>
  );
}

function MiniBar({ spent, limit, name }: { spent: number; limit: number; name: string }) {
  const pct = Math.min(100, percentUsed(spent, limit));
  const state = budgetState(spent, limit);
  return (
    <span
      role="progressbar"
      aria-label={tr("การใช้งบหมวด {0}", name)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="mt-2 block h-1.5 overflow-hidden rounded-full bg-border"
    >
      <span
        className={cn(
          "block h-full rounded-full",
          state === "over" ? "bg-expense" : state === "warn" ? "bg-accent" : "bg-primary",
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-muted disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** What the page looks like while its numbers load. */
function BudgetsSkeleton() {
  return (
    <div role="status" aria-label={tr("กำลังโหลด")} className="space-y-4">
      <Skeleton className="h-52 w-full rounded-3xl" />
      <Skeleton className="h-11 w-full" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[4.5rem] w-full" />
      ))}
    </div>
  );
}

/** "ปรับงบ": the one budget for the whole cycle. */
function TotalBudgetSheet({
  amountSatang,
  onClose,
  onSave,
}: {
  amountSatang: number | null;
  onClose: () => void;
  onSave: (value: string | null) => void;
}) {
  const [text, setText] = useState(amountSatang ? formatBaht(amountSatang).replace(/,/g, "") : "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseAmount(text);
    if (!parsed.ok) return setError(tr("จำนวนเงินไม่ถูกต้อง (เช่น 5000 หรือ 5000.50)"));
    onSave(parsed.value);
  }

  return (
    <Sheet title={tr("งบรวมต่อรอบ")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <span
            aria-hidden
            className="num absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted"
          >
            {currencySymbol()}
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="decimal"
            placeholder={tr("ไม่ตั้งงบประมาณ")}
            aria-label={tr("งบรวมต่อรอบ")}
            className="num h-12 w-full rounded-2xl border border-border bg-background pl-9 pr-4 text-sm font-bold outline-none focus:border-primary"
          />
        </div>
        <p className="text-[11px] text-muted">{tr("ปล่อยว่างไว้ถ้าไม่ต้องการจำกัดงบ")}</p>
        <QuickAmounts onAdd={(n) => setText((t) => addToAmount(t, n))} />
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface"
        >
          {tr("บันทึก")}
        </button>
      </form>
    </Sheet>
  );
}

const CYCLE_CHOICES = [
  { value: "weekly", label: tr("รายสัปดาห์") },
  { value: "monthly", label: tr("รายเดือน") },
] as const;
const START_DAYS = Array.from({ length: MAX_START_DAY }, (_, i) => i + 1);

/** The budget cycle, set from this page: weekly or monthly, and the day a monthly cycle starts. */
function CycleSheet({
  cycle,
  startDay,
  onClose,
  onSaved,
}: {
  cycle: BudgetsResponse["cycle"];
  startDay: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLiff();
  const [value, setValue] = useState(cycle);
  const [day, setDay] = useState(startDay);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ budget_cycle: value, cycle_start_day: day }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("บันทึกไม่สำเร็จ"));
      setSaving(false);
    }
  }

  return (
    <Sheet title={tr("รอบงบ")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div role="radiogroup" aria-label={tr("ชนิดรอบงบ")} className="space-y-2">
          {CYCLE_CHOICES.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              onClick={() => setValue(o.value)}
              className={cn(
                "flex h-14 w-full items-center justify-between rounded-2xl border px-4 text-left text-base",
                value === o.value
                  ? "border-primary bg-primary-soft font-semibold text-primary"
                  : "border-border text-foreground",
              )}
            >
              {o.label}
              {value === o.value ? <Check className="h-5 w-5" aria-hidden /> : null}
            </button>
          ))}
        </div>
        {value === "monthly" ? (
          <div className="space-y-1.5">
            <label htmlFor="cycle-start-day" className="block text-base font-bold">
              {tr("วันที่เริ่มต้นงบประมาณ")}
            </label>
            <p className="text-xs text-muted">
              {tr(
                "ถ้าเดือนนั้นไม่มีวันที่เลือก จะเริ่มวันสุดท้ายของเดือนแทน เช่น เลือก 31 เดือนเมษายนจะเริ่มวันที่ 30",
              )}
            </p>
            <div className="relative">
              <select
                id="cycle-start-day"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className="num h-12 w-full appearance-none rounded-2xl border border-border bg-background px-4 pr-10 text-sm"
              >
                {START_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? tr("วันแรกของเดือน") : tr("วันที่ {0}", d)}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{tr("รอบสัปดาห์เริ่มทุกวันจันทร์")}</p>
        )}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
        >
          {saving ? tr("กำลังบันทึก…") : tr("บันทึก")}
        </button>
      </form>
    </Sheet>
  );
}

/** One category: name, keywords, its budget (expense, per-category mode), six-month history, hide, delete. */
function CategorySheet({
  category,
  index,
  locked,
  budget,
  cycle,
  historyOn,
  onClose,
  onSaved,
}: {
  category: CategoryItem;
  index: number;
  /** Free cannot change what an own category is; it can still be deleted. */
  locked: boolean;
  /** Null when budgets are not per category; `locked` makes the field read only (Free). */
  budget: { amountSatang: number | null; locked: boolean } | null;
  cycle: "monthly" | "weekly";
  historyOn: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState(category.name);
  const [keywords, setKeywords] = useState(category.keywords.join(", "));
  const [color, setColor] = useState(category.color ?? SWATCHES[0] ?? "#0F766E");
  const [emoji, setEmoji] = useState(category.emoji ?? "");
  const initialBudget = budget?.amountSatang
    ? formatBaht(budget.amountSatang).replace(/,/g, "")
    : "";
  const [budgetText, setBudgetText] = useState(initialBudget);
  const [hidden, setHidden] = useState(category.isHidden);
  const [busy, setBusy] = useState(false);
  const frozen = category.own && locked;
  const [error, setError] = useState<string | null>(null);
  const history = useApi<{
    series: { start: string; totalSatang: number }[];
    averageSatang: number;
  }>(historyOn ? `/api/budgets/history?categoryId=${category.id}` : null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (category.own && !name.trim()) return setError(tr("ใส่ชื่อหมวดด้วยนะ"));
    if (category.own && emoji !== "" && !isSingleEmoji(emoji)) {
      return setError(tr("ใส่ได้เป็นอีโมจิตัวเดียวเท่านั้นนะ"));
    }
    const parsed = parseAmount(budgetText);
    if (budget && !budget.locked && !parsed.ok) return setError(tr("จำนวนเงินไม่ถูกต้อง"));
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { keywords: keywordsFromText(keywords) };
      if (category.own) {
        body.name = name.trim();
        body.color = color;
        if (emoji !== (category.emoji ?? "")) body.emoji = emoji;
      }
      if (hidden !== category.isHidden) body.isHidden = hidden;
      await api(`/api/categories/${category.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (budget && !budget.locked && budgetText.trim() !== initialBudget && parsed.ok) {
        await api("/api/budgets", {
          method: "PUT",
          body: JSON.stringify({ categories: [{ categoryId: category.id, amount: parsed.value }] }),
        });
      }
      onSaved(tr("บันทึกแล้ว"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("บันทึกไม่สำเร็จ"));
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(tr('ลบหมวด "{0}" ใช่ไหม? รายการในหมวดนี้จะย้ายไปหมวด "อื่นๆ"', category.name))
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/categories/${category.id}`, { method: "DELETE" });
      onSaved(tr("ลบหมวดแล้ว"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("ลบไม่สำเร็จ"));
      setBusy(false);
    }
  }

  const points = (history.data?.series ?? []).map((p) => ({
    label: formatThaiMonthShort(new Date(p.start)),
    value: p.totalSatang / 100,
  }));

  return (
    <Sheet title={tr("แก้ไขหมวด")} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">{tr("ชื่อหมวดหมู่")}</p>
          <div className="flex gap-2">
            <Tile
              c={{ ...category, emoji: category.own ? emoji || null : category.emoji }}
              index={index}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!category.own || frozen}
              maxLength={30}
              aria-label={tr("ชื่อหมวด")}
              className={cn(fieldClass, "h-10 text-sm", (!category.own || frozen) && "opacity-60")}
            />
          </div>
          {frozen ? (
            <p className="text-xs text-muted">
              {tr("แก้หมวดของตัวเองได้ในแผน Pro ขึ้นไป")}{" "}
              <Link href="/upgrade" className="font-semibold text-primary underline">
                {tr("ดูแผน")}
              </Link>{" "}
              {tr("(ลบหมวดนี้ได้ตามปกติ)")}
            </p>
          ) : null}
          {!category.own ? (
            <p className="text-xs text-muted">{tr("หมวดมาตรฐานแก้ชื่อไม่ได้ แต่ปรับคำค้นได้นะ")}</p>
          ) : null}
        </div>

        {budget ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="cat-budget" className="text-xs font-semibold">
                {tr("งบประมาณประจำ{0}", cycle === "weekly" ? tr("สัปดาห์") : tr("เดือน"))}
              </label>
            </div>
            <div className="relative">
              <span
                aria-hidden
                className="num absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted"
              >
                {currencySymbol()}
              </span>
              <input
                id="cat-budget"
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
                disabled={budget.locked}
                inputMode="decimal"
                placeholder={tr("ไม่ตั้งงบประมาณ")}
                aria-label={tr("งบหมวด {0}", category.name)}
                className="num h-12 w-full rounded-2xl border border-border bg-background pl-9 pr-4 text-sm font-bold outline-none focus:border-primary disabled:opacity-60"
              />
            </div>
            {budget.locked ? (
              <PlusLock>{tr("งบแยกหมวดและการแจ้งเตือนเมื่อใช้ถึง 80% / เกินงบ")}</PlusLock>
            ) : (
              <>
                <p className="text-[11px] text-muted">
                  {tr("ปล่อยว่างไว้หากไม่ต้องการจำกัดงบสำหรับหมวดหมู่นี้")}
                </p>
                <QuickAmounts onAdd={(n) => setBudgetText((t) => addToAmount(t, n))} />
              </>
            )}
          </div>
        ) : null}

        {historyOn ? (
          <div className="space-y-2 rounded-2xl border border-border bg-background p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{tr("ประวัติใช้จ่ายย้อนหลัง 6 เดือน")}</span>
              {history.data ? (
                <span className="num text-[11px] font-semibold text-primary">
                  {tr("เฉลี่ย")} {money(history.data.averageSatang)}
                  {tr("/ด.")}
                </span>
              ) : null}
            </div>
            <div className="h-24 w-full">
              {history.loading ? (
                <Skeleton className="h-full w-full" />
              ) : history.error ? (
                <p className="text-xs text-muted">{tr("โหลดประวัติไม่สำเร็จ")}</p>
              ) : (
                <MiniBarChart points={points} />
              )}
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor="cat-keywords" className="text-xs font-semibold">
            {tr("คำค้นสำหรับจัดหมวดอัตโนมัติ")}
          </label>
          <textarea
            id="cat-keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder={tr("คำค้น คั่นด้วยคอมมา")}
            aria-label={tr("คำค้น")}
            rows={3}
            disabled={frozen}
            className="w-full rounded-2xl border border-border bg-background p-4 outline-none focus:border-primary disabled:opacity-60"
          />
        </div>
        {category.own && !frozen ? <EmojiPicker value={emoji} onChange={setEmoji} /> : null}
        {category.own && !frozen ? <ColorPicker value={color} onChange={setColor} /> : null}

        {!category.isFallback ? (
          <button
            type="button"
            role="switch"
            aria-checked={hidden}
            onClick={() => setHidden((v) => !v)}
            className="flex h-12 w-full items-center justify-between rounded-2xl border border-border px-4 text-sm"
          >
            <span>{tr("ซ่อนหมวดนี้จากรายการเลือก")}</span>
            <span
              aria-hidden
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors",
                hidden ? "bg-primary" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all",
                  hidden ? "left-[1.375rem]" : "left-0.5",
                )}
              />
            </span>
          </button>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        {frozen && !budget ? null : (
          <button
            type="submit"
            disabled={busy}
            className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
          >
            {tr("บันทึก")}
          </button>
        )}
        {category.own ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="h-12 w-full rounded-2xl border border-expense text-base font-semibold text-expense disabled:opacity-60"
          >
            {tr("ลบหมวดนี้")}
          </button>
        ) : null}
      </form>
    </Sheet>
  );
}
