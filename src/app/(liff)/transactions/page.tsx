"use client";

import {
  CalendarDays,
  Camera,
  CheckSquare,
  ChevronRight,
  Download,
  FileBarChart,
  FileDown,
  FileSpreadsheet,
  FileText,
  FolderInput,
  Image as ImageIcon,
  Lock,
  Plus,
  Receipt,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Sheet } from "@/components/liff/sheet";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Skeleton,
} from "@/components/liff/states";
import { RangeCalendar, type DayRange } from "@/components/liff/range-calendar";
import { TxCard } from "@/components/liff/tx-card";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { WALLET_KIND_EMOJI, type WalletKind } from "@/lib/wallet";
import { addDays, formatRange, rangeToFilter, ymdKey, ymdOf } from "@/lib/date-range";
import type { TxDto } from "@/lib/dto";
import { COLUMN_GROUPS, GROUP_LABEL, type ColumnGroup } from "@/lib/export/columns";
import { formatBaht } from "@/lib/money";
import { satangToString } from "@/lib/money";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { formatThaiDate, fromBangkokInputValue, toBangkokInputValue } from "@/lib/thai-date";
import { MAX_BULK, MAX_NOTE, MAX_TITLE } from "@/lib/tx-edit";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | "expense" | "income";

interface WalletsLite {
  items: { id: string; name: string; kind: WalletKind; isDefault: boolean }[];
}

interface ListResponse {
  items: TxDto[];
  hasMore: boolean;
  /** Totals of everything a search finds (Pro and above, first page only). */
  totals?: { incomeSatang: number; expenseSatang: number; count: number } | null;
}

interface CategoriesResponse {
  items: { id: string; type: "expense" | "income"; name: string; emoji?: string | null }[];
}

interface BulkResponse {
  updated: number;
  skipped: number;
}

const PAGE_SIZE = 30;
const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

const FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "expense", label: "รายจ่าย" },
  { value: "income", label: "รายรับ" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * The page reads `?q=` (the chat search card links here) and `?edit=` (the chat "แก้" button opens
 * the editor of that entry), which needs a Suspense boundary.
 */
export default function TransactionsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={5} />}>
      <TransactionsRoute />
    </Suspense>
  );
}

function TransactionsRoute() {
  const editId = useSearchParams().get("edit");
  return editId ? <EditFromChat id={editId} /> : <TransactionsView />;
}

/** How long "บันทึกรายการสำเร็จ" shows before the window closes back to the chat. */
const CLOSE_AFTER_MS = 900;
const SEND_NOT_FROM_CHAT = "ส่งการ์ดเข้าแชทได้เมื่อเปิดหน้านี้จากปุ่มในแชทของ LINE";
const SEND_REFUSED = "LINE ไม่ให้ส่งข้อความเข้าแชท";

/**
 * Opened from the chat's "แก้" button: the editor of one entry. After a save it shows "บันทึกรายการสำเร็จ",
 * sends "แก้ไขเสร็จแล้ว" into the chat as the person's own message (the bot answers it with the edited
 * card, a free reply, so nothing counts against the push quota) and closes, back to the chat. When LINE
 * does not let the page send it, the page says why and offers a button to try again.
 */
