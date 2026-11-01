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
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { fieldClass } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
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
import { formatThaiDate, fromBangkokInputValue, toBangkokInputValue } from "@/lib/thai-date";
import {
  CATEGORY_INFO,
  MAX_REMINDER_TEXT,
  REMINDER_CATEGORIES,
  REPEAT_LABEL,
  type ReminderCategory,
  type ReminderDto,
  type Repeat,
} from "@/lib/user-reminder";
import { cn } from "@/lib/utils";

interface RemindersResponse {
  items: ReminderDto[];
  active: number;
  limit: number;
  canAdd: boolean;
}

type Period = "day" | "week" | "month";
type Filter = "all" | "active" | "done";

const MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
const WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const OWL_WORDS = [
  "อย่าลืมทำตามเวลาที่ตั้งไว้นะฮูก!",
  "วันนี้มีภารกิจอะไรให้พี่ฮูกช่วยเตือนไหมครับ?",
  "ตรวจเช็กเวลาให้ตรง แล้วจะไม่พลาดนัดสำคัญเลย!",
  "ฮูกก! บันทึกเตือนในปฏิทินแล้ว สบายใจได้เลย",
];
const FIRST_WORD = "แตะพี่ฮูกเพื่อฟังคำทักทาย หรือกดปุ่ม + สีส้มเพื่อตั้งเตือนใหม่ได้เลยครับ!";
const CONFETTI = ["#FF8800", "#5F9E6B", "#FFD180", "#4B8154"];

