"use client";

import { ArrowLeft, Banknote, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass, fieldClass, type Me } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { MAX_DEBT_NOTE, MAX_PERSON, dueState, type DebtDirection, type DebtDto } from "@/lib/debt";
import { currencyUnit, money, satangToString } from "@/lib/money";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import { formatThaiDate, fromBangkokInputValue, toBangkokInputValue } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { WALLET_KIND_EMOJI, type WalletKind } from "@/lib/wallet";

interface DebtsResponse {
  items: DebtDto[];
  lentSatang: number;
  borrowedSatang: number;
}
interface WalletsLite {
  items: { id: string; name: string; kind: WalletKind; isDefault: boolean; shared?: boolean }[];
}
interface PaymentItem {
  id: string;
  amountSatang: number;
  paidAt: string;
  note: string | null;
}

const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export default function DebtsPage() {
  const { api } = useLiff();
  const debts = useApi<DebtsResponse>("/api/debts");
  const wallets = useApi<WalletsLite>("/api/wallets");
  const me = useApi<Me>("/api/me");
  const [editing, setEditing] = useState<DebtDto | "new" | null>(null);
  const [paying, setPaying] = useState<DebtDto | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = me.data ? !me.data.features.debts : false;
  const items = debts.data?.items ?? [];
  const open = items.filter((d) => d.remainingSatang > 0);
  const settled = items.filter((d) => d.remainingSatang <= 0);

  function reloadAll() {
    debts.reload();
    wallets.reload();
  }

  async function remove(d: DebtDto) {
    if (
      !window.confirm(
        `ลบหนี้ของ "${d.person}" ใช่ไหม? ยอดกระเป๋าจะกลับเป็นเหมือนไม่เคยมีหนี้ก้อนนี้`,
      )
    ) {
      return;
    }
    setNotice(null);
    try {
      await api(`/api/debts/${d.id}`, { method: "DELETE" });
      setNotice("ลบแล้ว");
      reloadAll();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    }
  }

  const list = (direction: DebtDirection, title: string, total: number, tone: string) => {
    const rows = open.filter((d) => d.direction === direction);
    if (rows.length === 0) return null;
    return (
      <section className={cardClass} aria-label={title}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <p className={cn("num font-bold", tone)}>{money(total)}</p>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((d) => (
            <DebtRow
              key={d.id}
              debt={d}
              locked={locked}
              onPay={() => setPaying(d)}
              onEdit={() => setEditing(d)}
              onDelete={() => void remove(d)}
            />
          ))}
        </ul>
      </section>
    );
  };

  return (
    <main>
      <PageHeader
        title="หนี้สิน"
        right={
          <Link
            href="/wallets"
            aria-label="กลับไปกระเป๋าเงิน"
            className="flex h-11 w-11 items-center justify-center text-muted"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        {debts.loading || me.loading ? (
          <LoadingBlock rows={3} />
        ) : debts.error || !debts.data ? (
          <ErrorState message={debts.error ?? "โหลดไม่สำเร็จ"} onRetry={debts.reload} />
        ) : (
          <>
            {locked ? (
              <div className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                <span className="font-semibold">สำหรับแผน Elite</span> · จดให้ยืม/ยืม
                และตัดยอดกระเป๋าให้อัตโนมัติ{" "}
                <Link href="/upgrade" className="font-semibold underline">
                  ดูแผนอัปเกรด
                </Link>
              </div>
            ) : null}

            <section className={cn(cardClass, "grid grid-cols-2 gap-3")} aria-label="สรุปหนี้">
              <div>
                <p className="text-xs text-muted">คนที่ติดเรา</p>
                <p className="num text-lg font-bold text-income">{money(debts.data.lentSatang)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">เราติดใคร</p>
                <p className="num text-lg font-bold text-expense">
                  {money(debts.data.borrowedSatang)}
                </p>
              </div>
              <p className="col-span-2 text-xs text-muted">
                ไม่นับเป็นรายรับ/รายจ่าย · ให้ยืมหรือยืมแล้วยอดกระเป๋าเปลี่ยนทันที
              </p>
            </section>

            {open.length === 0 ? (
              <EmptyState
                title="ยังไม่มีหนี้ค้าง"
                hint='เพิ่มที่ปุ่มด้านล่าง หรือพิมพ์ในแชท เช่น "ให้ยืม สมชาย 500"'
              />
            ) : (
              <>
                {list("lent", "คนที่ติดเรา", debts.data.lentSatang, "text-income")}
                {list("borrowed", "เราติดใคร", debts.data.borrowedSatang, "text-expense")}
              </>
            )}

            {settled.length > 0 ? (
              <section className={cardClass} aria-label="หนี้ที่ปิดแล้ว">
                <button
                  type="button"
                  onClick={() => setShowSettled((v) => !v)}
                  aria-expanded={showSettled}
                  className="flex h-11 w-full items-center justify-between text-sm font-semibold"
                >
                  <span>ปิดแล้ว ({settled.length})</span>
                  <span className="text-muted">{showSettled ? "ซ่อน" : "แสดง"}</span>
                </button>
                {showSettled ? (
                  <ul className="divide-y divide-border">
                    {settled.map((d) => (
                      <DebtRow
                        key={d.id}
                        debt={d}
                        locked={locked}
                        onPay={() => setPaying(d)}
                        onEdit={() => setEditing(d)}
                        onDelete={() => void remove(d)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {notice ? (
              <p
                role="status"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                {notice}
              </p>
            ) : null}

            <button
              type="button"
              disabled={locked}
              onClick={() => setEditing("new")}
              className="flex h-12 w-full items-center justify-center gap-1 rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-40"
            >
              <Plus className="h-5 w-5" aria-hidden /> เพิ่มหนี้
            </button>
          </>
        )}
      </div>

      {editing ? (
        <DebtSheet
          debt={editing === "new" ? null : editing}
          wallets={(wallets.data?.items ?? []).filter((w) => !w.shared)}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            reloadAll();
          }}
        />
      ) : null}
      {paying ? (
        <PaySheet
          debt={paying}
          wallets={(wallets.data?.items ?? []).filter((w) => !w.shared)}
          locked={locked}
          onClose={() => setPaying(null)}
          onChanged={(msg) => {
            setPaying(null);
            setNotice(msg);
            reloadAll();
          }}
        />
      ) : null}
    </main>
  );
}

function DebtRow({
  debt,
  locked,
  onPay,
  onEdit,
  onDelete,
}: {
  debt: DebtDto;
  locked: boolean;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const state = debt.remainingSatang > 0 ? dueState(debt.dueAt, new Date()) : "none";
  return (
    <li className="space-y-1 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{debt.person}</p>
          <p className="text-xs text-muted">
            ทั้งหมด {money(debt.amountSatang)} · ชำระแล้ว {money(debt.paidSatang)} ·{" "}
            {debt.accountName}
          </p>
          {debt.dueAt ? (
            <p
              className={cn(
                "text-xs",
                state === "overdue" ? "font-semibold text-expense" : "text-muted",
              )}
            >
              {state === "overdue" ? "เลยกำหนด " : "กำหนดคืน "}
              {formatThaiDate(new Date(debt.dueAt))}
            </p>
          ) : null}
          {debt.note ? <p className="truncate text-xs text-muted">{debt.note}</p> : null}
        </div>
        <p
          className={cn(
            "num shrink-0 text-base font-bold",
            debt.remainingSatang > 0 ? "" : "text-muted",
          )}
        >
          {debt.remainingSatang > 0 ? money(debt.remainingSatang) : "ครบแล้ว"}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPay}
          disabled={locked && debt.remainingSatang > 0}
          aria-label={`${debt.remainingSatang > 0 ? (debt.direction === "lent" ? "รับคืน" : "คืนเงิน") : "ดูการชำระ"} ${debt.person}`}
          className="flex h-11 flex-1 items-center justify-center gap-1 rounded-2xl border border-border text-sm font-semibold disabled:opacity-40"
        >
          <Banknote className="h-4 w-4" aria-hidden />
          {debt.remainingSatang > 0
            ? debt.direction === "lent"
              ? "รับคืน"
              : "คืนเงิน"
            : "ประวัติ"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={locked}
          aria-label={`แก้ไข ${debt.person}`}
          className="flex h-11 w-11 items-center justify-center text-muted disabled:opacity-40"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`ลบ ${debt.person}`}
          className="flex h-11 w-11 items-center justify-center text-muted"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

function WalletOptions({ wallets }: { wallets: WalletsLite["items"] }) {
  return (
    <>
      {wallets.map((w) => (
        <option key={w.id} value={w.id}>
          {WALLET_KIND_EMOJI[w.kind]} {w.name}
        </option>
      ))}
    </>
  );
}

function DebtSheet({
  debt,
  wallets,
  onClose,
  onSaved,
}: {
  debt: DebtDto | null;
  wallets: WalletsLite["items"];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { api } = useLiff();
  const mainId = wallets.find((w) => w.isDefault)?.id ?? "";
  const [direction, setDirection] = useState<DebtDirection>(debt?.direction ?? "lent");
  const [person, setPerson] = useState(debt?.person ?? "");
  const [amount, setAmount] = useState(debt ? satangToString(debt.amountSatang) : "");
  const [walletId, setWalletId] = useState(debt?.accountId ?? mainId);
  const [due, setDue] = useState(
    debt?.dueAt ? toBangkokInputValue(new Date(debt.dueAt)).slice(0, 10) : "",
  );
  const [note, setNote] = useState(debt?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!person.trim()) return setError("ใส่ชื่อคนด้วยนะ");
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("จำนวนเงินไม่ถูกต้อง (เช่น 500 หรือ 500.50)");
    }
    const dueAt = due ? fromBangkokInputValue(`${due}T12:00`) : null;
    if (due && !dueAt) return setError("วันครบกำหนดไม่ถูกต้อง");
    setSaving(true);
    setError(null);
    try {
      const body = {
        person: person.trim(),
        amount: normalized,
        accountId: walletId || null,
        dueAt: dueAt ? dueAt.toISOString() : null,
        note: note.trim() || null,
      };
      if (debt) {
        await api(`/api/debts/${debt.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, accountId: walletId || undefined }),
        });
      } else {
        await api("/api/debts", { method: "POST", body: JSON.stringify({ ...body, direction }) });
      }
      onSaved(debt ? "บันทึกแล้ว" : "เพิ่มหนี้แล้ว");
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  return (
    <Sheet title={debt ? "แก้ไขหนี้" : "เพิ่มหนี้"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {debt ? null : (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ประเภทหนี้">
            {(["lent", "borrowed"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={cn(
                  "h-11 rounded-2xl border text-sm font-semibold",
                  direction === d
                    ? d === "lent"
                      ? "border-income bg-income/10 text-income"
                      : "border-expense bg-expense/10 text-expense"
                    : "border-border text-muted",
                )}
              >
                {d === "lent" ? "ให้ยืม" : "ยืมมา"}
              </button>
            ))}
          </div>
        )}
        <input
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          maxLength={MAX_PERSON}
          placeholder="ชื่อคน เช่น สมชาย"
          aria-label="ชื่อคน"
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
          value={walletId}
          onChange={(e) => setWalletId(e.target.value)}
          aria-label="กระเป๋า"
          className={fieldClass}
        >
          <WalletOptions wallets={wallets} />
        </select>
        <label className="block text-sm text-muted">
          วันครบกำหนด (ไม่บังคับ)
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="วันครบกำหนด"
            className={cn(fieldClass, "mt-1")}
          />
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_DEBT_NOTE}
          placeholder="โน้ต (ไม่บังคับ)"
          aria-label="โน้ต"
          className={fieldClass}
        />
        <p className="text-xs text-muted">
          {direction === "lent"
            ? "ให้ยืม: เงินออกจากกระเป๋าที่เลือกทันที"
            : "ยืมมา: เงินเข้ากระเป๋าที่เลือกทันที"}
        </p>
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

function PaySheet({
  debt,
  wallets,
  locked,
  onClose,
  onChanged,
}: {
  debt: DebtDto;
  wallets: WalletsLite["items"];
  locked: boolean;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { api } = useLiff();
  const payments = useApi<{ items: PaymentItem[] }>(`/api/debts/${debt.id}/payments`);
  const [amount, setAmount] = useState(
    debt.remainingSatang > 0 ? satangToString(debt.remainingSatang) : "",
  );
  const [walletId, setWalletId] = useState(
    debt.accountId ?? wallets.find((w) => w.isDefault)?.id ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const incoming = debt.direction === "lent";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (!AMOUNT_PATTERN.test(normalized) || Number(normalized) <= 0) {
      return setError("จำนวนเงินไม่ถูกต้อง (เช่น 200 หรือ 200.50)");
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/api/debts/${debt.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: normalized, accountId: walletId || null }),
      });
      onChanged(incoming ? "บันทึกรับคืนแล้ว" : "บันทึกการคืนเงินแล้ว");
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      setSaving(false);
    }
  }

  async function cancel(p: PaymentItem) {
    if (!window.confirm("ยกเลิกรายการชำระนี้ใช่ไหม? ยอดหนี้และกระเป๋าจะกลับเป็นเหมือนเดิม")) return;
    try {
      await api(`/api/debts/${debt.id}/payments/${p.id}`, { method: "DELETE" });
      onChanged("ยกเลิกรายการชำระแล้ว");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยกเลิกไม่สำเร็จ");
    }
  }

  return (
    <Sheet title={`${incoming ? "รับคืนจาก" : "คืนเงิน"} ${debt.person}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          เหลือ{" "}
          <span className="num font-semibold text-foreground">{money(debt.remainingSatang)}</span>{" "}
          จาก {money(debt.amountSatang)}
        </p>
        {debt.remainingSatang > 0 && !locked ? (
          <form onSubmit={submit} className="space-y-3">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={`จำนวนเงิน (${currencyUnit()})`}
              aria-label="จำนวนเงินที่ชำระ"
              className={cn(fieldClass, "num")}
            />
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              aria-label={incoming ? "รับเข้ากระเป๋า" : "จ่ายจากกระเป๋า"}
              className={fieldClass}
            >
              <WalletOptions wallets={wallets} />
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
              {saving ? "กำลังบันทึก..." : incoming ? "บันทึกรับคืน" : "บันทึกการคืนเงิน"}
            </button>
          </form>
        ) : null}

        <h3 className="pt-1 text-sm font-semibold">ประวัติการชำระ</h3>
        {payments.loading ? (
          <LoadingBlock rows={1} />
        ) : (payments.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">ยังไม่มีการชำระ</p>
        ) : (
          <ul className="divide-y divide-border">
            {payments.data?.items.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="num text-sm font-semibold">{money(p.amountSatang)}</p>
                  <p className="text-xs text-muted">{formatThaiDate(new Date(p.paidAt))}</p>
                </div>
                <button
                  type="button"
                  aria-label={`ยกเลิกการชำระ ${money(p.amountSatang)}`}
                  onClick={() => void cancel(p)}
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
