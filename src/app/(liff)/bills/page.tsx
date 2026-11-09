"use client";

import { ArrowLeft, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass, type Me } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import {
  MAX_BILL_NAME,
  MAX_BILL_NOTE,
  REMIND_DAY_CHOICES,
  dueState,
  todayKey,
  type BillCadence,
  type BillDto,
} from "@/lib/bill";
import { currencyUnit, money, satangToString } from "@/lib/money";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface BillsResponse {
  items: BillDto[];
  limit: number;
  canAdd: boolean;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const CADENCE_LABEL: Record<BillCadence, string> = {
  monthly: t("ทุกเดือน"),
  yearly: t("ทุกปี"),
  once: t("ครั้งเดียว"),
};
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
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const remindLabel = (d: number) => (d === 0 ? t("ในวันนั้น") : t("ก่อน {0} วัน", d));

function dueLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return formatThaiDate(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1, 5)));
}

export default function BillsPage() {
  const { api } = useLiff();
  const bills = useApi<BillsResponse>("/api/bills");
  const me = useApi<Me>("/api/me");
  const [editing, setEditing] = useState<BillDto | "new" | null>(null);
  const [paying, setPaying] = useState<BillDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = me.data ? !me.data.features.billReminder : false;
  const items = bills.data?.items ?? [];
  const today = todayKey(new Date());

  async function remove(b: BillDto) {
    if (!window.confirm(t('ลบบิล "{0}" ใช่ไหม? จะไม่เตือนอีก', b.name))) return;
    setNotice(null);
    try {
      await api(`/api/bills/${b.id}`, { method: "DELETE" });
      setNotice(t("ลบแล้ว"));
      bills.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ลบไม่สำเร็จ"));
    }
  }

  return (
    <main>
      <PageHeader
        title={t("บิลที่ต้องจ่าย")}
        right={
          <Link
            href="/settings"
            aria-label={t("กลับไปตั้งค่า")}
            className="flex h-11 w-11 items-center justify-center text-muted"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        {bills.loading || me.loading ? (
          <LoadingBlock rows={3} />
        ) : bills.error || !bills.data ? (
          <ErrorState message={bills.error ?? t("โหลดไม่สำเร็จ")} onRetry={bills.reload} />
        ) : (
          <>
            {locked ? (
              <div className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                <span className="font-semibold">{t("สำหรับแผน Pro ขึ้นไป")}</span> ·
                {t("บอทเตือนล่วงหน้าก่อนวันครบกำหนดจ่ายบิล")}{" "}
                <Link href="/upgrade" className="font-semibold underline">
                  {t("ดูแผนอัปเกรด")}
                </Link>
              </div>
            ) : null}

            {items.length === 0 ? (
              <EmptyState
                title={t("ยังไม่มีบิลที่ตั้งเตือน")}
                hint={t(
                  'เพิ่มที่ปุ่มด้านล่าง หรือพิมพ์ในแชท เช่น "บิล ใหม่ ค่าไฟ 1250 ทุกวันที่ 15"',
                )}
              />
            ) : (
              <ul className="space-y-3" aria-label={t("รายการบิล")}>
                {items.map((b) => {
                  const state = dueState(b.nextDueOn, today);
                  return (
                    <li key={b.id} className={cardClass}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{b.name}</p>
                          <p className="text-xs text-muted">
                            {CADENCE_LABEL[b.cadence]}
                            {b.fromCard ? t(" · จากวันชำระของบัตร") : ""}
                            {t(
                              " · เตือน {0} เวลา {1}",
                              b.remindDays.map(remindLabel).join(", "),
                              hh(b.remindHour),
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={cn(
                              "text-sm font-bold",
                              state === "overdue"
                                ? "text-expense"
                                : state === "soon"
                                  ? "text-amber-600"
                                  : "",
                            )}
                          >
                            {state === "overdue" ? t("เลยกำหนด ") : ""}
                            {dueLabel(b.nextDueOn)}
                          </p>
                          <p className="num text-xs text-muted">
                            {b.amountSatang ? `${money(b.amountSatang)}` : t("ไม่ระบุยอด")}
                          </p>
                        </div>
                      </div>
                      {b.note ? <p className="truncate text-xs text-muted">{b.note}</p> : null}
                      {b.fromCard ? (
                        <p className="text-xs text-muted">
                          {t("เปลี่ยนวันได้ที่")}{" "}
                          <Link href="/wallets" className="font-semibold text-primary underline">
                            {t("กระเป๋าเงิน")}
                          </Link>
                        </p>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setPaying(b)}
                            disabled={locked}
                            aria-label={t("จ่ายแล้ว {0}", b.name)}
                            className="flex h-11 flex-1 items-center justify-center gap-1 rounded-2xl border border-border text-sm font-semibold disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden /> {t("จ่ายแล้ว")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(b)}
                            disabled={locked}
                            aria-label={t("แก้ไข {0}", b.name)}
                            className="flex h-11 w-11 items-center justify-center text-muted disabled:opacity-40"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(b)}
                            aria-label={t("ลบ {0}", b.name)}
                            className="flex h-11 w-11 items-center justify-center text-muted"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
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

            {!locked ? (
              bills.data.canAdd ? (
                <button
                  type="button"
                  onClick={() => setEditing("new")}
                  className="flex h-12 w-full items-center justify-center gap-1 rounded-2xl bg-primary text-base font-semibold text-surface"
                >
                  <Plus className="h-5 w-5" aria-hidden /> {t("เพิ่มบิล")}
                </button>
              ) : (
                <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                  {t("มีบิลได้")} {bills.data.limit} {t("รายการแล้ว ลบอันที่ไม่ใช้ก่อนนะ")}
                </p>
              )
            ) : null}
          </>
        )}
      </div>

      {editing ? (
        <BillSheet
          bill={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            bills.reload();
          }}
        />
      ) : null}
      {paying ? (
        <PaySheet
          bill={paying}
          onClose={() => setPaying(null)}
          onDone={(msg) => {
            setPaying(null);
            setNotice(msg);
            bills.reload();
          }}
        />
      ) : null}
    </main>
  );
}

function BillSheet({
  bill,
  onClose,
  onSaved,
}: {
  bill: BillDto | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState(bill?.name ?? "");
  const [amount, setAmount] = useState(bill?.amountSatang ? satangToString(bill.amountSatang) : "");
  const [cadence, setCadence] = useState<BillCadence>(bill?.cadence ?? "monthly");
  const [day, setDay] = useState(bill?.dayOfMonth ?? 1);
  const [month, setMonth] = useState(bill?.monthOfYear ?? 1);
  const [remindDays, setRemindDays] = useState<number[]>(bill?.remindDays ?? [1]);
  const [hour, setHour] = useState(bill?.remindHour ?? 9);
  const [note, setNote] = useState(bill?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(d: number) {
    setRemindDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!name.trim()) return setError(t("ตั้งชื่อบิลด้วยนะ"));
    if (normalized && !AMOUNT_PATTERN.test(normalized)) {
      return setError(t("จำนวนเงินไม่ถูกต้อง (เช่น 1250)"));
    }
    if (remindDays.length === 0) return setError(t("เลือกวันที่จะให้เตือนอย่างน้อย 1 ข้อ"));
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        amount: normalized || null,
        cadence,
        dayOfMonth: day,
        monthOfYear: cadence === "monthly" ? null : month,
        remindDays,
        remindHour: hour,
        note: note.trim() || null,
      });
      if (bill) await api(`/api/bills/${bill.id}`, { method: "PATCH", body });
      else await api("/api/bills", { method: "POST", body });
      onSaved(bill ? t("บันทึกแล้ว") : t("เพิ่มบิลแล้ว"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("บันทึกไม่สำเร็จ"));
      setSaving(false);
    }
  }

  return (
    <Sheet title={bill ? t("แก้ไขบิล") : t("เพิ่มบิล")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_BILL_NAME}
          placeholder={t("ชื่อบิล เช่น ค่าไฟ")}
          aria-label={t("ชื่อบิล")}
          className={fieldClass}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={t("ยอดโดยประมาณ ({0} ไม่บังคับ)", currencyUnit())}
          aria-label={t("ยอดโดยประมาณ")}
          className={cn(fieldClass, "num")}
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as BillCadence)}
          aria-label={t("ความถี่")}
          className={fieldClass}
        >
          <option value="monthly">{t("ทุกเดือน")}</option>
          <option value="yearly">{t("ทุกปี")}</option>
          <option value="once">{t("ครั้งเดียว")}</option>
        </select>
        {cadence !== "monthly" ? (
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            aria-label={t("เดือนที่ครบกำหนด")}
            className={fieldClass}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        ) : null}
        <select
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          aria-label={t("วันที่ครบกำหนด")}
          className={cn(fieldClass, "num")}
        >
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {t("วันที่")} {d}
            </option>
          ))}
        </select>
        {day > 28 ? (
          <p className="text-xs text-muted">
            {t("เดือนที่มีวันน้อยกว่านี้ จะเตือนตามวันสุดท้ายของเดือนนะ")}
          </p>
        ) : null}

        <fieldset>
          <legend className="text-sm font-semibold">{t("เตือนล่วงหน้า")}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {REMIND_DAY_CHOICES.map((d) => (
              <label
                key={d}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 rounded-2xl border px-3 text-sm",
                  remindDays.includes(d)
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted",
                )}
              >
                <input
                  type="checkbox"
                  checked={remindDays.includes(d)}
                  onChange={() => toggle(d)}
                  className="h-4 w-4"
                />
                {remindLabel(d)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm text-muted">
          {t("เวลาที่ให้เตือน")}
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            aria-label={t("เวลาที่ให้เตือน")}
            className={cn(fieldClass, "num mt-1")}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hh(h)} {t("น.")}
              </option>
            ))}
          </select>
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_BILL_NOTE}
          placeholder={t("โน้ต (ไม่บังคับ)")}
          aria-label={t("โน้ต")}
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
          {saving ? t("กำลังบันทึก...") : t("บันทึก")}
        </button>
      </form>
    </Sheet>
  );
}

