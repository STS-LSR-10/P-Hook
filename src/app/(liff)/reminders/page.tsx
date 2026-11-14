"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Plus,
  Repeat as RepeatIcon,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GroupReminders } from "@/components/liff/group-space";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { fieldClass } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { SpaceSwitch } from "@/components/liff/space-switch";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { Logo } from "@/components/logo";
import {
  addDays,
  buildDayMap,
  monthGrid,
  weekStart,
  ymdOf,
  type DayEntry,
} from "@/lib/reminder-calendar";
import {
  formatThaiDate,
  fromBangkokInputValue,
  toBangkokInputValue,
  yearOf,
} from "@/lib/thai-date";
import {
  CATEGORY_INFO,
  DEFAULT_TIME,
  MAX_CUSTOM_REMINDER_CATEGORIES,
  MAX_REMINDER_CATEGORY_NAME,
  MAX_REMINDER_TEXT,
  REMINDER_CATEGORIES,
  REPEAT_LABEL,
  REPEAT_LOCKED_TEXT,
  categoryLook,
  reminderKind,
  type CustomReminderCategory,
  type ReminderDto,
  type ReminderKind,
  type Repeat,
} from "@/lib/user-reminder";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { canSendToChat } from "@/lib/liff-chat";
import { EmojiPicker } from "@/components/liff/emoji-picker";
import { isSingleEmoji } from "@/lib/category-emoji";

/** How long "แก้ไขแล้ว" shows before the page closes back to the chat. */
const CLOSE_AFTER_MS = 900;

/**
 * After a reminder opened from its card in the chat was changed: say so in the chat as the person's own
 * message (the bot answers it with the reminder's card, a free reply) and close, back to the chat.
 * False when LINE does not let this page write in the chat (opened outside it).
 */
async function backToChat(reminderId: string): Promise<boolean> {
  try {
    const liff = (await import("@line/liff")).default;
    if (!canSendToChat(liff)) return false;
    try {
      if ((await liff.permission.query("chat_message.write")).state === "prompt") {
        await liff.permission.requestAll();
      }
    } catch {
      /* sending below tells whether it worked */
    }
    // a command the bot reads: stays Thai
    await liff.sendMessages([
      { type: "text", text: `แก้ไขเตือนเสร็จแล้ว #${reminderId.slice(0, 8)}` },
    ]);
    await new Promise((r) => setTimeout(r, CLOSE_AFTER_MS));
    liff.closeWindow();
    return true;
  } catch {
    return false;
  }
}

interface RemindersResponse {
  items: ReminderDto[];
  /** One-offs waiting, of `limit`. */
  active: number;
  limit: number;
  /** Repeating ones waiting, of `repeatLimit` (their own limit). */
  repeating: number;
  repeatLimit: number;
  canAdd: boolean;
  canAddOnce: boolean;
  canAddRepeat: boolean;
  /** The person's own categories. */
  categories?: CustomReminderCategory[];
}

/** Whether each kind of reminder has room, and its limit. */
type Room = Record<ReminderKind, { full: boolean; limit: number }>;

type Period = "day" | "week" | "month";
type Filter = "all" | "active" | "done";

const MONTHS = [
  t("มกราคม"),
  t("กุมภาพันธ์"),
  t("มีนาคม"),
  t("เมษายน"),
  t("พฤษภาคม"),
  t("มิถุนายน"),
  t("กรกฎาคม"),
  t("สิงหาคม"),
  t("กันยายน"),
  t("ตุลาคม"),
  t("พฤศจิกายน"),
  t("ธันวาคม"),
];
const WEEKDAYS = [t("อา"), t("จ"), t("อ"), t("พ"), t("พฤ"), t("ศ"), t("ส")];
const OWL_WORDS = [
  t("อย่าลืมทำตามเวลาที่ตั้งไว้นะฮูก!"),
  t("วันนี้มีภารกิจอะไรให้พี่ฮูกช่วยเตือนไหมครับ?"),
  t("ตรวจเช็กเวลาให้ตรง แล้วจะไม่พลาดนัดสำคัญเลย!"),
  t("ฮูกก! บันทึกเตือนในปฏิทินแล้ว สบายใจได้เลย"),
];
const FIRST_WORD = t("แตะพี่ฮูกเพื่อฟังคำทักทาย หรือกดปุ่ม + สีส้มเพื่อตั้งเตือนใหม่ได้เลยครับ!");
const CONFETTI = ["#FF8800", "#5F9E6B", "#FFD180", "#4B8154"];