function EditFromChat({ id }: { id: string }) {
  const tx = useApi<TxDto>(`/api/transactions/${encodeURIComponent(id)}`);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** Null when it was sent, else why not. */
  async function sendToChat(): Promise<string | null> {
    try {
      const liff = (await import("@line/liff")).default;
      if (!liff.isInClient() || !liff.isApiAvailable("sendMessages")) return SEND_NOT_FROM_CHAT;
      // a person who signed in before the permission existed has to agree once more
      try {
        if ((await liff.permission.query("chat_message.write")).state === "prompt") {
          await liff.permission.requestAll();
        }
      } catch {
        /* sending below tells whether it worked */
      }
      await liff.sendMessages([{ type: "text", text: "แก้ไขเสร็จแล้ว" }]);
      setSent(true);
      return null;
    } catch (e) {
      const err = e instanceof Error ? (e as Error & { code?: string }) : null;
      // LINE's own words, and where LINE thinks the page was opened from ("utou" is a 1:1 chat), to
      // tell why it refused; "login" when this visit signed in again (a token not tied to the chat)
      let from = "";
      let relogin = false;
      try {
        from = (await import("@line/liff")).default.getContext()?.type ?? "";
        relogin = window.sessionStorage.getItem("jodtang-liff-login-at") !== null;
      } catch {
        /* leave it out */
      }
      const why = [err?.code, err?.message, from, relogin ? "login" : ""]
        .filter(Boolean)
        .join(" · ");
      return `${SEND_REFUSED}${why ? ` (${why})` : ""}`;
    }
  }

  async function closeToChat() {
    try {
      (await import("@line/liff")).default.closeWindow();
    } catch {
      /* the page stays open, and says it was saved */
    }
  }

  async function retry() {
    const why = await sendToChat();
    setFailure(why);
    if (!why) await closeToChat();
  }

  async function saved(photoWarning?: string) {
    setWarning(photoWarning ?? null);
    setToast(true);
    const why = await sendToChat();
    setFailure(why);
    // a photo warning stays on screen instead of being closed away
    if (!why && !photoWarning) {
      await new Promise((r) => setTimeout(r, CLOSE_AFTER_MS));
      await closeToChat();
      return;
    }
    setToast(false);
    setDone(true);
  }

  if (tx.loading) return <LoadingBlock rows={4} />;
  if (tx.error || !tx.data) {
    return (
      <ErrorState
        message={tx.error ?? "ไม่พบรายการนี้แล้ว (อาจถูกลบไปก่อนหน้า)"}
        onRetry={tx.reload}
      />
    );
  }
  if (done) {
    return (
      <div className="space-y-4 px-4 py-10 text-center">
        <p role="status" className="text-lg font-bold text-primary">
          ✅ แก้ไขรายการสำเร็จ
        </p>
        {warning ? (
          <p role="alert" className="text-sm text-expense">
            {warning}
          </p>
        ) : null}
        <p className="text-sm text-muted">
          {sent
            ? "บอทส่งการ์ดสรุปรายการเข้าแชทให้แล้ว กลับไปที่แชทได้เลย"
            : `${failure ?? SEND_NOT_FROM_CHAT} กด "ส่งการ์ดเข้าแชท" อีกครั้ง หรือพิมพ์ "แก้ไขเสร็จแล้ว" ในแชทก็ได้`}
        </p>
        {sent ? null : (
          <button
            type="button"
            onClick={() => void retry()}
            className="h-11 rounded-2xl border border-border px-5 text-sm font-semibold"
          >
            ส่งการ์ดเข้าแชท
          </button>
        )}
        <Link
          href="/transactions"
          className="inline-flex h-11 items-center rounded-2xl bg-primary px-5 text-sm font-semibold text-surface"
        >
          ดูรายการทั้งหมด
        </Link>
      </div>
    );
  }
  return (
    <div>
      {toast ? (
        <p
          role="status"
          className="fixed inset-x-4 top-4 z-50 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary-soft px-4 py-3 text-sm font-semibold text-primary shadow-lg"
        >
          <span aria-hidden>✓</span> บันทึกรายการสำเร็จ
        </p>
      ) : null}
      <PageHeader title="แก้ไขรายการ" />
      <div className="px-4 pb-8">
        <EditForm
          tx={tx.data}
          onCancel={() => {
            window.location.assign("/transactions");
          }}
          onSaved={saved}
        />
      </div>
    </div>
  );
}

