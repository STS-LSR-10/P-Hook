"use client";

import { Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { LoadingBlock } from "@/components/liff/states";
import { currencyUnit, money } from "@/lib/money";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { PlusLock } from "./plus-lock";
import { cardClass, fieldClass, type Me } from "./types";

interface Rule {
  id: string;
  type: "expense" | "income";
  title: string;
  amountSatang: number;
  categoryName: string | null;
  description: string;
  nextRunAt: string;
  isActive: boolean;
}

interface CategoriesResponse {
  items: { id: string; type: "expense" | "income"; name: string }[];
}

const WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

export function RecurringCard({ me, embedded = false }: { me: Me; embedded?: boolean }) {
  const { api } = useLiff();
  const rules = useApi<{ items: Rule[]; limit: number }>("/api/recurring");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = !me.features.recurring;
  const items = rules.data?.items ?? [];

  async function act(run: () => Promise<unknown>, done: string) {
    setNotice(null);
    try {
      await run();
      setNotice(done);
      rules.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
    }
  }

  return (
    <section
      aria-label="รายการประจำ"
      className={embedded ? "space-y-3" : cn(cardClass, "scroll-mt-4")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          {embedded ? null : <h2 className="font-semibold">รายการประจำ</h2>}
          <p className="text-xs text-muted">จดให้อัตโนมัติ เช่น ค่าเน็ต ค่าเช่า เงินเดือน</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={locked}
          className="flex h-11 items-center gap-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-surface disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden /> เพิ่ม
        </button>
      </div>

      {locked ? <PlusLock>ตั้งรายการที่จดซ้ำทุกวัน/สัปดาห์/เดือนให้อัตโนมัติ</PlusLock> : null}

      {rules.loading ? (
        <LoadingBlock rows={1} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">ยังไม่มีรายการประจำ</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((r) => (
            <li
              key={r.id}
              className={cn("flex items-center gap-2 py-3", !r.isActive && "opacity-60")}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.title}</p>
                <p className="truncate text-xs text-muted">
                  {r.description} · {r.categoryName ?? "ไม่ระบุหมวด"}
                  {r.isActive
                    ? ` · ครั้งถัดไป ${formatThaiDate(new Date(r.nextRunAt))}`
                    : " · หยุดอยู่"}
                </p>
              </div>
              <p
                className={cn(
                  "num shrink-0 text-sm font-bold",
                  r.type === "income" ? "text-income" : "text-expense",
                )}
              >
                {r.type === "income" ? "+" : "-"}
                {money(r.amountSatang)}
              </p>
              <button
                type="button"
                aria-label={r.isActive ? `หยุด ${r.title}` : `เริ่มต่อ ${r.title}`}
                disabled={!r.isActive && locked}
                onClick={() =>
                  act(
                    () =>
                      api(`/api/recurring/${r.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ isActive: !r.isActive }),
                      }),
                    r.isActive ? "หยุดแล้ว" : "เริ่มต่อแล้ว",
                  )
                }
                className="flex h-11 w-9 shrink-0 items-center justify-center text-muted disabled:opacity-30"
              >
                {r.isActive ? (
                  <Pause className="h-4 w-4" aria-hidden />
                ) : (
                  <Play className="h-4 w-4" aria-hidden />
                )}
              </button>
              <button
                type="button"
                aria-label={`ลบ ${r.title}`}
                onClick={() => {
                  if (
                    window.confirm(`ลบรายการประจำ "${r.title}" ใช่ไหม? (รายการที่จดไปแล้วไม่หาย)`)
                  ) {
                    void act(() => api(`/api/recurring/${r.id}`, { method: "DELETE" }), "ลบแล้ว");
                  }
                }}
                className="flex h-11 w-9 shrink-0 items-center justify-center text-muted"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}

      {adding ? (
        <AddRuleSheet
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setNotice("เพิ่มรายการประจำแล้ว");
            rules.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function AddRuleSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useLiff();
  const categories = useApi<CategoriesResponse>("/api/categories");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (categories.data?.items ?? []).filter((c) => c.type === type);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!title.trim()) return setError("ใส่ชื่อรายการด้วยนะ");
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("จำนวนเงินไม่ถูกต้อง (เช่น 350 หรือ 350.50)");
    }
    setSaving(true);
    setError(null);
    try {
      await api("/api/recurring", {
        method: "POST",
        body: JSON.stringify({
          type,
          title: title.trim(),
          amount: normalized,
          categoryId: categoryId || null,
          cadence,
          dayOfPeriod: cadence === "weekly" ? weekday : cadence === "monthly" ? monthDay : null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  return (
    <Sheet title="เพิ่มรายการประจำ" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
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
          placeholder="ชื่อรายการ เช่น ค่าเน็ตบ้าน"
          aria-label="ชื่อรายการ"
          className={fieldClass}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={`จำนวนเงิน (${currencyUnit()})`}
          aria-label="จำนวนเงิน"
          className={cn(fieldClass, "num")}
        />

        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as typeof cadence)}
          aria-label="ความถี่"
          className={fieldClass}
        >
          <option value="daily">ทุกวัน</option>
          <option value="weekly">ทุกสัปดาห์</option>
          <option value="monthly">ทุกเดือน</option>
        </select>

        {cadence === "weekly" ? (
          <select
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            aria-label="วันในสัปดาห์"
            className={fieldClass}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                วัน{d}
              </option>
            ))}
          </select>
        ) : null}
        {cadence === "monthly" ? (
          <select
            value={monthDay}
            onChange={(e) => setMonthDay(Number(e.target.value))}
            aria-label="วันที่ของเดือน"
            className={cn(fieldClass, "num")}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                วันที่ {d}
              </option>
            ))}
          </select>
        ) : null}

        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="หมวดหมู่"
          className={fieldClass}
        >
          <option value="">เลือกให้อัตโนมัติ</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {cadence === "monthly" && monthDay > 28 ? (
          <p className="text-xs text-muted">เดือนที่มีวันน้อยกว่านี้ จะจดในวันสุดท้ายของเดือนนะ</p>
        ) : null}

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
    </Sheet>
  );
}