const dayDate = (ymd: string) => new Date(`${ymd}T05:00:00Z`);
const dayLabel = (ymd: string) => formatThaiDate(dayDate(ymd));
const shortDay = (at: Date) => formatThaiDate(at).split(" ").slice(0, 2).join(" ");
const clock = (at: Date) => toBangkokInputValue(at).slice(11, 16);
const monthOf = (ymd: string) => ({
  year: Number(ymd.slice(0, 4)),
  month: Number(ymd.slice(5, 7)),
});
const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${yearOf(year)}`;

/** A time still ahead today, so saving a new reminder does not fail on the default. */
function nextHour(): string {
  const hour = Number(toBangkokInputValue(new Date()).slice(11, 13)) + 1;
  return hour > 23 ? "23:59" : `${String(hour).padStart(2, "0")}:00`;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Reads `?g=` (a group's reminders, from the links in a group or the switch), which needs Suspense. */
export default function RemindersPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <Reminders />
    </Suspense>
  );
}

function Reminders() {
  const router = useRouter();
  const requested = useSearchParams().get("g") ?? "";
  const groupId = UUID_RE.test(requested) ? requested : null;
  // one page and one header either way, so the switch stays put (and does not ask again) as it changes
  return (
    <main className="-mb-24 min-h-screen bg-[#FAF8F3] dark:bg-background pb-44 text-slate-800 dark:text-foreground">
      <header className="flex items-center justify-between gap-2 bg-[#82C392] px-4 py-3 dark:bg-[#1d3a2b]">
        <h1 className="text-lg font-bold text-slate-900 dark:text-foreground">
          {t("เตือน | พี่ฮูก")}
        </h1>
        <SpaceSwitch
          groupId={groupId}
          onChange={(next) => router.replace(next ? `/reminders?g=${next}` : "/reminders")}
          className="bg-white/80 dark:bg-surface"
        />
      </header>
      {groupId ? (
        <div className="px-4 pt-3">
          <GroupReminders key={groupId} groupId={groupId} />
        </div>
      ) : (
        <PersonalReminders />
      )}
    </main>
  );
}

function PersonalReminders() {
  const { api } = useLiff();
  // "?edit=<id>": opened from a reminder's card in the chat, on that reminder, ready to change
  const editId = useSearchParams().get("edit");
  const opened = useRef(false);
  const reminders = useApi<RemindersResponse>("/api/reminders");
  const data = reminders.data;
  const items = useMemo(() => data?.items ?? [], [data]);

  const today = ymdOf(new Date());
  const [view, setView] = useState<"calendar" | "all">("calendar");
  const [period, setPeriod] = useState<Period>("month");
  const [selected, setSelected] = useState(today);
  const [shown, setShown] = useState(() => monthOf(today));
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ reminder: ReminderDto | null } | null>(null);
  const ticking = useRef(new Set<string>());
  const [word, setWord] = useState(FIRST_WORD);
  const [cheers, setCheers] = useState(0);

  useEffect(() => {
    if (!editId || opened.current || !data) return;
    opened.current = true;
    const reminder = data.items.find((r) => r.id === editId);
    if (!reminder) {
      setNotice(t("ไม่พบเตือนนี้แล้ว (อาจส่งไปแล้วหรือถูกยกเลิก)"));
      return;
    }
    pick(ymdOf(new Date(reminder.remindAt)));
    setForm({ reminder });
  }, [editId, data]);

  const cells = useMemo(() => monthGrid(shown.year, shown.month), [shown]);
  const week = weekStart(selected);
  const days = useMemo(() => {
    const edges = [cells[0]?.ymd ?? selected, week, selected];
    const ends = [cells[cells.length - 1]?.ymd ?? selected, addDays(week, 6), selected];
    return buildDayMap(items, {
      from: edges.sort()[0] ?? selected,
      to: ends.sort().at(-1) ?? selected,
    });
  }, [items, cells, week, selected]);
  const entries = days.get(selected) ?? [];

  function pick(ymd: string) {
    setSelected(ymd);
    setShown(monthOf(ymd));
  }

  function step(direction: 1 | -1) {
    if (period === "day") return pick(addDays(selected, direction));
    if (period === "week") return pick(addDays(selected, direction * 7));
    const month = shown.month + direction;
    const year = shown.year + (month > 12 ? 1 : month < 1 ? -1 : 0);
    const first = `${year}-${String(month > 12 ? 1 : month < 1 ? 12 : month).padStart(2, "0")}-01`;
    pick(today.slice(0, 7) === first.slice(0, 7) ? today : first);
  }

  function cheer() {
    setWord((current) => {
      const others = OWL_WORDS.filter((w) => w !== current);
      return others[Math.floor(Math.random() * others.length)] ?? current;
    });
    setCheers((n) => n + 1);
  }

  async function tick(reminder: ReminderDto) {
    if (ticking.current.has(reminder.id)) return;
    ticking.current.add(reminder.id);
    const action = reminder.status === "done" ? "undo" : "done";
    setNotice(null);
    try {
      const result = await api<{ skipped?: boolean }>(`/api/reminders/${reminder.id}`, {
        method: "PATCH",
        body: JSON.stringify(
          action === "done" ? { action, remindAt: reminder.remindAt } : { action },
        ),
      });
      setNotice(
        action === "undo"
          ? t("กลับมารอเตือนแล้ว")
          : result.skipped
            ? t("ข้ามรอบนี้แล้ว รอบถัดไปยังเตือนตามเดิม")
            : t("เสร็จแล้ว เก่งมากครับ!"),
      );
      if (action === "done") cheer();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("เปลี่ยนสถานะไม่สำเร็จ"));
    } finally {
      ticking.current.delete(reminder.id);
      reminders.reload();
    }
  }

  async function remove(reminder: ReminderDto) {
    const question = reminder.repeat
      ? t('ลบเตือน "{0}" ทุกรอบใช่ไหม?', reminder.body)
      : t('ลบเตือน "{0}" ใช่ไหม?', reminder.body);
    if (!window.confirm(question)) return;
    setNotice(null);
    try {
      await api(`/api/reminders/${reminder.id}`, { method: "DELETE" });
      setNotice(t("ลบแล้ว"));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("ลบไม่สำเร็จ"));
    } finally {
      reminders.reload();
    }
  }

  const own = data?.categories ?? [];
  const rowActions = {
    own,
    onEdit: (reminder: ReminderDto) => setForm({ reminder }),
    onTick: (reminder: ReminderDto) => void tick(reminder),
    onDelete: (reminder: ReminderDto) => void remove(reminder),
  };
  const counts = {
    all: items.length,
    active: items.filter((r) => r.status === "active").length,
    done: items.filter((r) => r.status === "done").length,
  };
  const label =
    period === "month"
      ? monthLabel(shown.year, shown.month)
      : period === "week"
        ? monthLabel(monthOf(selected).year, monthOf(selected).month)
        : dayLabel(selected);

  return (
    <>
      <div className="px-4 pb-1 pt-3">
        <div className="flex rounded-2xl bg-[#EBE7DC] dark:bg-border p-1">
          {[
            { key: "calendar" as const, text: t("แสดงเป็นปฏิทิน"), Icon: CalendarDays },
            { key: "all" as const, text: t("รายการทั้งหมด"), Icon: ListChecks },
          ].map(({ key, text, Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-1 text-xs",
                view === key
                  ? "bg-white dark:bg-surface font-semibold text-[#BF360C] dark:text-[#FF9E6B]"
                  : "text-slate-700 dark:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {text}
              {key === "all" && data ? (
                <span className="rounded-full bg-[#BF4A00] px-1.5 text-[11px] font-bold text-white">
                  {counts.all}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {reminders.loading && !data ? (
        <div className="px-4 py-4">
          <LoadingBlock rows={4} />
        </div>
      ) : reminders.error && !data ? (
        <ErrorState message={reminders.error} onRetry={reminders.reload} />
      ) : view === "all" ? (
        <section className="space-y-2.5 px-4 py-2" aria-label={t("รายการทั้งหมด")}>
          <div className="flex gap-2 overflow-x-auto py-1.5">
            {[
              { key: "all" as const, text: t("ทั้งหมด ({0})", counts.all) },
              { key: "active" as const, text: t("ยังไม่เตือน") },
              { key: "done" as const, text: t("เสร็จสิ้นแล้ว") },
            ].map(({ key, text }) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "h-9 shrink-0 rounded-full px-3.5 text-xs",
                  filter === key
                    ? "bg-[#BF4A00] font-bold text-white"
                    : "border border-slate-200 dark:border-border bg-white dark:bg-surface text-slate-700 dark:text-foreground",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <AllList items={items} filter={filter} {...rowActions} />
        </section>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-2">
            <div className="inline-flex rounded-xl bg-[#EBE7DC] dark:bg-border p-0.5">
              {[
                { key: "day" as const, text: t("วัน") },
                { key: "week" as const, text: t("สัปดาห์") },
                { key: "month" as const, text: t("เดือน") },
              ].map(({ key, text }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={period === key}
                  onClick={() => {
                    setPeriod(key);
                    setShown(monthOf(selected));
                  }}
                  className={cn(
                    "h-9 rounded-lg px-3.5 text-xs",
                    period === key
                      ? "bg-[#FFD180] font-bold text-[#8A2B00] dark:bg-warn-soft dark:text-[#FFB38A]"
                      : "text-slate-700 dark:text-foreground",
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => pick(today)}
              className="h-9 rounded-xl border border-emerald-200 dark:border-border bg-emerald-100 dark:bg-primary-soft px-3 text-xs font-semibold text-emerald-900 dark:text-primary"
            >
              {t("วันนี้")}
            </button>
          </div>

          <div className="flex items-center gap-2 px-4 py-1">
            <button
              type="button"
              aria-label={t("ก่อนหน้า")}
              onClick={() => step(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 dark:border-border bg-white dark:bg-surface text-slate-700 dark:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <p className="min-w-0 flex-1 text-center text-base font-bold text-slate-800 dark:text-foreground">
              {label}
            </p>
            <button
              type="button"
              aria-label={t("ถัดไป")}
              onClick={() => step(1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 dark:border-border bg-white dark:bg-surface text-slate-700 dark:text-foreground"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {period === "month" ? (
            <div className="mx-3 mt-1 rounded-3xl border border-slate-200 dark:border-border bg-white dark:bg-surface p-3">
              <div
                aria-hidden
                className="mb-1 grid grid-cols-7 text-center text-[11px] font-bold text-slate-500 dark:text-muted"
              >
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map(({ ymd, inMonth }) => (
                  <DayCell
                    key={ymd}
                    ymd={ymd}
                    entries={days.get(ymd)}
                    selected={ymd === selected}
                    muted={!inMonth}
                    onPick={pick}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {period === "week" ? (
            <div className="mx-3 mt-1 rounded-3xl border border-slate-200 dark:border-border bg-white dark:bg-surface p-3">
              <p className="mb-2 text-center text-xs font-bold text-emerald-800 dark:text-primary">
                {dayLabel(week)} - {dayLabel(addDays(week, 6))}
              </p>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((name, i) => {
                  const ymd = addDays(week, i);
                  return (
                    <div key={name} className="text-center">
                      <p
                        aria-hidden
                        className="mb-1 text-[11px] font-bold text-slate-500 dark:text-muted"
                      >
                        {name}
                      </p>
                      <DayCell
                        ymd={ymd}
                        entries={days.get(ymd)}
                        selected={ymd === selected}
                        muted={false}
                        onPick={pick}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mx-3.5 mt-3 flex items-center justify-between gap-2 rounded-3xl border border-emerald-200 dark:border-border bg-gradient-to-r from-[#D9EFE0] dark:from-primary-soft via-[#EEF6EF] dark:via-surface to-[#FEF5E7] dark:to-surface p-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 inline-block rounded-full bg-white/80 dark:bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900 dark:text-primary">
                {t("พี่ฮูกพร้อมเตือนทุกเรื่อง")}
              </p>
              <p
                data-testid="owl-word"
                aria-live="polite"
                className="text-xs text-slate-700 dark:text-foreground"
              >
                {word}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("แตะพี่ฮูก")}
              onClick={cheer}
              className="relative shrink-0 rounded-2xl"
            >
              <Logo size={80} />
              <Confetti key={cheers} active={cheers > 0} />
            </button>
          </div>

          <section className="mt-3.5 px-4" aria-label={t("รายการเตือนของวันที่เลือก")}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800 dark:text-foreground">
                {t("รายการเตือน:")} {dayLabel(selected)}
              </h2>
              <span className="rounded-full bg-slate-200 dark:bg-border px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:text-foreground">
                {entries.length} {t("รายการ")}
              </span>
            </div>
            {entries.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 dark:border-border bg-white/70 dark:bg-surface p-5 text-center">
                <p className="text-sm font-bold text-slate-700 dark:text-foreground">
                  {t("ไม่มีรายการเตือนในวันที่เลือก")}
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-muted">
                  {t("กดปุ่ม + เพื่อเพิ่มการแจ้งเตือนได้เลยครับ")}
                </p>
              </div>
            ) : (
              <ul aria-label={t("รายการเตือน")} className="space-y-2">
                {entries.map(({ reminder, at, next }) => (
                  <ReminderRow
                    key={`${reminder.id}-${at.getTime()}`}
                    reminder={reminder}
                    at={at}
                    canTick={next}
                    {...rowActions}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* always in the page, so a reader announces what lands in it; fixed, so it is always seen */}
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-4"
      >
        {notice ? (
          <p className="rounded-2xl bg-[#2F5A38] px-4 py-2 text-center text-sm text-white shadow-lg">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-md justify-end px-4">
        <button
          type="button"
          aria-label={t("เพิ่มการเตือนใหม่")}
          onClick={() => setForm({ reminder: null })}
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#D65F00] text-white shadow-lg"
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      </div>

      {form ? (
        <ReminderSheet
          reminder={form.reminder}
          own={own}
          onOwnChanged={reminders.reload}
          day={selected}
          today={today}
          room={{
            once: { full: data ? !data.canAddOnce : false, limit: data?.limit ?? 0 },
            repeat: { full: data ? !data.canAddRepeat : false, limit: data?.repeatLimit ?? 0 },
          }}
          onClose={() => setForm(null)}
          onSaved={(message, ymd) => {
            const fromChat = form.reminder !== null && form.reminder.id === editId;
            setForm(null);
            setNotice(message);
            // changed from its card: back to the chat, where its new card arrives
            if (fromChat && form.reminder) void backToChat(form.reminder.id);
            // a repeat stays on the day in view: it still has rounds there
            if (!form.reminder?.repeat) pick(ymd);
            cheer();
            reminders.reload();
          }}
        />
      ) : null}
    </>
  );
}

function DayCell({
  ymd,
  entries,
  selected,
  muted,
  onPick,
}: {
  ymd: string;
  entries: DayEntry[] | undefined;
  selected: boolean;
  muted: boolean;
  onPick: (ymd: string) => void;
}) {
  const today = ymdOf(new Date());
  const waiting = entries?.some((e) => e.reminder.status === "active");
  return (
    <button
      type="button"
      aria-label={`${dayLabel(ymd)}${entries ? t(", มีเตือน") : ""}`}
      aria-pressed={selected}
      aria-current={ymd === today ? "date" : undefined}
      onClick={() => onPick(ymd)}
      className={cn(
        "flex h-11 w-full flex-col items-center justify-center rounded-xl text-xs font-semibold",
        selected
          ? "bg-[#3F7A4B] text-white"
          : muted
            ? "text-slate-500 dark:text-muted"
            : "text-slate-800 dark:text-foreground",
        ymd === today && !selected && "ring-2 ring-[#FFB74D]",
      )}
    >
      {Number(ymd.slice(8))}
      <span
        aria-hidden
        className={cn(
          "mt-0.5 h-1.5 w-1.5 rounded-full",
          !entries
            ? ""
            : selected
              ? "bg-white dark:bg-surface"
              : waiting
                ? "bg-[#FF8800]"
                : "bg-[#5F9E6B]",
        )}
      />
    </button>
  );
}

function ReminderRow({
  reminder,
  at,
  canTick,
  showDay = false,
  own,
  onEdit,
  onTick,
  onDelete,
}: {
  reminder: ReminderDto;
  at: Date;
  canTick: boolean;
  showDay?: boolean;
  own: readonly CustomReminderCategory[];
  onEdit: (reminder: ReminderDto) => void;
  onTick: (reminder: ReminderDto) => void;
  onDelete: (reminder: ReminderDto) => void;
}) {
  const done = reminder.status === "done";
  const icon = categoryLook(reminder.category, own)?.icon ?? "🔔";
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-border bg-white dark:bg-surface pl-2.5 pr-1",
        done && "bg-slate-50 dark:bg-surface",
      )}
    >
      <button
        type="button"
        onClick={() => onEdit(reminder)}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <span
          aria-hidden
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm",
            done
              ? "bg-emerald-100 dark:bg-primary-soft text-emerald-800 dark:text-primary"
              : "bg-orange-100 dark:bg-warn-soft",
          )}
        >
          {done ? "✓" : icon}
        </span>
        <span
          className={cn(
            "flex min-w-0 flex-1 gap-x-2 gap-y-0.5",
            showDay ? "flex-col" : "items-center",
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate text-sm font-semibold",
              !showDay && "flex-1",
              done
                ? "text-slate-600 dark:text-muted line-through"
                : "text-slate-800 dark:text-foreground",
            )}
          >
            {reminder.body}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="whitespace-nowrap rounded-md border border-emerald-200 dark:border-border bg-[#E1EFE3] dark:bg-primary-soft px-1.5 py-0.5 text-[11px] font-bold text-emerald-900 dark:text-primary">
              {showDay ? `${shortDay(at)} · ` : ""}
              {t("เวลา")} {clock(at)} {t("น.")}
            </span>
            {reminder.repeat ? (
              <span className="text-slate-500 dark:text-muted">
                <RepeatIcon className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">{REPEAT_LABEL[reminder.repeat]}</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {canTick ? (
        <button
          type="button"
          aria-label={`${done ? t("ยกเลิกเสร็จ") : t("ทำเสร็จ")} ${reminder.body}`}
          onClick={() => onTick(reminder)}
          className="flex h-10 w-9 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded border",
              done
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-slate-400 dark:border-border",
            )}
          >
            {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          </span>
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t("ลบ {0}", reminder.body)}
        onClick={() => onDelete(reminder)}
        className="flex h-10 w-9 shrink-0 items-center justify-center text-slate-500 dark:text-muted"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

function AllList({
  items,
  filter,
  own,
  onEdit,
  onTick,
  onDelete,
}: {
  items: ReminderDto[];
  filter: Filter;
  own: readonly CustomReminderCategory[];
  onEdit: (reminder: ReminderDto) => void;
  onTick: (reminder: ReminderDto) => void;
  onDelete: (reminder: ReminderDto) => void;
}) {
  const shown = items
    .filter((r) => filter === "all" || r.status === filter)
    // what waits comes first, soonest on top; what is finished follows, newest on top
    .sort((a, b) =>
      a.status !== b.status
        ? a.status.localeCompare(b.status)
        : a.status === "done"
          ? b.remindAt.localeCompare(a.remindAt)
          : a.remindAt.localeCompare(b.remindAt),
    );
  if (shown.length === 0) {
    return (
      <p className="rounded-3xl border border-slate-200 dark:border-border bg-white dark:bg-surface p-6 text-center text-sm text-slate-600 dark:text-muted">
        {t("ไม่มีรายการเตือนในหมวดนี้")}
      </p>
    );
  }
  return (
    <ul aria-label={t("รายการเตือน")} className="space-y-2">
      {shown.map((reminder) => (
        <ReminderRow
          key={reminder.id}
          reminder={reminder}
          at={new Date(reminder.remindAt)}
          canTick
          showDay
          own={own}
          onEdit={onEdit}
          onTick={onTick}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

/** A small burst around the owl. Left out for people who asked for less movement. */
function Confetti({ active }: { active: boolean }) {
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const dots = box.current ? [...box.current.children] : [];
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    dots.forEach((dot, i) => {
      const angle = (i / dots.length) * Math.PI * 2;
      dot.animate(
        [
          { transform: "translate(0, 0)", opacity: 1 },
          {
            transform: `translate(${Math.cos(angle) * 44}px, ${Math.sin(angle) * 44}px)`,
            opacity: 0,
          },
        ],
        { duration: 700, easing: "ease-out" },
      );
    });
  }, [active]);

  return (
    <span ref={box} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full opacity-0"
          style={{ backgroundColor: CONFETTI[i % CONFETTI.length] }}
        />
      ))}
    </span>
  );
}

function ReminderSheet({
  reminder,
  own,
  onOwnChanged,
  day,
  today,
  room,
  onClose,
  onSaved,
}: {
  reminder: ReminderDto | null;
  own: readonly CustomReminderCategory[];
  onOwnChanged: () => void;
  day: string;
  today: string;
  room: Room;
  onClose: () => void;
  onSaved: (message: string, ymd: string) => void;
}) {
  const { api } = useLiff();
  const start = reminder
    ? toBangkokInputValue(new Date(reminder.remindAt))
    : `${day}T${day === today ? nextHour() : DEFAULT_TIME.label}`;
  const series = reminder?.repeat ? reminder : null;
  const [body, setBody] = useState(reminder?.body ?? "");
  const [date, setDate] = useState(start.slice(0, 10));
  const [time, setTime] = useState(start.slice(11, 16));
  const [category, setCategory] = useState<string | null>(reminder?.category ?? null);
  const [repeat, setRepeat] = useState<Repeat | "">(reminder?.repeat ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // one-offs and repeats have their own limits: a new one, a finished one brought back, or one
  // switched to the other kind needs room in the kind it will be
  const kind = reminderKind(repeat || null);
  const joins = !reminder || reminder.status === "done" || reminderKind(reminder.repeat) !== kind;
  const full = joins && room[kind].full;
  const limit = room[kind].limit;

  async function save(e: FormEvent) {
    e.preventDefault();
    const at = fromBangkokInputValue(`${date}T${time}`);
    if (!at) {
      setError(t("เลือกวันเวลาให้ถูกต้องนะ"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(reminder ? `/api/reminders/${reminder.id}` : "/api/reminders", {
        method: reminder ? "PATCH" : "POST",
        body: JSON.stringify({
          body,
          remindAt: at.toISOString(),
          repeat: repeat || null,
          category,
        }),
      });
      onSaved(reminder ? t("แก้ไขแล้ว") : t("พี่ฮูกบันทึกการเตือนให้แล้วครับ!"), date);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={reminder ? t("แก้การเตือน") : t("ตั้งเตือนใหม่กับพี่ฮูก")} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        {series ? (
          <p className="rounded-xl bg-amber-100 dark:bg-warn-soft px-3 py-2 text-sm text-amber-900 dark:text-warn">
            {t("แก้ทุกรอบ · รอบถัดไป")} {formatThaiDate(new Date(series.remindAt))}
          </p>
        ) : null}
        <div>
          <label htmlFor="reminder-body" className="mb-1 block text-xs font-semibold">
            {t("ชื่อรายการเตือน")}
          </label>
          <input
            id="reminder-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_REMINDER_TEXT}
            placeholder={t("เช่น เตือนจ่ายค่าเน็ต, นัดส่งงาน")}
            className={fieldClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="reminder-date" className="mb-1 block text-xs font-semibold">
              {series ? t("วันที่รอบถัดไป") : t("วันที่เตือน")}
            </label>
            <input
              id="reminder-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="reminder-time" className="mb-1 block text-xs font-semibold">
              {t("เวลา")}
            </label>
            <input
              id="reminder-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={fieldClass}
            />
          </div>
        </div>
        <CategoryPicker
          value={category}
          onChange={setCategory}
          own={own}
          onOwnChanged={onOwnChanged}
        />
        <div>
          <label htmlFor="reminder-repeat" className="mb-1 block text-xs font-semibold">
            {t("ทำซ้ำ")}
          </label>
          <select
            id="reminder-repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as Repeat | "")}
            className={fieldClass}
          >
            <option value="">{t("ครั้งเดียว")}</option>
            {(Object.keys(REPEAT_LABEL) as Repeat[]).map((key) => (
              <option key={key} value={key}>
                {REPEAT_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        {full ? (
          <p className="text-sm text-warn">
            {kind === "repeat" && limit === 0
              ? REPEAT_LOCKED_TEXT
              : kind === "repeat"
                ? t(
                    'มีเตือนประจำ (เตือนซ้ำ) ครบ {0} รายการแล้ว เลือก "ครั้งเดียว" ลบอันที่ไม่ใช้ หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ',
                    limit,
                  )
                : t(
                    "มีเตือนที่รออยู่ครบ {0} รายการแล้ว ลบอันที่ไม่ใช้หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ",
                    limit,
                  )}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || full || !body.trim() || !date || !time}
          className="h-12 w-full rounded-2xl bg-[#3F7A4B] font-semibold text-white disabled:opacity-60"
        >
          {busy ? t("กำลังบันทึก…") : t("บันทึกการเตือน")}
        </button>
      </form>
    </Sheet>
  );
}

const chipClass = (on: boolean) =>
  cn(
    "min-h-11 rounded-xl border px-1 text-xs",
    on
      ? "border-emerald-600 bg-emerald-50 dark:bg-primary-soft font-semibold text-emerald-900 dark:text-primary"
      : "border-border",
  );

/** The built-in categories, the person's own, and adding, renaming or removing their own. */
function CategoryPicker({
  value,
  onChange,
  own,
  onOwnChanged,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  own: readonly CustomReminderCategory[];
  onOwnChanged: () => void;
}) {
  const { api } = useLiff();
  /** null: closed; "new": adding one; an id: editing that one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = own.find((c) => c.id === value) ?? null;

  function open(c: CustomReminderCategory | null) {
    setEditing(c ? c.id : "new");
    setName(c?.name ?? "");
    setEmoji(c?.emoji ?? "");
    setError(null);
  }

  async function save() {
    if (!name.trim() || !isSingleEmoji(emoji)) {
      setError(t("ตั้งชื่อหมวดและเลือกอีโมจิ 1 ตัวนะ"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const isNew = editing === "new";
      const res = await api<{ category: CustomReminderCategory }>(
        isNew ? "/api/reminders/categories" : `/api/reminders/categories/${editing}`,
        { method: isNew ? "POST" : "PATCH", body: JSON.stringify({ name, emoji }) },
      );
      if (isNew) onChange(res.category.id);
      setEditing(null);
      onOwnChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: CustomReminderCategory) {
    if (!window.confirm(t("ลบหมวด “{0}” ไหม? เตือนในหมวดนี้ยังอยู่ แค่ไม่มีหมวด", c.name))) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/reminders/categories/${c.id}`, { method: "DELETE" });
      onChange(null);
      onOwnChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ลบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold">{t("หมวดหมู่")}</legend>
      <div className="grid grid-cols-4 gap-1.5">
        {REMINDER_CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(value === key ? null : key)}
            className={chipClass(value === key)}
          >
            {CATEGORY_INFO[key].icon} {CATEGORY_INFO[key].label}
          </button>
        ))}
        {own.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={value === c.id}
            onClick={() => onChange(value === c.id ? null : c.id)}
            className={cn(chipClass(value === c.id), "break-all")}
          >
            {c.emoji} {c.name}
          </button>
        ))}
        {own.length < MAX_CUSTOM_REMINDER_CATEGORIES ? (
          <button
            type="button"
            onClick={() => open(null)}
            className="min-h-11 rounded-xl border border-dashed border-border px-1 text-xs text-primary"
          >
            {t("+ หมวดใหม่")}
          </button>
        ) : null}
      </div>
      {picked && editing === null ? (
        <div className="mt-1.5 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => open(picked)}
            className="min-h-11 px-2 font-semibold text-primary"
          >
            {t("แก้หมวดนี้")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove(picked)}
            className="min-h-11 px-2 font-semibold text-expense"
          >
            {t("ลบหมวดนี้")}
          </button>
        </div>
      ) : null}
      {editing !== null ? (
        <div
          className="mt-2 space-y-2 rounded-2xl border border-border p-3"
          // it sits inside the reminder's form: Enter here adds the category, not the reminder
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              if (!busy) void save();
            }
          }}
        >
          <label htmlFor="reminder-category-name" className="block text-xs font-semibold">
            {t("ชื่อหมวด")}
          </label>
          <input
            id="reminder-category-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_REMINDER_CATEGORY_NAME}
            placeholder={t("เช่น ออกกำลังกาย")}
            className={fieldClass}
          />
          <EmojiPicker value={emoji} onChange={setEmoji} label={t("อีโมจิ")} />
          {error ? (
            <p role="alert" className="text-sm text-expense">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="h-11 rounded-2xl border border-border text-sm"
            >
              {t("ยกเลิก")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="h-11 rounded-2xl bg-[#3F7A4B] text-sm font-semibold text-white disabled:opacity-60"
            >
              {editing === "new" ? t("เพิ่มหมวด") : t("บันทึกหมวด")}
            </button>
          </div>
        </div>
      ) : error ? (
        <p role="alert" className="mt-1 text-sm text-expense">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