function PaySheet({
  bill,
  onClose,
  onDone,
}: {
  bill: BillDto;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api } = useLiff();
  const [record, setRecord] = useState(Boolean(bill.amountSatang));
  const [amount, setAmount] = useState(bill.amountSatang ? satangToString(bill.amountSatang) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(skip: boolean) {
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!skip && record && !AMOUNT_PATTERN.test(normalized)) {
      return setError(t("ใส่จำนวนเงินที่จะจดให้ถูกต้อง (เช่น 1250)"));
    }
    setBusy(true);
    setError(null);
    try {
      await api<{ nextDueOn: string | null }>(`/api/bills/${bill.id}/pay`, {
        method: "POST",
        body: JSON.stringify(skip || !record ? {} : { record: true, amount: normalized }),
      });
      onDone(
        skip ? t("ข้ามรอบนี้แล้ว") : record ? t("จ่ายแล้วและจดรายจ่ายให้แล้ว") : t("จ่ายแล้ว"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("บันทึกไม่สำเร็จ"));
      setBusy(false);
    }
  }

  return (
    <Sheet title={t("จ่าย {0}", bill.name)} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {t("ครบกำหนด")} {dueLabel(bill.nextDueOn)}
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={record}
            onChange={(e) => setRecord(e.target.checked)}
            className="h-4 w-4"
          />
          {t("จดเป็นรายจ่ายด้วย")}
        </label>
        {record ? (
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={t("จำนวนเงิน ({0})", currencyUnit())}
            aria-label={t("จำนวนเงินที่จ่าย")}
            className={cn(fieldClass, "num")}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(false)}
          className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
        >
          {busy ? t("กำลังบันทึก...") : t("จ่ายแล้ว")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(true)}
          className="h-11 w-full rounded-2xl border border-border text-sm font-semibold disabled:opacity-60"
        >
          {t("ข้ามรอบนี้ (ไม่จด)")}
        </button>
      </div>
    </Sheet>
  );
}