const dayDate = (ymd: string) => new Date(`${ymd}T05:00:00Z`);
const dayLabel = (ymd: string) => formatThaiDate(dayDate(ymd));
const shortDay = (at: Date) => formatThaiDate(at).split(" ").slice(0, 2).join(" ");
const clock = (at: Date) => toBangkokInputValue(at).slice(11, 16);
const monthOf = (ymd: string) => ({
  year: Number(ymd.slice(0, 4)),
  month: Number(ymd.slice(5, 7)),
});
const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year + 543}`;

/** A time still ahead today, so saving a new reminder does not fail on the default. */
function nextHour(): string {
  const hour = Number(toBangkokInputValue(new Date()).slice(11, 13)) + 1;
  return hour > 23 ? "23:59" : `${String(hour).padStart(2, "0")}:00`;
}

export default function RemindersPage() {
  const { api } = useLiff();
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
          ? "กลับมารอเตือนแล้ว"
          : result.skipped
            ? "ข้ามรอบนี้แล้ว รอบถัดไปยังเตือนตามเดิม"
            : "เสร็จแล้ว เก่งมากครับ!",
      );
      if (action === "done") cheer();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      ticking.current.delete(reminder.id);
      reminders.reload();
    }
  }

  async function remove(reminder: ReminderDto) {
    const question = reminder.repeat
      ? `ลบเตือน "${reminder.body}" ทุกรอบใช่ไหม?`
      : `ลบเตือน "${reminder.body}" ใช่ไหม?`;
    if (!window.confirm(question)) return;
    setNotice(null);
    try {
      await api(`/api/reminders/${reminder.id}`, { method: "DELETE" });
      setNotice("ลบแล้ว");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      reminders.reload();
    }
  }

  const rowActions = {
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
    <main className="-mb-24 min-h-screen bg-[#FAF8F3] pb-44 text-slate-800">
      <header className="flex items-center justify-between gap-2 bg-[#82C392] px-4 py-3">
        <h1 className="text-lg font-bold text-slate-900">เตือน | พี่ฮูก</h1>
        <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-semibold text-[#2F5A38]">
          ส่วนตัว
        </span>
      </header>

      <div className="px-4 pb-1 pt-3">
        <div className="flex rounded-2xl bg-[#EBE7DC] p-1">
          {[
            { key: "calendar" as const, text: "แสดงเป็นปฏิทิน", Icon: CalendarDays },
            { key: "all" as const, text: "รายการทั้งหมด", Icon: ListChecks },
          ].map(({ key, text, Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-1 text-xs",
                view === key ? "bg-white font-semibold text-[#BF360C]" : "text-slate-700",
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
        <section className="space-y-2.5 px-4 py-2" aria-label="รายการทั้งหมด">
          <div className="flex gap-2 overflow-x-auto py-1.5">
            {[
              { key: "all" as const, text: `ทั้งหมด (${counts.all})` },
              { key: "active" as const, text: "ยังไม่เตือน" },
              { key: "done" as const, text: "เสร็จสิ้นแล้ว" },
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
                    : "border border-slate-200 bg-white text-slate-700",
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
            <div className="inline-flex rounded-xl bg-[#EBE7DC] p-0.5">
              {[
                { key: "day" as const, text: "วัน" },
                { key: "week" as const, text: "สัปดาห์" },
                { key: "month" as const, text: "เดือน" },
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
                    period === key ? "bg-[#FFD180] font-bold text-[#8A2B00]" : "text-slate-700",
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => pick(today)}
              className="h-9 rounded-xl border border-emerald-200 bg-emerald-100 px-3 text-xs font-semibold text-emerald-900"
            >
              วันนี้
            </button>
          </div>

          <div className="flex items-center gap-2 px-4 py-1">
            <button
              type="button"
              aria-label="ก่อนหน้า"
              onClick={() => step(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <p className="min-w-0 flex-1 text-center text-base font-bold text-slate-800">{label}</p>
            <button
              type="button"
              aria-label="ถัดไป"
              onClick={() => step(1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {period === "month" ? (
            <div className="mx-3 mt-1 rounded-3xl border border-slate-200 bg-white p-3">
              <div
                aria-hidden
                className="mb-1 grid grid-cols-7 text-center text-[11px] font-bold text-slate-500"
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
            <div className="mx-3 mt-1 rounded-3xl border border-slate-200 bg-white p-3">
              <p className="mb-2 text-center text-xs font-bold text-emerald-800">
                {dayLabel(week)} - {dayLabel(addDays(week, 6))}
              </p>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((name, i) => {
                  const ymd = addDays(week, i);
                  return (
                    <div key={name} className="text-center">
                      <p aria-hidden className="mb-1 text-[11px] font-bold text-slate-500">
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

          <div className="mx-3.5 mt-3 flex items-center justify-between gap-2 rounded-3xl border border-emerald-200 bg-gradient-to-r from-[#D9EFE0] via-[#EEF6EF] to-[#FEF5E7] p-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 inline-block rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900">
                พี่ฮูกพร้อมเตือนทุกเรื่อง
              </p>
              <p data-testid="owl-word" aria-live="polite" className="text-xs text-slate-700">
                {word}
              </p>
            </div>
            <button
              type="button"
              aria-label="แตะพี่ฮูก"
              onClick={cheer}
              className="relative shrink-0 rounded-2xl"
            >
              <Logo size={80} />
              <Confetti key={cheers} active={cheers > 0} />
            </button>
          </div>

          <section className="mt-3.5 px-4" aria-label="รายการเตือนของวันที่เลือก">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">
                รายการเตือน: {dayLabel(selected)}
              </h2>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                {entries.length} รายการ
              </span>
            </div>
            {entries.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-5 text-center">
                <p className="text-sm font-bold text-slate-700">ไม่มีรายการเตือนในวันที่เลือก</p>
                <p className="mt-0.5 text-xs text-slate-600">
                  กดปุ่ม + เพื่อเพิ่มการแจ้งเตือนได้เลยครับ
                </p>
              </div>
            ) : (
              <ul aria-label="รายการเตือน" className="space-y-2">
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
          aria-label="เพิ่มการเตือนใหม่"
          onClick={() => setForm({ reminder: null })}
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#D65F00] text-white shadow-lg"
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      </div>

      {form ? (
        <ReminderSheet
          reminder={form.reminder}
          day={selected}
          today={today}
          full={form.reminder ? false : data ? !data.canAdd : false}
          limit={data?.limit ?? 0}
          onClose={() => setForm(null)}
          onSaved={(message, ymd) => {
            setForm(null);
            setNotice(message);
            // a repeat stays on the day in view: it still has rounds there
            if (!form.reminder?.repeat) pick(ymd);
            cheer();
            reminders.reload();
          }}
        />
      ) : null}
    </main>
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
      aria-label={`${dayLabel(ymd)}${entries ? ", มีเตือน" : ""}`}
      aria-pressed={selected}
      aria-current={ymd === today ? "date" : undefined}
      onClick={() => onPick(ymd)}
      className={cn(
        "flex h-11 w-full flex-col items-center justify-center rounded-xl text-xs font-semibold",
        selected ? "bg-[#3F7A4B] text-white" : muted ? "text-slate-500" : "text-slate-800",
        ymd === today && !selected && "ring-2 ring-[#FFB74D]",
      )}
    >
      {Number(ymd.slice(8))}
      <span
        aria-hidden
        className={cn(
          "mt-0.5 h-1.5 w-1.5 rounded-full",
          !entries ? "" : selected ? "bg-white" : waiting ? "bg-[#FF8800]" : "bg-[#5F9E6B]",
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
  onEdit,
  onTick,
  onDelete,
}: {
  reminder: ReminderDto;
  at: Date;
  canTick: boolean;
  showDay?: boolean;
  onEdit: (reminder: ReminderDto) => void;
  onTick: (reminder: ReminderDto) => void;
  onDelete: (reminder: ReminderDto) => void;
}) {
  const done = reminder.status === "done";
  const icon = reminder.category ? CATEGORY_INFO[reminder.category].icon : "🔔";
  return (
    <li
      className={cn(
        "flex items-center gap-1 rounded-2xl border border-slate-200 bg-white pl-2.5 pr-1",
        done && "bg-slate-50",
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
            done ? "bg-emerald-100 text-emerald-800" : "bg-orange-100",
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
              done ? "text-slate-600 line-through" : "text-slate-800",
            )}
          >
            {reminder.body}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="whitespace-nowrap rounded-md border border-emerald-200 bg-[#E1EFE3] px-1.5 py-0.5 text-[11px] font-bold text-emerald-900">
              {showDay ? `${shortDay(at)} · ` : ""}เวลา {clock(at)} น.
            </span>
            {reminder.repeat ? (
              <span className="text-slate-500">
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
          aria-label={`${done ? "ยกเลิกเสร็จ" : "ทำเสร็จ"} ${reminder.body}`}
          onClick={() => onTick(reminder)}
          className="flex h-10 w-9 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded border",
              done ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-400",
            )}
          >
            {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          </span>
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`ลบ ${reminder.body}`}
        onClick={() => onDelete(reminder)}
        className="flex h-10 w-9 shrink-0 items-center justify-center text-slate-500"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

function AllList({
  items,
  filter,
  onEdit,
  onTick,
  onDelete,
}: {
  items: ReminderDto[];
  filter: Filter;
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
      <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        ไม่มีรายการเตือนในหมวดนี้
      </p>
    );
  }
  return (
    <ul aria-label="รายการเตือน" className="space-y-2">
      {shown.map((reminder) => (
        <ReminderRow
          key={reminder.id}
          reminder={reminder}
          at={new Date(reminder.remindAt)}
          canTick
          showDay
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
  day,
  today,
  full,
  limit,
  onClose,
  onSaved,
}: {
  reminder: ReminderDto | null;
  day: string;
  today: string;
  full: boolean;
  limit: number;
  onClose: () => void;
  onSaved: (message: string, ymd: string) => void;
}) {
  const { api } = useLiff();
  const start = reminder
    ? toBangkokInputValue(new Date(reminder.remindAt))
    : `${day}T${day === today ? nextHour() : "09:00"}`;
  const series = reminder?.repeat ? reminder : null;
  const [body, setBody] = useState(reminder?.body ?? "");
  const [date, setDate] = useState(start.slice(0, 10));
  const [time, setTime] = useState(start.slice(11, 16));
  const [category, setCategory] = useState<ReminderCategory | null>(reminder?.category ?? null);
  const [repeat, setRepeat] = useState<Repeat | "">(reminder?.repeat ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const at = fromBangkokInputValue(`${date}T${time}`);
    if (!at) {
      setError("เลือกวันเวลาให้ถูกต้องนะ");
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
      onSaved(reminder ? "แก้ไขแล้ว" : "พี่ฮูกบันทึกการเตือนให้แล้วครับ!", date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={reminder ? "แก้การเตือน" : "ตั้งเตือนใหม่กับพี่ฮูก"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        {series ? (
          <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900">
            แก้ทุกรอบ · รอบถัดไป {formatThaiDate(new Date(series.remindAt))}
          </p>
        ) : null}
        <div>
          <label htmlFor="reminder-body" className="mb-1 block text-xs font-semibold">
            ชื่อรายการเตือน
          </label>
          <input
            id="reminder-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_REMINDER_TEXT}
            placeholder="เช่น เตือนจ่ายค่าเน็ต, นัดส่งงาน"
            className={fieldClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="reminder-date" className="mb-1 block text-xs font-semibold">
              {series ? "วันที่รอบถัดไป" : "วันที่เตือน"}
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
              เวลา
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
        <fieldset>
          <legend className="mb-1 text-xs font-semibold">หมวดหมู่</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {REMINDER_CATEGORIES.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={category === key}
                onClick={() => setCategory(category === key ? null : key)}
                className={cn(
                  "min-h-11 rounded-xl border px-1 text-xs",
                  category === key
                    ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-900"
                    : "border-border",
                )}
              >
                {CATEGORY_INFO[key].icon} {CATEGORY_INFO[key].label}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="reminder-repeat" className="mb-1 block text-xs font-semibold">
            ทำซ้ำ
          </label>
          <select
            id="reminder-repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as Repeat | "")}
            className={fieldClass}
          >
            <option value="">ครั้งเดียว</option>
            {(Object.keys(REPEAT_LABEL) as Repeat[]).map((key) => (
              <option key={key} value={key}>
                {REPEAT_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        {full ? (
          <p className="text-sm text-warn">
            มีเตือนที่รออยู่ครบ {limit} รายการแล้ว ลบอันที่ไม่ใช้หรืออัปเกรดแผนเพื่อตั้งเพิ่มนะ
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
          {busy ? "กำลังบันทึก…" : "บันทึกการเตือน"}
        </button>
      </form>
    </Sheet>
  );
}