function TransactionsView() {
  const { api } = useLiff();
  const [type, setType] = useState<TypeFilter>("all");
  const initialSearch = useSearchParams().get("q") ?? "";
  const [search, setSearch] = useState(initialSearch);
  const q = useDebounced(search.trim(), 300);
  const [range, setRange] = useState<DayRange | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [extra, setExtra] = useState<TxDto[]>([]);
  const [extraMore, setExtraMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [slipFor, setSlipFor] = useState<TxDto | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<TxDto | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [walletId, setWalletId] = useState("");
  const wallets = useApi<WalletsLite>("/api/wallets");
  const categories = useApi<CategoriesResponse>("/api/categories");
  const [now] = useState(() => new Date());

  const filter = useMemo(() => {
    const f: {
      type?: "expense" | "income";
      q?: string;
      from?: string;
      to?: string;
      categoryId?: string;
      accountId?: string;
    } = {};
    if (type !== "all") f.type = type;
    if (q) f.q = q;
    if (range) Object.assign(f, rangeToFilter(range.start, range.end));
    if (categoryId) f.categoryId = categoryId;
    if (walletId) f.accountId = walletId;
    return f;
  }, [type, q, range, categoryId, walletId]);

  const path = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(filter)) p.set(k, v);
    return `/api/transactions?${p.toString()}`;
  }, [filter]);

  const list = useApi<ListResponse>(path);

  // Filters changed (or reloaded): drop the pages loaded on top of the first one.
  useEffect(() => {
    setExtra([]);
    setExtraMore(null);
  }, [path, list.data]);

  const items = useMemo(() => [...(list.data?.items ?? []), ...extra], [list.data, extra]);
  const hasMore = extraMore ?? list.data?.hasMore ?? false;
  const filtered =
    type !== "all" || q !== "" || range !== null || categoryId !== "" || walletId !== "";

  // the categories of the chosen type (both when "all")
  const chips = (categories.data?.items ?? []).filter((c) => type === "all" || c.type === type);
  const chosen = chips.find((c) => c.id === categoryId);

  // entries grouped by day (the list is newest first, so groups come out in order)
  const groups = useMemo(() => {
    const out: { key: string; date: Date; items: TxDto[]; netSatang: number }[] = [];
    for (const tx of items) {
      const date = new Date(tx.occurredAt);
      const key = ymdKey(ymdOf(date));
      let g = out.at(-1);
      if (g?.key !== key) {
        g = { key, date, items: [], netSatang: 0 };
        out.push(g);
      }
      g.items.push(tx);
      g.netSatang += tx.type === "income" ? tx.amountSatang : -tx.amountSatang;
    }
    return out;
  }, [items]);
  const todayKey = ymdKey(ymdOf(now));
  const yesterdayKey = ymdKey(addDays(ymdOf(now), -1));

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api<ListResponse>(`${path}&offset=${items.length}`);
      setExtra((prev) => [...prev, ...res.items]);
      setExtraMore(res.hasMore);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "โหลดเพิ่มไม่สำเร็จ");
    } finally {
      setLoadingMore(false);
    }
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setMoveOpen(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK) next.add(id);
      return next;
    });
  }

  function bulkMessage(res: BulkResponse, done: string): string {
    return res.skipped > 0
      ? `${done} ${res.updated} รายการ (ข้าม ${res.skipped})`
      : `${done} ${res.updated} รายการ`;
  }

  async function bulkDelete() {
    if (!window.confirm(`ลบ ${selected.size} รายการที่เลือกใช่ไหม?`)) return;
    setBulkBusy(true);
    try {
      const res = await api<BulkResponse>("/api/transactions/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "delete", ids: [...selected] }),
      });
      setNotice(bulkMessage(res, "ลบแล้ว"));
      stopSelecting();
      list.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkMove(categoryId: string) {
    setBulkBusy(true);
    try {
      const res = await api<BulkResponse>("/api/transactions/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "move", ids: [...selected], categoryId }),
      });
      setNotice(bulkMessage(res, "ย้ายหมวดแล้ว"));
      stopSelecting();
      list.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ย้ายหมวดไม่สำเร็จ");
      setMoveOpen(false);
    } finally {
      setBulkBusy(false);
    }
  }

  async function remove(tx: TxDto) {
    if (!window.confirm(`ลบ "${tx.title}" ใช่ไหม?`)) return;
    try {
      await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
      setEditFor(null);
      setNotice("ลบแล้ว");
      list.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <main>
      <PageHeader title="รายการบันทึก" />

      <div className="space-y-3.5 px-4 pb-28">
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-left shadow-card"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <CalendarDays className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block text-[10px] leading-tight text-muted">ช่วงเวลาที่เลือก</span>
              <span className="num block text-xs font-bold">
                {range ? formatRange(range.start, range.end) : "ทุกช่วงเวลา"}
              </span>
            </span>
          </span>
          <span className="flex items-center text-primary">
            <span className="text-[11px] font-semibold">เปลี่ยน</span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        </button>

        <section
          aria-label="ตัวกรอง"
          className="space-y-3 rounded-2xl border border-border bg-surface p-3.5 shadow-card"
        >
          <div className="flex items-center gap-3">
            <div
              role="tablist"
              aria-label="ประเภท"
              className="flex flex-1 rounded-xl border border-border bg-background p-0.5"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={type === f.value}
                  type="button"
                  onClick={() => {
                    setType(f.value);
                    setCategoryId(""); // a category of the other type would show nothing
                  }}
                  className={cn(
                    "h-9 flex-1 rounded-lg text-xs",
                    type === f.value
                      ? cn(
                          "bg-surface font-semibold shadow-card",
                          f.value === "expense"
                            ? "text-expense"
                            : f.value === "income"
                              ? "text-income"
                              : "text-primary",
                        )
                      : "text-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              aria-label="ส่งออกไฟล์"
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary-soft px-3 text-xs font-semibold text-primary"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              ส่งออก
            </button>
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อรายการ หรือ #แท็ก"
            aria-label="ค้นหาชื่อรายการหรือแท็ก"
            className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary"
          />

          {(wallets.data?.items.length ?? 0) > 1 ? (
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              aria-label="กระเป๋า"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            >
              <option value="">ทุกกระเป๋า</option>
              {wallets.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {WALLET_KIND_EMOJI[w.kind]} {w.name}
                </option>
              ))}
            </select>
          ) : null}

          <div className="border-t border-border pt-2.5">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
              <span>หมวดหมู่</span>
              <span className="font-medium text-primary">{chosen?.name ?? "ทุกหมวดหมู่"}</span>
            </div>
            <div
              role="group"
              aria-label="เลือกหมวดหมู่"
              className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                type="button"
                aria-pressed={categoryId === ""}
                onClick={() => setCategoryId("")}
                className={cn(
                  "h-9 shrink-0 whitespace-nowrap rounded-full px-3",
                  categoryId === ""
                    ? "bg-primary font-semibold text-surface"
                    : "bg-background text-muted",
                )}
              >
                ทั้งหมด
              </button>
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? "" : c.id)}
                  className={cn(
                    "h-9 shrink-0 whitespace-nowrap rounded-full px-3",
                    categoryId === c.id
                      ? "bg-primary font-semibold text-surface"
                      : "bg-background text-muted",
                  )}
                >
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        {selecting ? (
          <div
            role="region"
            aria-label="จัดการรายการที่เลือก"
            className="flex items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-[var(--hero-from)] to-[var(--hero-to)] p-3 text-[var(--hero-ink)] shadow-card"
          >
            <p className="num text-xs font-semibold" aria-live="polite">
              เลือกแล้ว {selected.size} รายการ
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={selected.size === 0 || bulkBusy}
                onClick={() => setMoveOpen(true)}
                className="flex h-9 items-center gap-1 rounded-lg bg-white/70 px-2.5 text-[11px] font-semibold disabled:opacity-50"
              >
                <FolderInput className="h-3.5 w-3.5" aria-hidden /> ย้ายหมวด
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || bulkBusy}
                onClick={bulkDelete}
                className="flex h-9 items-center gap-1 rounded-lg bg-expense px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> ลบ
              </button>
              <button
                type="button"
                onClick={stopSelecting}
                className="h-9 rounded-lg bg-white/70 px-2.5 text-[11px] font-medium"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <section className="flex items-center gap-2 text-xs">
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => setSelecting(true)}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface font-medium disabled:opacity-50"
            >
              <CheckSquare className="h-3.5 w-3.5 text-primary" aria-hidden />
              เลือกหลายรายการ
            </button>
            <Link
              href="/settings#recurring"
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface font-medium"
            >
              <Repeat className="h-3.5 w-3.5 text-accent" aria-hidden />
              ตั้งรายการจดประจำ
            </Link>
          </section>
        )}

        {q && list.data?.totals ? (
          <div
            role="status"
            aria-label="ยอดรวมของผลค้นหา"
            className="grid grid-cols-3 gap-2 rounded-2xl bg-primary-soft px-3 py-2 text-center text-xs"
          >
            <div>
              <p className="text-muted">รายรับ</p>
              <p className="num font-bold text-income">
                +฿{formatBaht(list.data.totals.incomeSatang)}
              </p>
            </div>
            <div>
              <p className="text-muted">รายจ่าย</p>
              <p className="num font-bold text-expense">
                -฿{formatBaht(list.data.totals.expenseSatang)}
              </p>
            </div>
            <div>
              <p className="text-muted">พบ</p>
              <p className="num font-bold">{list.data.totals.count} รายการ</p>
            </div>
          </div>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="whitespace-pre-line rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
          >
            {notice}
          </p>
        ) : null}

        {list.loading && items.length === 0 ? (
          <TransactionsSkeleton />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <EmptyState
              title={filtered ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการ"}
              hint={
                filtered
                  ? "ลองเปลี่ยนตัวกรองหรือคำค้นหาดูนะ"
                  : 'พิมพ์ "กาแฟ 30" ในแชท หรือกดปุ่ม + เพื่อเพิ่มได้เลย'
              }
            />
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {groups.map((g) => (
                <section key={g.key} aria-label={formatThaiDate(g.date)} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xs font-bold">{formatThaiDate(g.date)}</h2>
                      {g.key === todayKey || g.key === yesterdayKey ? (
                        <span className="text-[10px] text-muted">
                          {g.key === todayKey ? "วันนี้" : "เมื่อวาน"}
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "num rounded-full border px-2 py-0.5 text-xs font-bold",
                        g.netSatang < 0
                          ? "border-expense/30 bg-expense/10 text-expense"
                          : "border-income/30 bg-income/10 text-income",
                      )}
                    >
                      รวม: {g.netSatang < 0 ? "-" : "+"}฿{formatBaht(Math.abs(g.netSatang))}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {g.items.map((tx) => (
                      <TxCard
                        key={tx.id}
                        tx={tx}
                        // somebody else's entry in a shared wallet can be read but not changed
                        onOpen={
                          tx.mine === false
                            ? undefined
                            : selecting
                              ? () => toggle(tx.id)
                              : () => setEditFor(tx)
                        }
                        leading={
                          selecting && tx.mine !== false ? (
                            <input
                              type="checkbox"
                              checked={selected.has(tx.id)}
                              onChange={() => toggle(tx.id)}
                              aria-label={`เลือก ${tx.title}`}
                              className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                            />
                          ) : null
                        }
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {hasMore ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="h-11 w-full rounded-2xl border border-border bg-surface text-sm font-medium disabled:opacity-60"
              >
                {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {selecting ? null : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-label="เพิ่มรายการใหม่"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-surface shadow-card"
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      )}

      {calendarOpen ? (
        <RangeCalendar
          value={range}
          now={now}
          onClose={() => setCalendarOpen(false)}
          onApply={(r) => {
            setRange(r);
            setCalendarOpen(false);
          }}
        />
      ) : null}

      {moveOpen ? (
        <MoveSheet
          count={selected.size}
          busy={bulkBusy}
          onPick={bulkMove}
          onClose={() => setMoveOpen(false)}
        />
      ) : null}

      {editFor ? (
        <EditSheet
          tx={editFor}
          onClose={() => setEditFor(null)}
          onSaved={(warning) => {
            setEditFor(null);
            setNotice(warning ? `บันทึกแล้ว ${warning}` : "บันทึกแล้ว");
            list.reload();
          }}
          onDelete={() => remove(editFor)}
          onViewSlip={
            editFor.hasSlip
              ? () => {
                  setSlipFor(editFor);
                  setEditFor(null);
                }
              : undefined
          }
        />
      ) : null}

      {slipFor ? <SlipSheet tx={slipFor} onClose={() => setSlipFor(null)} /> : null}

      {exportOpen ? (
        <ExportSheet
          filters={filter}
          rangeText={range ? formatRange(range.start, range.end) : "ทุกช่วงเวลา"}
          typeText={type === "all" ? "ทั้งหมด" : type === "expense" ? "รายจ่าย" : "รายรับ"}
          categoryText={chosen?.name ?? "ทุกหมวดหมู่"}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {formOpen ? (
        <AddSheet
          onClose={() => setFormOpen(false)}
          onSaved={(alerts) => {
            setFormOpen(false);
            setNotice(["จดแล้ว", ...alerts].join("\n"));
            list.reload();
          }}
        />
      ) : null}
    </main>
  );
}

/** The cards while the entries load. */
function TransactionsSkeleton() {
  return (
    <div role="status" aria-label="กำลังโหลด" className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <Skeleton className="h-4 w-24 rounded-lg" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[4.25rem] w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Export what the list currently shows: the file's format, which columns to keep, and whether to
 * pack the slip pictures and photos in a zip. The file link is opened in the phone's own browser
 * because the LINE in-app browser cannot download files.
 */
function ExportSheet({
  filters,
  rangeText,
  typeText,
  categoryText,
  onClose,
}: {
  filters: Record<string, string>;
  rangeText: string;
  typeText: string;
  categoryText: string;
  onClose: () => void;
}) {
  const { api, openExternal } = useLiff();
  const me = useApi<{ features: Record<string, boolean> }>("/api/me");
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  const [groups, setGroups] = useState<Set<ColumnGroup>>(new Set(COLUMN_GROUPS));
  const [attachments, setAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = me.data?.features.export === true;
  const zipAllowed = me.data?.features.advancedExport === true;
  const all = groups.size === COLUMN_GROUPS.length;

  function toggleGroup(g: ColumnGroup) {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) {
        if (next.size > 1) next.delete(g); // a file with no column says nothing
      } else {
        next.add(g);
      }
      return next;
    });
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string }>("/api/export/link", {
        method: "POST",
        body: JSON.stringify({
          format,
          ...filters,
          ...(all ? {} : { groups: [...groups] }),
          ...(attachments ? { attachments: true } : {}),
        }),
      });
      await openExternal(res.url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ส่งออกไม่สำเร็จ");
      setBusy(false);
    }
  }

  const FORMATS = [
    { value: "xlsx", label: "Excel (.xlsx)", Icon: FileSpreadsheet },
    { value: "csv", label: "CSV", Icon: FileText },
    { value: "pdf", label: "PDF สรุป", Icon: FileBarChart },
  ] as const;

  return (
    <Sheet title="ส่งออกข้อมูลรายการ" onClose={onClose}>
      {me.loading ? (
        <LoadingBlock rows={2} />
      ) : me.error ? (
        <ErrorState message={me.error} onRetry={me.reload} />
      ) : !allowed ? (
        <div className="space-y-3 text-center">
          <p className="text-base font-semibold">ส่งออก Excel / CSV / PDF สำหรับแผน Pro</p>
          <p className="text-sm text-muted">
            ดาวน์โหลดรายการไปทำบัญชีต่อในคอมพิวเตอร์หรือ Google Sheets ลองใช้ฟรี 7
            วันได้ที่หน้าอัปเกรด
          </p>
          <Link
            href="/upgrade"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-surface"
          >
            ดูแผน Pro
          </Link>
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <p className="font-semibold">รูปแบบไฟล์</p>
            <div role="radiogroup" aria-label="รูปแบบไฟล์" className="grid grid-cols-3 gap-2">
              {FORMATS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={format === value}
                  onClick={() => setFormat(value)}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center",
                    format === value
                      ? "border-primary bg-primary-soft font-semibold text-primary"
                      : "border-border text-muted",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="font-semibold">ตัวกรองที่ใช้ส่งออก</p>
            <dl className="space-y-1 rounded-xl border border-border bg-background p-3">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">ช่วงเวลา</dt>
                <dd className="num font-medium">{rangeText}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">ประเภท</dt>
                <dd className="font-medium">{typeText}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">หมวดหมู่</dt>
                <dd className="font-medium">{categoryText}</dd>
              </div>
            </dl>
          </div>

          <fieldset className="space-y-2">
            <legend className="flex w-full items-center justify-between">
              <span className="font-semibold">คอลัมน์ข้อมูลที่ต้องการส่งออก</span>
              <button
                type="button"
                onClick={() => setGroups(new Set(all ? [COLUMN_GROUPS[0]] : COLUMN_GROUPS))}
                className="text-[10px] font-medium text-primary"
              >
                {all ? "เหลือคอลัมน์เดียว" : `เลือกทั้งหมด ${COLUMN_GROUPS.length} รายการ`}
              </button>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {COLUMN_GROUPS.map((g) => (
                <label
                  key={g}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-2.5"
                >
                  <input
                    type="checkbox"
                    checked={groups.has(g)}
                    onChange={() => toggleGroup(g)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span>{GROUP_LABEL[g]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-warn/30 bg-warn-soft p-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold">
                รวมไฟล์รูปสลิป / ใบเสร็จ
                <span className="rounded-full border border-warn/30 px-1.5 text-[9px] font-bold text-warn">
                  ★ PRO
                </span>
              </p>
              <p className="text-[10px] text-muted">
                บีบอัดเป็นไฟล์ ZIP พร้อมรูปภาพหลักฐาน (สูงสุด 150 รูป)
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={attachments}
              aria-label="รวมไฟล์รูปสลิปและใบเสร็จ"
              disabled={!zipAllowed}
              onClick={() => setAttachments((v) => !v)}
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
                attachments ? "bg-primary" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all",
                  attachments ? "left-[1.375rem]" : "left-0.5",
                )}
              />
            </button>
          </div>

          <p className="text-[11px] text-muted">
            ส่งออกสูงสุด 5,000 แถว ไฟล์จะเปิดในเบราว์เซอร์ของเครื่องเพื่อดาวน์โหลด ลิงก์ใช้ได้ 2
            นาที
            {format === "xlsx" ? " · ไฟล์ Excel มีชีตสรุปตามหมวดและสรุปรายเดือนเพิ่มให้ด้วย" : ""}
            {format === "pdf"
              ? " · PDF พิมพ์ตารางได้สูงสุด 2,000 รายการ (ยอดรวมนับครบทุกรายการ)"
              : ""}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-expense">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={start}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-surface disabled:opacity-60"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            {busy ? "กำลังเตรียมไฟล์..." : "สร้างไฟล์และส่งออก"}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** Shows the attached slip. The signed URL lives 60 s, so it is fetched on open, not stored. */
function SlipSheet({ tx, onClose }: { tx: TxDto; onClose: () => void }) {
  const slip = useApi<{ url: string }>(`/api/transactions/${tx.id}/slip`);
  return (
    <Sheet title={`สลิป: ${tx.title}`} onClose={onClose}>
      {slip.loading ? (
        <LoadingBlock rows={2} />
      ) : slip.error || !slip.data ? (
        <ErrorState message={slip.error ?? "เปิดสลิปไม่สำเร็จ"} onRetry={slip.reload} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slip.data.url}
          alt={`สลิปของรายการ ${tx.title}`}
          className="mx-auto max-h-[70vh] w-full rounded-2xl border border-border object-contain"
        />
      )}
    </Sheet>
  );
}

function AddSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (alerts: string[]) => void;
}) {
  const { api } = useLiff();
  const categories = useApi<CategoriesResponse>("/api/categories");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (categories.data?.items ?? []).filter((c) => c.type === type);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!title.trim()) return setError("ใส่ชื่อรายการด้วยนะ");
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("จำนวนเงินไม่ถูกต้อง (เช่น 50 หรือ 50.50)");
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ alerts?: string[] }>("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          type,
          title: title.trim(),
          amount: normalized,
          categoryId: categoryId || null,
        }),
      });
      onSaved(res.alerts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-foreground/40" role="dialog" aria-modal>
      <form
        onSubmit={submit}
        className="mx-auto w-full max-w-md space-y-3 rounded-t-3xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">เพิ่มรายการ</h2>
          <button type="button" onClick={onClose} aria-label="ปิด" className="h-11 w-11">
            <X className="mx-auto h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ประเภท">
          {(["expense", "income"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => {
                setType(t);
                setCategoryId("");
              }}
              className={cn(
                "h-11 rounded-2xl border text-sm font-semibold",
                type === t
                  ? t === "expense"
                    ? "border-expense bg-expense/10 text-expense"
                    : "border-income bg-income/10 text-income"
                  : "border-border text-muted",
              )}
            >
              {t === "expense" ? "รายจ่าย" : "รายรับ"}
            </button>
          ))}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="ชื่อรายการ เช่น กาแฟ"
          aria-label="ชื่อรายการ"
          className="h-12 w-full rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="จำนวนเงิน (บาท)"
          aria-label="จำนวนเงิน"
          className="num h-12 w-full rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="หมวดหมู่"
          className="h-12 w-full rounded-2xl border border-border bg-background px-3 outline-none focus:border-primary"
        >
          <option value="">เลือกให้อัตโนมัติ</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

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
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </form>
    </div>
  );
}

/** Pick the category to move the selected entries into (entries of the other type are skipped). */
function MoveSheet({
  count,
  busy,
  onPick,
  onClose,
}: {
  count: number;
  busy: boolean;
  onPick: (categoryId: string) => void;
  onClose: () => void;
}) {
  const categories = useApi<CategoriesResponse>("/api/categories");
  const [categoryId, setCategoryId] = useState("");
  const items = categories.data?.items ?? [];
  const expense = items.filter((c) => c.type === "expense");
  const income = items.filter((c) => c.type === "income");

  return (
    <Sheet title={`ย้ายหมวด ${count} รายการ`} onClose={onClose}>
      {categories.loading ? (
        <LoadingBlock rows={2} />
      ) : categories.error ? (
        <ErrorState message={categories.error} onRetry={categories.reload} />
      ) : (
        <div className="space-y-3">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="หมวดปลายทาง"
            className="h-12 w-full rounded-2xl border border-border bg-background px-3 outline-none focus:border-primary"
          >
            <option value="">เลือกหมวดปลายทาง</option>
            <optgroup label="รายจ่าย">
              {expense.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="รายรับ">
              {income.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="text-xs text-muted">
            ย้ายได้เฉพาะรายการที่เป็นประเภทเดียวกับหมวดที่เลือก รายการประเภทอื่นจะถูกข้าม
          </p>
          <button
            type="button"
            disabled={!categoryId || busy}
            onClick={() => onPick(categoryId)}
            className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
          >
            {busy ? "กำลังย้าย..." : "ย้ายหมวด"}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** The photo is shrunk in the phone first: the longest side 1600px, JPEG, well under the upload limit. */
async function shrinkPhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("อ่านรูปไม่สำเร็จ");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("อ่านรูปไม่สำเร็จ");
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

/** A caption above a form control. */
function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-1 text-xs font-medium text-muted">{label}</p>
      {children}
    </div>
  );
}

/** Edit one confirmed entry in a bottom sheet (the entries list), with delete and the slip. */
function EditSheet({
  tx,
  onClose,
  onSaved,
  onDelete,
  onViewSlip,
}: {
  tx: TxDto;
  onClose: () => void;
  onSaved: (warning?: string) => void;
  onDelete: () => void;
  onViewSlip?: () => void;
}) {
  return (
    <Sheet title="แก้ไขรายการ" onClose={onClose}>
      <EditForm
        tx={tx}
        onCancel={onClose}
        onSaved={onSaved}
        extra={
          <>
            {onViewSlip ? (
              <button
                type="button"
                onClick={onViewSlip}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm font-semibold text-primary"
              >
                <Receipt className="h-4 w-4" aria-hidden /> ดูสลิป
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDelete}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-expense text-sm font-semibold text-expense"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> ลบรายการนี้
            </button>
          </>
        }
      />
    </Sheet>
  );
}

/** Edit one confirmed entry. Only fields that changed are sent; the photo goes after the entry. */
function EditForm({
  tx,
  onCancel,
  onSaved,
  extra,
}: {
  tx: TxDto;
  onCancel: () => void;
  onSaved: (warning?: string) => void;
  /** More actions under the save button (the list adds delete and "see slip"). */
  extra?: ReactNode;
}) {
  const { api } = useLiff();
  const categories = useApi<CategoriesResponse>("/api/categories");
  const wallets = useApi<WalletsLite>("/api/wallets");
  const me = useApi<{ features: Record<string, boolean> }>("/api/me");
  const canPhoto = me.data?.features.entryPhoto === true;
  const walletItems = wallets.data?.items ?? [];
  const mainWalletId = walletItems.find((w) => w.isDefault)?.id ?? "";
  const initial = useMemo(
    () => ({
      type: tx.type,
      title: tx.title,
      amount: satangToString(tx.amountSatang),
      categoryId: tx.categoryId ?? "",
      when: toBangkokInputValue(new Date(tx.occurredAt)),
      note: tx.note ?? "",
    }),
    [tx],
  );
  const [type, setType] = useState(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [amount, setAmount] = useState(initial.amount);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [when, setWhen] = useState(initial.when);
  const [note, setNote] = useState(initial.note);
  const [pickedWallet, setPickedWallet] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const savedPhoto = useApi<{ url: string }>(
    tx.hasPhoto ? `/api/transactions/${tx.id}/photo` : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photoFile) return setPhotoPreview(null);
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  // An entry without a wallet belongs to the main one.
  const currentWallet = tx.accountId ?? mainWalletId;
  const walletValue = pickedWallet ?? currentWallet;
  const typeChanged = type !== initial.type;
  const options = (categories.data?.items ?? []).filter((c) => c.type === type);
  const shownPhoto = removePhoto ? null : (photoPreview ?? savedPhoto.data?.url ?? null);
  const hasPhoto = !removePhoto && (photoFile !== null || tx.hasPhoto);

  // the summary card follows what is typed
  const previewAt = fromBangkokInputValue(when);
  const previewAmount = Number(normalizeThaiDigits(amount).replace(/,/g, "").trim());
  const categoryName = options.find((c) => c.id === categoryId)?.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!title.trim()) return setError("ใส่ชื่อรายการด้วยนะ");
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("จำนวนเงินไม่ถูกต้อง (เช่น 50 หรือ 50.50)");
    }
    const at = fromBangkokInputValue(when);
    if (!at) return setError("วันเวลาไม่ถูกต้อง");

    const body: Record<string, unknown> = {};
    if (title.trim() !== initial.title) body.title = title.trim();
    if (Number(normalized) !== Number(initial.amount)) body.amount = normalized;
    if (typeChanged) body.type = type;
    // After a type change an empty choice means "pick for me"; otherwise it means no category.
    if (categoryId !== initial.categoryId && !(typeChanged && categoryId === "")) {
      body.categoryId = categoryId || null;
    }
    if (when !== initial.when) body.occurredAt = at.toISOString();
    if (note.trim() !== initial.note.trim()) body.note = note.trim() || null;
    if (pickedWallet && pickedWallet !== currentWallet) body.accountId = pickedWallet;
    const photoChange = photoFile !== null || (removePhoto && tx.hasPhoto);
    if (Object.keys(body).length === 0 && !photoChange) return onCancel();

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(body).length > 0) {
        await api(`/api/transactions/${tx.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
      return;
    }
    // the entry is saved; a photo that fails must not undo that, so it only adds a warning
    let warning: string | undefined;
    try {
      if (photoFile) {
        const form = new FormData();
        form.append("file", await shrinkPhoto(photoFile));
        await api(`/api/transactions/${tx.id}/photo`, { method: "POST", body: form });
      } else if (removePhoto && tx.hasPhoto) {
        await api(`/api/transactions/${tx.id}/photo`, { method: "DELETE" });
      }
    } catch (err) {
      warning = `แต่รูปแนบยังไม่ขึ้น: ${err instanceof Error ? err.message : "ลองใหม่อีกครั้งนะ"}`;
    }
    onSaved(warning);
  }

  const field =
    "h-12 w-full min-w-0 max-w-full appearance-none rounded-2xl border border-border bg-background px-4 text-left outline-none focus:border-primary";
  const income = type === "income";

  return (
    <form onSubmit={submit} className="space-y-3">
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl px-3 py-3",
          income ? "bg-income/10" : "bg-expense/10",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", income ? "text-income" : "text-expense")}>
            {title.trim() || "ไม่มีชื่อ"}
          </p>
          <p className="truncate text-xs text-muted">
            {[previewAt ? formatThaiDate(previewAt, true) : null, categoryName]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <p className={cn("num shrink-0 font-bold", income ? "text-income" : "text-expense")}>
          {income ? "+" : "-"}฿
          {Number.isFinite(previewAmount) ? previewAmount.toLocaleString("th-TH") : "0"}
        </p>
      </div>

      <Field label="ประเภท">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ประเภท">
          {(["expense", "income"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => {
                setType(t);
                setCategoryId(t === initial.type ? initial.categoryId : "");
              }}
              className={cn(
                "h-11 rounded-2xl border text-sm font-semibold",
                type === t
                  ? t === "expense"
                    ? "border-expense bg-expense/10 text-expense"
                    : "border-income bg-income/10 text-income"
                  : "border-border text-muted",
              )}
            >
              {t === "expense" ? "รายจ่าย" : "รายรับ"}
            </button>
          ))}
        </div>
      </Field>
      <Field label="ชื่อรายการ">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE}
          aria-label="ชื่อรายการ"
          className={field}
        />
      </Field>
      <Field label="จำนวนเงิน (บาท)">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          aria-label="จำนวนเงิน"
          className={cn(field, "num")}
        />
      </Field>
      <Field label="หมวดหมู่">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="หมวดหมู่"
          className={field}
        >
          <option value="">{typeChanged ? "เลือกให้อัตโนมัติ" : "ไม่ระบุหมวด"}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="วันที่และเวลา">
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="วันและเวลา"
          className={field}
        />
      </Field>
      {walletItems.length > 1 ? (
        <Field label="กระเป๋า">
          <select
            value={walletValue}
            onChange={(e) => setPickedWallet(e.target.value)}
            aria-label="กระเป๋า"
            className={field}
          >
            {walletItems.map((w) => (
              <option key={w.id} value={w.id}>
                {WALLET_KIND_EMOJI[w.kind]} {w.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="โน้ต (ไม่บังคับ)">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_NOTE}
          placeholder="เช่น ซื้อที่ร้านหน้าปากซอย"
          aria-label="โน้ต"
          className={field}
        />
      </Field>

      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            รูปแนบ
            <span className="rounded-lg bg-primary-soft px-2 py-0.5 text-[11px] text-primary">
              Pro
            </span>
          </span>
        }
      >
        {canPhoto ? (
          <div className="flex items-center gap-3">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background">
              {shownPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownPhoto} alt="รูปแนบ" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted" aria-hidden />
              )}
            </div>
            <div className="flex flex-col items-start gap-1.5">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-2xl border border-border px-4 text-sm font-semibold">
                <Camera className="h-4 w-4" aria-hidden />
                {hasPhoto ? "เปลี่ยนรูป" : "ถ่ายหรือเลือกรูป"}
                <input
                  type="file"
                  accept="image/*"
                  aria-label="เลือกรูปแนบ"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setPhotoFile(f);
                      setRemovePhoto(false);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              {hasPhoto ? (
                <button
                  type="button"
                  onClick={() => {
                    setPhotoFile(null);
                    setRemovePhoto(true);
                  }}
                  className="px-1 text-xs font-semibold text-expense"
                >
                  เอารูปออก
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <Link
            href="/upgrade"
            className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-background px-4 py-3"
          >
            <Lock className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">แนบรูปใบเสร็จหรือสินค้า</span>
              <span className="block text-xs text-muted">ใช้ได้ในแผน Pro ขึ้นไป</span>
            </span>
            <span className="text-sm font-semibold text-primary">ดูแผน</span>
          </Link>
        )}
      </Field>

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
        {saving ? "กำลังบันทึก..." : "บันทึก"}
      </button>
      {extra}
    </form>
  );
}
