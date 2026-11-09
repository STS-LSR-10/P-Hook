"use client";

import { ArrowLeft, ArrowRightLeft, Banknote, Pencil, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { Sheet } from "@/components/liff/sheet";
import { PlusLock } from "@/components/liff/settings/plus-lock";
import { cardClass, fieldClass, type Me } from "@/components/liff/settings/types";
import { ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { currencyUnit, money } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import { MAX_TRANSFER_NOTE, type TransferDto } from "@/lib/transfer";
import { normalizeThaiDigits } from "@/lib/parse/thai-number";
import {
  MAX_WALLET_NAME,
  WALLET_KINDS,
  WALLET_KIND_EMOJI,
  WALLET_KIND_LABEL,
  type WalletKind,
} from "@/lib/wallet";
import { cn } from "@/lib/utils";
import { t as tr } from "@/lib/i18n";

interface WalletItem {
  id: string;
  name: string;
  kind: WalletKind;
  isDefault: boolean;
  openingSatang: number;
  balanceSatang: number;
  entryCount: number;
  creditLimitSatang: number | null;
  statementDay: number | null;
  dueDay: number | null;
  /** A wallet shared with other people; `members` lists them. */
  shared?: boolean;
  isOwner?: boolean;
  memberCount?: number;
  members?: { userId: string; name: string; role: "owner" | "member" }[];
  card: {
    owedSatang: number;
    limitSatang: number | null;
    availableSatang: number | null;
    usedPercent: number | null;
    cycleSpentSatang: number;
    previousCycleSpentSatang: number;
    nextStatement: string | null;
    nextDue: string | null;
  } | null;
}

interface WalletsResponse {
  items: WalletItem[];
  totalSatang: number;
  limit: number;
  canAdd: boolean;
  /** The plan allows starting a shared wallet. */
  canAddShared?: boolean;
  viewerId?: string;
}

const BALANCE_PATTERN = /^-?\d{1,10}(\.\d{1,2})?$/;

export default function WalletsPage() {
  const { api } = useLiff();
  const wallets = useApi<WalletsResponse>("/api/wallets");
  const me = useApi<Me>("/api/me");
  const transfers = useApi<{ items: TransferDto[] }>("/api/transfers");
  const [transferring, setTransferring] = useState(false);
  const [editing, setEditing] = useState<WalletItem | "new" | null>(null);
  const [inviting, setInviting] = useState<WalletItem | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const items = wallets.data?.items ?? [];
  // transfers move money between private wallets (a shared wallet takes income and expenses)
  const privateItems = items.filter((w) => !w.shared);

  async function join() {
    const code = normalizeThaiDigits(joinCode).trim();
    if (!/^\d{6}$/.test(code)) return setNotice(tr("รหัสต้องเป็นตัวเลข 6 หลักนะ"));
    await act(async () => {
      await api("/api/wallets/join", { method: "POST", body: JSON.stringify({ code }) });
      setJoinCode("");
    }, tr("ร่วมกระเป๋าแล้ว"));
  }

  async function act(run: () => Promise<unknown>, done: string) {
    setNotice(null);
    try {
      await run();
      setNotice(done);
      wallets.reload();
      transfers.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : tr("ทำรายการไม่สำเร็จ"));
    }
  }

  return (
    <main>
      <PageHeader
        title={tr("กระเป๋าเงิน")}
        right={
          <Link
            href="/settings"
            aria-label={tr("กลับไปตั้งค่า")}
            className="flex h-11 w-11 items-center justify-center text-muted"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
        }
      />
      <div className="space-y-4 px-4 pb-4">
        {wallets.loading ? (
          <LoadingBlock rows={3} />
        ) : wallets.error || !wallets.data ? (
          <ErrorState message={wallets.error ?? tr("โหลดไม่สำเร็จ")} onRetry={wallets.reload} />
        ) : (
          <>
            <section className={cardClass} aria-label={tr("ยอดรวม")}>
              <p className="text-sm text-muted">{tr("รวมทุกกระเป๋า")}</p>
              <p
                className={cn(
                  "num text-2xl font-bold",
                  wallets.data.totalSatang < 0 ? "text-expense" : "text-income",
                )}
              >
                {money(wallets.data.totalSatang)}
              </p>
              <p className="text-xs text-muted">
                {tr(
                  'ยอดคงเหลือ = ยอดตั้งต้น + รายรับ − รายจ่าย · จดลงกระเป๋าอื่นในแชทโดยใส่ @ชื่อ เช่น "กาแฟ 45 @บัตร"',
                )}
              </p>
            </section>

            <ul className="space-y-3" aria-label={tr("รายการกระเป๋า")}>
              {items.map((w) => (
                <li key={w.id} className={cardClass}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden>
                      {WALLET_KIND_EMOJI[w.kind]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {w.name}
                        {w.isDefault && items.length > 1 ? (
                          <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">
                            {tr("หลัก")}
                          </span>
                        ) : null}
                        {w.shared ? (
                          <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary">
                            {tr("👥 ร่วมกัน")} {w.memberCount ?? 1} {tr("คน")}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted">
                        {WALLET_KIND_LABEL[w.kind]} · {w.entryCount} {tr("รายการ")}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "num shrink-0 text-sm font-bold",
                        w.balanceSatang < 0 ? "text-expense" : "text-income",
                      )}
                    >
                      {money(w.balanceSatang)}
                    </p>
                    {!w.isDefault && !w.shared ? (
                      <button
                        type="button"
                        aria-label={tr("ตั้ง {0} เป็นกระเป๋าหลัก", w.name)}
                        onClick={() =>
                          act(
                            () =>
                              api(`/api/wallets/${w.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ isDefault: true }),
                              }),
                            tr("ตั้ง {0} เป็นกระเป๋าหลักแล้ว", w.name),
                          )
                        }
                        className="flex h-11 w-9 shrink-0 items-center justify-center text-muted"
                      >
                        <Star className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                    {!w.shared || w.isOwner ? (
                      <button
                        type="button"
                        aria-label={tr("แก้ไข {0}", w.name)}
                        onClick={() => setEditing(w)}
                        className="flex h-11 w-9 shrink-0 items-center justify-center text-muted"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                    {!w.isDefault && (!w.shared || w.isOwner) ? (
                      <button
                        type="button"
                        aria-label={tr("ลบ {0}", w.name)}
                        onClick={() => {
                          if (
                            window.confirm(
                              tr(
                                'ลบกระเป๋า "{0}" ใช่ไหม? รายการในกระเป๋านี้ไม่หาย แต่จะย้ายไปกระเป๋าหลัก',
                                w.name,
                              ),
                            )
                          ) {
                            void act(
                              () => api(`/api/wallets/${w.id}`, { method: "DELETE" }),
                              tr("ลบกระเป๋าแล้ว"),
                            );
                          }
                        }}
                        className="flex h-11 w-9 shrink-0 items-center justify-center text-muted"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {w.card ? <CardDetails card={w.card} /> : null}
                  {w.shared ? (
                    <SharedDetails
                      wallet={w}
                      viewerId={wallets.data?.viewerId}
                      onInvite={() => setInviting(w)}
                      onChanged={(msg) => {
                        setNotice(msg);
                        wallets.reload();
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>

            {privateItems.length > 1 ? (
              <section className={cardClass} aria-label={tr("โอนระหว่างกระเป๋า")}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{tr("โอนระหว่างกระเป๋า")}</h2>
                    <p className="text-xs text-muted">{tr("ไม่นับเป็นรายรับหรือรายจ่าย")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTransferring(true)}
                    disabled={!me.data?.features.transfer}
                    className="flex h-11 items-center gap-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-surface disabled:opacity-40"
                  >
                    <ArrowRightLeft className="h-4 w-4" aria-hidden /> {tr("โอน")}
                  </button>
                </div>
                {me.data && !me.data.features.transfer ? (
                  <PlusLock>
                    {tr("โอนเงินระหว่างกระเป๋าของคุณได้โดยไม่กระทบสรุปรายรับ-รายจ่าย")}
                  </PlusLock>
                ) : null}
                {(transfers.data?.items.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted">{tr("ยังไม่มีรายการโอน")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {transfers.data?.items.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            {t.fromName} → {t.toName}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {formatThaiDate(new Date(t.occurredAt))}
                            {t.note ? ` · ${t.note}` : ""}
                          </p>
                        </div>
                        <p className="num shrink-0 text-sm font-bold">{money(t.amountSatang)}</p>
                        <button
                          type="button"
                          aria-label={tr("ยกเลิกการโอน {0} ไป {1}", t.fromName, t.toName)}
                          onClick={() => {
                            if (
                              window.confirm(
                                tr("ยกเลิกการโอนนี้ใช่ไหม? ยอดสองกระเป๋าจะกลับเป็นเหมือนเดิม"),
                              )
                            ) {
                              void act(
                                () => api(`/api/transfers/${t.id}`, { method: "DELETE" }),
                                tr("ยกเลิกการโอนแล้ว"),
                              );
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
              </section>
            ) : null}

            <Link
              href="/debts"
              className={`${cardClass} flex items-center gap-3 !space-y-0`}
              aria-label={tr("หนี้สิน")}
            >
              <Banknote className="h-5 w-5 text-primary" aria-hidden />
              <span className="flex-1">
                <span className="block font-semibold">{tr("หนี้สิน")}</span>
                <span className="block text-xs text-muted">
                  {tr("จดให้ยืม/ยืม ตัดยอดกระเป๋าให้ · แผน Starter ขึ้นไป")}
                </span>
              </span>
            </Link>

            {notice ? (
              <p
                role="status"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                {notice}
              </p>
            ) : null}

            <section className={cardClass} aria-label={tr("ร่วมกระเป๋าด้วยรหัส")}>
              <h2 className="font-semibold">{tr("มีรหัสเชิญเข้ากระเป๋าร่วม?")}</h2>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={tr("รหัส 6 หลัก")}
                  aria-label={tr("รหัสเชิญ")}
                  className="num h-11 min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void join()}
                  className="h-11 rounded-2xl border border-border px-4 text-sm font-semibold"
                >
                  {tr("ร่วมกระเป๋า")}
                </button>
              </div>
              <p className="text-xs text-muted">
                {tr(
                  "คนที่ร่วมเห็นเฉพาะรายการที่ลงกระเป๋านั้น กระเป๋าและรายการส่วนตัวของคุณยังเป็นส่วนตัว",
                )}
              </p>
            </section>

            {wallets.data.canAdd ? (
              <button
                type="button"
                onClick={() => setEditing("new")}
                className="flex h-12 w-full items-center justify-center gap-1 rounded-2xl bg-primary text-base font-semibold text-surface"
              >
                <Plus className="h-5 w-5" aria-hidden /> {tr("เพิ่มกระเป๋า")}
              </button>
            ) : (
              <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                {tr("แผนปัจจุบันมีกระเป๋าได้")} {wallets.data.limit} {tr("ใบ")}{" "}
                <Link href="/upgrade" className="font-semibold underline">
                  {tr("ดูแผนอัปเกรด")}
                </Link>{" "}
                {tr("(Starter 5 ใบ · Pro 20 ใบ · Elite ไม่จำกัด)")}
              </p>
            )}
          </>
        )}
      </div>

      {transferring ? (
        <TransferSheet
          wallets={privateItems}
          onClose={() => setTransferring(false)}
          onSaved={() => {
            setTransferring(false);
            setNotice(tr("โอนแล้ว"));
            wallets.reload();
            transfers.reload();
          }}
        />
      ) : null}

      {inviting ? <InviteSheet wallet={inviting} onClose={() => setInviting(null)} /> : null}

      {editing ? (
        <WalletSheet
          wallet={editing === "new" ? null : editing}
          canCard={me.data?.features.creditCard === true}
          canShare={wallets.data?.canAddShared === true}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            wallets.reload();
          }}
        />
      ) : null}
    </main>
  );
}

function CardDetails({ card }: { card: NonNullable<WalletItem["card"]> }) {
  const percent = card.usedPercent;
  return (
    <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
      <div className="flex justify-between">
        <span className="text-muted">{tr("ยอดค้างชำระ")}</span>
        <span className="num font-semibold">{money(card.owedSatang)}</span>
      </div>
      {card.limitSatang !== null && card.availableSatang !== null ? (
        <>
          <div className="flex justify-between">
            <span className="text-muted">
              {card.availableSatang < 0 ? tr("เกินวงเงิน") : tr("วงเงินคงเหลือ")} {tr("(จาก")}{" "}
              {money(card.limitSatang)})
            </span>
            <span
              className={cn(
                "num font-semibold",
                card.availableSatang < 0 ? "text-expense" : "text-income",
              )}
            >
              {money(Math.abs(card.availableSatang))}
            </span>
          </div>
          {percent !== null ? (
            <div
              role="progressbar"
              aria-label={tr("การใช้วงเงิน")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, percent)}
              aria-valuetext={tr("ใช้วงเงินไป {0}%", percent)}
              className="h-2 overflow-hidden rounded-full bg-border"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  percent >= 100 ? "bg-expense" : percent >= 80 ? "bg-amber-600" : "bg-primary",
                )}
                style={{ width: `${Math.min(100, Math.max(percent > 0 ? 3 : 0, percent))}%` }}
              />
            </div>
          ) : null}
          {percent !== null ? (
            <p className="text-xs text-muted">
              {tr("ใช้วงเงินไป")} {percent}%
            </p>
          ) : null}
        </>
      ) : null}
      {card.nextStatement ? (
        <>
          <div className="flex justify-between">
            <span className="text-muted">{tr("ยอดใช้รอบนี้")}</span>
            <span className="num">{money(card.cycleSpentSatang)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{tr("ยอดใช้รอบที่แล้ว")}</span>
            <span className="num">{money(card.previousCycleSpentSatang)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{tr("ตัดรอบบิลถัดไป")}</span>
            <span>{formatThaiDate(new Date(card.nextStatement))}</span>
          </div>
        </>
      ) : null}
      {card.nextDue ? (
        <div className="flex justify-between">
          <span className="text-muted">{tr("ครบกำหนดชำระ")}</span>
          <span>{formatThaiDate(new Date(card.nextDue))}</span>
        </div>
      ) : null}
    </div>
  );
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function WalletSheet({
  wallet,
  canCard,
  canShare,
  onClose,
  onSaved,
}: {
  wallet: WalletItem | null;
  canCard: boolean;
  canShare: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { api } = useLiff();
  const [name, setName] = useState(wallet?.name ?? "");
  const [kind, setKind] = useState<WalletKind>(wallet?.kind ?? "bank");
  const [opening, setOpening] = useState(
    wallet && wallet.openingSatang !== 0 ? (wallet.openingSatang / 100).toFixed(2) : "",
  );
  const [limit, setLimit] = useState(
    wallet?.creditLimitSatang ? (wallet.creditLimitSatang / 100).toFixed(2) : "",
  );
  const [shared, setShared] = useState(false);
  const [statementDay, setStatementDay] = useState(wallet?.statementDay ?? 0);
  const [dueDay, setDueDay] = useState(wallet?.dueDay ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(opening).replace(/,/g, "").trim();
    const limitText = normalizeThaiDigits(limit).replace(/,/g, "").trim();
    if (kind === "card" && canCard && limitText && !/^\d{1,10}(\.\d{1,2})?$/.test(limitText)) {
      return setError(tr("วงเงินไม่ถูกต้อง (เช่น 50000)"));
    }
    if (!name.trim()) return setError(tr("ตั้งชื่อกระเป๋าด้วยนะ"));
    if (normalized && !BALANCE_PATTERN.test(normalized)) {
      return setError(tr("ยอดตั้งต้นไม่ถูกต้อง (เช่น 5000 หรือ -1200.50)"));
    }
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        kind,
        openingBalance: normalized || null,
        // only a NEW wallet can be made shared (an old one would show its past entries)
        ...(!wallet && shared ? { shared: true } : {}),
        // only a card has these; a locked plan sends nothing so the save still works
        ...(kind === "card" && canCard
          ? {
              creditLimit: limitText || null,
              statementDay: statementDay || null,
              dueDay: dueDay || null,
            }
          : {}),
      });
      if (wallet) {
        await api(`/api/wallets/${wallet.id}`, { method: "PATCH", body });
      } else {
        await api("/api/wallets", { method: "POST", body });
      }
      onSaved(wallet ? tr("บันทึกแล้ว") : tr("เพิ่มกระเป๋าแล้ว"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("บันทึกไม่สำเร็จ"));
      setSaving(false);
    }
  }

  return (
    <Sheet title={wallet ? tr("แก้ไขกระเป๋า") : tr("เพิ่มกระเป๋า")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_WALLET_NAME}
          placeholder={tr("ชื่อกระเป๋า เช่น บัตร KTC")}
          aria-label={tr("ชื่อกระเป๋า")}
          className={fieldClass}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as WalletKind)}
          aria-label={tr("ชนิดกระเป๋า")}
          className={fieldClass}
        >
          {WALLET_KINDS.map((k) => (
            <option key={k} value={k}>
              {WALLET_KIND_EMOJI[k]} {WALLET_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          inputMode="decimal"
          placeholder={tr("ยอดตั้งต้น ({0}) เว้นว่าง = 0", currencyUnit())}
          aria-label={tr("ยอดตั้งต้น")}
          className={cn(fieldClass, "num")}
        />
        <p className="text-xs text-muted">{tr("บัตรเครดิตที่มียอดค้าง ใส่ติดลบได้ เช่น -3500")}</p>
        {!wallet ? (
          canShare ? (
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => {
                  setShared(e.target.checked);
                  if (e.target.checked && kind === "card") setKind("bank");
                }}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="font-semibold">{tr("กระเป๋าร่วมกับคนอื่น (เช่น แฟน)")}</span>
                <span className="block text-xs text-muted">
                  {tr(
                    "ต่างคนต่างจดลงกระเป๋านี้จากแชทของตัวเอง ยอดเดียวกัน ชวนด้วยรหัส 6 หลักทีหลังได้",
                  )}
                  {tr("(ใช้ได้เฉพาะรายรับ/รายจ่าย)")}
                </span>
              </span>
            </label>
          ) : (
            <PlusLock>{tr("กระเป๋าร่วมกับแฟนหรือคนอื่น จดจากแชทของตัวเองได้ยอดเดียวกัน")}</PlusLock>
          )
        ) : null}
        {kind === "card" ? (
          canCard ? (
            <>
              <input
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                inputMode="decimal"
                placeholder={tr("วงเงิน ({0}) เช่น 50000", currencyUnit())}
                aria-label={tr("วงเงิน")}
                className={cn(fieldClass, "num")}
              />
              <select
                value={statementDay}
                onChange={(e) => setStatementDay(Number(e.target.value))}
                aria-label={tr("วันตัดรอบบิล")}
                className={fieldClass}
              >
                <option value={0}>{tr("วันตัดรอบบิล (ไม่ระบุ)")}</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {tr("ตัดรอบทุกวันที่")} {d}
                  </option>
                ))}
              </select>
              <select
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                aria-label={tr("วันครบกำหนดชำระ")}
                className={fieldClass}
              >
                <option value={0}>{tr("วันครบกำหนดชำระ (ไม่ระบุ)")}</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {tr("ครบกำหนดทุกวันที่")} {d}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <PlusLock>{tr("ตั้งวงเงิน วันตัดรอบ และดูยอดตามรอบบิลของบัตรเครดิต")}</PlusLock>
          )
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
          {saving ? tr("กำลังบันทึก...") : tr("บันทึก")}
        </button>
      </form>
    </Sheet>
  );
}

function TransferSheet({
  wallets,
  onClose,
  onSaved,
}: {
  wallets: WalletItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useLiff();
  const [fromId, setFromId] = useState(wallets[0]?.id ?? "");
  const [toId, setToId] = useState(wallets[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeThaiDigits(amount).replace(/,/g, "").trim();
    if (fromId === toId) return setError(tr("เลือกสองกระเป๋าที่ต่างกันนะ"));
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) {
      return setError(tr("จำนวนเงินไม่ถูกต้อง (เช่น 500 หรือ 500.50)"));
    }
    setSaving(true);
    setError(null);
    try {
      await api("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ fromId, toId, amount: normalized, note: note.trim() || null }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("โอนไม่สำเร็จ"));
      setSaving(false);
    }
  }

  const options = wallets.map((w) => (
    <option key={w.id} value={w.id}>
      {WALLET_KIND_EMOJI[w.kind]} {w.name}
    </option>
  ));

  return (
    <Sheet title={tr("โอนระหว่างกระเป๋า")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <select
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          aria-label={tr("จากกระเป๋า")}
          className={fieldClass}
        >
          {options}
        </select>
        <select
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          aria-label={tr("ไปกระเป๋า")}
          className={fieldClass}
        >
          {options}
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={tr("จำนวนเงิน ({0})", currencyUnit())}
          aria-label={tr("จำนวนเงินที่โอน")}
          className={cn(fieldClass, "num")}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_TRANSFER_NOTE}
          placeholder={tr("โน้ต (ไม่บังคับ)")}
          aria-label={tr("โน้ตการโอน")}
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
          {saving ? tr("กำลังโอน...") : tr("โอน")}
        </button>
      </form>
    </Sheet>
  );
}

function SharedDetails({
  wallet,
  viewerId,
  onInvite,
  onChanged,
}: {
  wallet: WalletItem;
  viewerId?: string;
  onInvite: () => void;
  onChanged: (message: string) => void;
}) {
  const { api } = useLiff();
  const members = wallet.members ?? [];
  const mine = wallet.isOwner === true;

  async function removeMember(userId: string, name: string, leaving: boolean) {
    const ask = leaving
      ? tr('ออกจากกระเป๋า "{0}" ใช่ไหม? รายการที่เคยจดไว้ยังอยู่ในกระเป๋านั้น', wallet.name)
      : tr('เอา {0} ออกจากกระเป๋า "{1}" ใช่ไหม? รายการที่เขาเคยจดยังอยู่', name, wallet.name);
    if (!window.confirm(ask)) return;
    try {
      await api(`/api/wallets/${wallet.id}/members/${userId}`, { method: "DELETE" });
      onChanged(leaving ? tr("ออกจากกระเป๋าแล้ว") : tr("เอาออกแล้ว"));
    } catch (err) {
      onChanged(err instanceof Error ? err.message : tr("ทำรายการไม่สำเร็จ"));
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
      <p className="text-xs text-muted">
        {tr("คนที่ร่วม: เห็นและจดรายการที่ลงกระเป๋านี้ได้ทุกคน แต่แก้/ลบได้เฉพาะของตัวเอง")}
      </p>
      <ul className="space-y-1" aria-label={tr("สมาชิกของ {0}", wallet.name)}>
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {m.name}
              {m.role === "owner" ? (
                <span className="ml-2 text-xs text-muted">{tr("เจ้าของ")}</span>
              ) : null}
            </span>
            {mine && m.role === "member" ? (
              <button
                type="button"
                aria-label={tr("เอา {0} ออกจาก {1}", m.name, wallet.name)}
                onClick={() => void removeMember(m.userId, m.name, false)}
                className="flex h-11 items-center px-2 text-xs text-expense"
              >
                {tr("เอาออก")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {mine ? (
          <button
            type="button"
            onClick={onInvite}
            aria-label={tr("ชวนเข้า {0}", wallet.name)}
            className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold"
          >
            {tr("ชวนเข้ากระเป๋า")}
          </button>
        ) : null}
        {!mine && viewerId ? (
          <button
            type="button"
            aria-label={tr("ออกจากกระเป๋า {0}", wallet.name)}
            onClick={() => void removeMember(viewerId, "", true)}
            className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold text-expense"
          >
            {tr("ออกจากกระเป๋านี้")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function InviteSheet({ wallet, onClose }: { wallet: WalletItem; onClose: () => void }) {
  const { api } = useLiff();
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await api(`/api/wallets/${wallet.id}/invite`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("สร้างรหัสไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(`ร่วมกระเป๋า ${invite.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Sheet title={tr("ชวนเข้า {0}", wallet.name)} onClose={onClose}>
      <div className="space-y-3">
        {invite ? (
          <>
            <p
              className="num text-center text-4xl font-bold tracking-widest"
              aria-label={tr("รหัสเชิญของกระเป๋า")}
            >
              {invite.code}
            </p>
            <p className="text-sm text-muted">
              {tr("ให้เขาพิมพ์ในแชทกับบอทว่า")}{" "}
              <span className="font-semibold">ร่วมกระเป๋า {invite.code}</span>{" "}
              {tr("(หรือใส่รหัสในหน้ากระเป๋าเงิน) ใช้ได้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง")}
            </p>
            <button
              type="button"
              onClick={() => void copy()}
              className="h-11 w-full rounded-2xl border border-border text-sm font-semibold"
            >
              {copied ? tr("คัดลอกแล้ว") : tr("คัดลอกข้อความ")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void make()}
            className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-surface disabled:opacity-60"
          >
            {busy ? tr("กำลังสร้างรหัส...") : tr("สร้างรหัสเชิญ")}
          </button>
        )}
        {error ? (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
