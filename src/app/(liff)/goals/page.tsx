"use client";

import { ArrowLeft, PiggyBank, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { GoalChart } from "@/components/liff/lazy-charts";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass, type Me } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { EMOJI_CHOICES } from "@/lib/category-emoji";
import { MAX_GOAL_NAME, MAX_GOAL_NOTE, cumulative, type GoalDto } from "@/lib/goal";
import { money, satangToString } from "@/lib/money";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { formatThaiDate, formatThaiDayMonth } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

interface GoalsResponse {
  items: GoalDto[];
  limit: number;
  canAdd: boolean;
}
interface DepositItem {
  id: string;
  amountSatang: number;
  occurredAt: string;
  note: string | null;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

function dueLabel(dueOn: string): string {
  const [y, m, d] = dueOn.split("-").map(Number);
  return formatThaiDate(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 5)));
}

export default function GoalsPage() {
  const { api } = useLiff();
  const goals = useApi<GoalsResponse>("/api/goals");
  const me = useApi<Me>("/api/me");
  const [editing, setEditing] = useState<GoalDto | "new" | null>(null);
  const [depositing, setDepositing] = useState<GoalDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = me.data ? !me.data.features.savingsGoal : false;
  const items = (goals.data?.items ?? []).filter((g) => !g.archived);

  async function remove(g: GoalDto) {
    const extra = g.savedSatang > 0 ? ` ยอดที่ออมไว้ ${money(g.savedSatang)} จะหายไปด้วย` : "";
    if (!window.confirm(`ลบเป้าหมาย "${g.name}" ใช่ไหม?${extra}`)) return;
    setNotice(null);
    try {
      await api(`/api/goals/${g.id}`, { method: "DELETE" });
      setNotice("ลบแล้ว");
      goals.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  return (
    <main>
      <PageHeader
        title="เป้าหมายการออม"
        right={
          <Link
            href="/settings"
            aria-label="กลับไปตั้งค่า"
            className="flex h-11 w-11 items-center justify-center text-muted"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        {goals.loading || me.loading ? (
          <LoadingBlock rows={3} />
        ) : goals.error || !goals.data ? (
          <ErrorState message={goals.error ?? "โหลดไม่สำเร็จ"} onRetry={goals.reload} />
        ) : (
          <>
            {locked ? (
              <div className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                <span className="font-semibold">สำหรับแผน Pro</span> · สร้างกระปุกออมสิน
                ตั้งเป้าและดูความคืบหน้า{" "}
                <Link href="/upgrade" className="font-semibold underline">
                  ดูแผนอัปเกรด
                </Link>
              </div>
            ) : null}

            {items.length === 0 ? (
              <EmptyState
                title="ยังไม่มีเป้าหมายการออม"
                hint='เพิ่มที่ปุ่มด้านล่าง หรือพิมพ์ในแชท เช่น "เป้าหมาย ใหม่ เที่ยวญี่ปุ่น 30000"'
              />
            ) : (
              <ul className="space-y-3" aria-label="เป้าหมายการออม">
                {items.map((g) => (
                  <li key={g.id} className={cardClass}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {g.emoji ? `${g.emoji} ` : ""}
                          {g.name}
                        </p>
                        <p className="text-xs text-muted">
                          {money(g.savedSatang)} จาก {money(g.targetSatang)}
                        </p>
                      </div>
                      <p
                        className={cn(
                          "num shrink-0 text-lg font-bold",
                          g.done ? "text-income" : "text-primary",
                        )}
                      >
                        {g.done ? "ครบแล้ว 🎉" : `${g.percent}%`}
                      </p>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`ความคืบหน้า ${g.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, g.percent)}
                      aria-valuetext={`ออมแล้ว ${g.percent}%`}
                      className="h-2.5 overflow-hidden rounded-full bg-border"
                    >
                      <div
                        className={cn("h-full rounded-full", g.done ? "bg-income" : "bg-primary")}
                        style={{
                          width: `${Math.min(100, Math.max(g.percent > 0 ? 3 : 0, g.percent))}%`,
                        }}
                      />
                    </div>
                    {!g.done ? (
                      <p className="text-xs text-muted">เหลืออีก {money(g.remainingSatang)}</p>
                    ) : null}
                    {g.dueOn && !g.done ? (
                      <p
                        className={cn(
                          "text-xs",
                          g.overdue ? "font-semibold text-expense" : "text-muted",
                        )}
                      >
                        {g.overdue
                          ? `เลยกำหนด ${dueLabel(g.dueOn)} แล้ว`
                          : `ภายใน ${dueLabel(g.dueOn)}${
                              g.monthlyNeededSatang !== null
                                ? ` · เก็บเดือนละ ${money(g.monthlyNeededSatang)}`
                                : ""
                            }`}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDepositing(g)}
                        aria-label={`หยอดกระปุก ${g.name}`}
                        className="flex h-11 flex-1 items-center justify-center gap-1 rounded-2xl border border-border text-sm font-semibold"
                      >
                        <PiggyBank className="h-4 w-4" aria-hidden /> หยอด / ถอน / กราฟ
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(g)}
                        disabled={locked}
                        aria-label={`แก้ไข ${g.name}`}
                        className="flex h-11 w-11 items-center justify-center text-muted disabled:opacity-40"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(g)}
                        aria-label={`ลบ ${g.name}`}
                        className="flex h-11 w-11 items-center justify-center text-muted"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {notice ? (
              <p
                role="status"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                {notice}
              </p>
            ) : null}

            {goals.data.canAdd && !locked ? (
              <button
                type="button"
                onClick={() => setEditing("new")}
                className="flex h-12 w-full items-center justify-center gap-1 rounded-2xl bg-primary text-base font-semibold text-surface"
              >
                <Plus className="h-5 w-5" aria-hidden /> เพิ่มเป้าหมาย
              </button>
            ) : locked ? null : (
              <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                มีเป้าหมายได้ {goals.data.limit} ใบแล้ว{" "}
                <Link href="/upgrade" className="font-semibold underline">
                  ดูแผนอัปเกรด
                </Link>{" "}
                (Elite มีได้ 20 ใบ)
              </p>
            )}
          </>
        )}
      </div>

      {editing ? (
        <GoalSheet
          goal={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            goals.reload();
          }}
        />
      ) : null}
      {depositing ? (
        <DepositSheet
          goal={depositing}
          locked={locked}
          onClose={() => setDepositing(null)}
          onChanged={(msg) => {
            setDepositing(null);
            setNotice(msg);
            goals.reload();
          }}
        />
      ) : null}
    </main>
  );
}

function GoalSheet({
  goal,
  onClose,
  onSaved,
}: {
  goal: GoalDto | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState(goal?.name ?? "");
  const [emoji, setEmoji] = useState(goal?.emoji ?? "");
  const [target, setTarget] = useState(goal ? satangToString(goal.targetSatang) : "");
  const [due, setDue] = useState(goal?.dueOn ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(target).replace(/,/g, "").trim();
    if (!name.trim()) return setError("ตั้งชื่อเป้าหมายด้วยนะ");
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("ยอดเป้าหมายไม่ถูกต้อง (เช่น 30000)");
    }
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        emoji: emoji || null,
        target: normalized,
        dueOn: due || null,
      });
      if (goal) await api(`/api/goals/${goal.id}`, { method: "PATCH", body });
      else await api("/api/goals", { method: "POST", body });
      onSaved(goal ? "บันทึกแล้ว" : "เพิ่มเป้าหมายแล้ว");
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  return (
    <Sheet title={goal ? "แก้ไขเป้าหมาย" : "เพิ่มเป้าหมาย"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_GOAL_NAME}
          placeholder="ชื่อเป้าหมาย เช่น เที่ยวญี่ปุ่น"
          aria-label="ชื่อเป้าหมาย"
          className={fieldClass}
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          inputMode="decimal"
          placeholder="ยอดเป้าหมาย (บาท)"
          aria-label="ยอดเป้าหมาย"
          className={cn(fieldClass, "num")}
        />
        <label className="block text-sm text-muted">
          อยากได้ภายในวันที่ (ไม่บังคับ)
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="วันที่อยากได้"
            className={cn(fieldClass, "mt-1")}
          />
        </label>
        <div>
          <p className="text-sm font-semibold">อีโมจิ (ไม่บังคับ)</p>
          <div className="mt-1 grid grid-cols-8 gap-1" role="radiogroup" aria-label="เลือกอีโมจิ">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={emoji === e}
                aria-label={`อีโมจิ ${e}`}
                onClick={() => setEmoji(emoji === e ? "" : e)}
                className={cn(
                  "flex h-10 items-center justify-center rounded-xl border text-xl",
                  emoji === e ? "border-primary bg-primary-soft" : "border-transparent",
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
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

function DepositSheet({
  goal,
  locked,
  onClose,
  onChanged,
}: {
  goal: GoalDto;
  locked: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { api } = useLiff();
  const deposits = useApi<{ items: DepositItem[] }>(`/api/goals/${goal.id}/deposits`);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = deposits.data?.items ?? [];
  const points = cumulative(history).map((p) => ({
    label: formatThaiDayMonth(new Date(p.at)),
    total: p.totalSatang / 100,
  }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("จำนวนเงินไม่ถูกต้อง (เช่น 2000 หรือ 2000.50)");
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ reachedTarget: boolean }>(`/api/goals/${goal.id}/deposits`, {
        method: "POST",
        body: JSON.stringify({ amount: normalized, direction, note: note.trim() || null }),
      });
      onChanged(
        res.reachedTarget ? "🎉 ถึงเป้าแล้ว!" : direction === "in" ? "หยอดกระปุกแล้ว" : "ถอนแล้ว",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  async function undo(d: DepositItem) {
    if (!window.confirm("ยกเลิกรายการนี้ใช่ไหม?")) return;
    try {
      await api(`/api/goals/${goal.id}/deposits/${d.id}`, { method: "DELETE" });
      onChanged("ยกเลิกรายการแล้ว");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    }
  }

  return (
    <Sheet title={`${goal.emoji ? `${goal.emoji} ` : ""}${goal.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          ออมแล้ว{" "}
          <span className="num font-semibold text-foreground">{money(goal.savedSatang)}</span> จาก{" "}
          {money(goal.targetSatang)} ({goal.percent}%)
        </p>
        {points.length > 0 ? <GoalChart points={points} target={goal.targetSatang / 100} /> : null}

        {locked ? null : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="หยอดหรือถอน">
              {(["in", "out"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={direction === d}
                  onClick={() => setDirection(d)}
                  className={cn(
                    "h-11 rounded-2xl border text-sm font-semibold",
                    direction === d
                      ? d === "in"
                        ? "border-income bg-income/10 text-income"
                        : "border-expense bg-expense/10 text-expense"
                      : "border-border text-muted",
                  )}
                >
                  {d === "in" ? "หยอดกระปุก" : "ถอนออก"}
                </button>
              ))}
            </div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="จำนวนเงิน (บาท)"
              aria-label="จำนวนเงิน"
              className={cn(fieldClass, "num")}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={MAX_GOAL_NOTE}
              placeholder="โน้ต (ไม่บังคับ)"
              aria-label="โน้ต"
              className={fieldClass}
            />
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
        )}

        <h3 className="pt-1 text-sm font-semibold">ประวัติ</h3>
        {deposits.loading ? (
          <LoadingBlock rows={1} />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">ยังไม่มีการหยอดกระปุก</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.slice(0, 20).map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "num text-sm font-semibold",
                      d.amountSatang >= 0 ? "text-income" : "text-expense",
                    )}
                  >
                    {d.amountSatang >= 0 ? "+" : "-"}
                    {money(Math.abs(d.amountSatang))}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatThaiDate(new Date(d.occurredAt))}
                    {d.note ? ` · ${d.note}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`ยกเลิกรายการ ${money(Math.abs(d.amountSatang))}`}
                  onClick={() => void undo(d)}
                  className="flex h-11 w-11 items-center justify-center text-muted"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
