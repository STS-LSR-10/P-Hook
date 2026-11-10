"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { Segmented } from "@/components/liff/segmented";
import { ErrorState, LoadingBlock } from "@/components/liff/states";
import { CHASE_EVERY, CHASE_WINDOWS, type ChaseSchedule } from "@/lib/chase-schedule";
import { money } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { cardClass, fieldClass } from "./types";
import { t } from "@/lib/i18n";

interface OwnedGroup {
  id: string;
  name: string;
  isActive: boolean;
}
interface Manage {
  isActive: boolean;
  /** Set once the bot was taken out of the group: when its data is deleted for good. */
  purgeAt: string | null;
  summary: {
    totalSatang: number;
    count: number;
    payers: { lineUserId: string; name: string; totalSatang: number; percent: number }[];
  };
  entries: {
    id: string;
    title: string;
    amountSatang: number;
    occurredAt: string;
    payerName: string;
  }[];
  /** Where the next page of entries starts; null (or missing) when all are shown. */
  nextCursor?: string | null;
  debts: {
    id: string;
    title: string;
    amountSatang: number;
    payerName: string;
    unpaid: { userId: string; name: string; shareSatang: number }[];
  }[];
  schedule: ChaseSchedule;
}

type Entry = Manage["entries"][number];

/** Entries in the order given, under the day they happened (a date that cannot be read has no heading). */
function byDay(entries: Entry[]): { day: string | null; items: Entry[] }[] {
  const out: { day: string | null; items: Entry[] }[] = [];
  for (const e of entries) {
    const at = new Date(e.occurredAt);
    const day = Number.isNaN(at.getTime()) ? null : formatThaiDate(at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(e);
    else out.push({ day, items: [e] });
  }
  return out;
}

type Tab = "summary" | "entries" | "debts" | "chase";
type Clear =
  | { kind: "member"; billId: string; userId: string }
  | { kind: "bill"; billId: string }
  | { kind: "user"; userId: string }
  | { kind: "all" };

const EVERY_LABEL: Record<ChaseSchedule["everyDays"], string> = {
  0: t("ปิด"),
  1: t("ทุกวัน"),
  2: t("ทุก 2 วัน"),
  3: t("ทุก 3 วัน"),
  7: t("ทุกสัปดาห์"),
};
const WINDOW_LABEL: Record<ChaseSchedule["window"], string> = {
  any: t("ทั้งวัน (หลัง 10:00)"),
  morning: t("เช้า (10:00-12:00)"),
  noon: t("กลางวัน (12:00-16:00)"),
  evening: t("เย็น (16:00-22:00)"),
};

/** The owner of LINE group ledgers manages them here: totals, entries, who owes, and when to chase. */
export function GroupManageCard({ groups }: { groups: OwnedGroup[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  // kept here so the tab stays put when another group is chosen
  const [tab, setTab] = useState<Tab>("summary");
  return (
    <div className="space-y-3">
      {groups.length > 1 ? (
        <select
          aria-label={t("เลือกกลุ่ม")}
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className={fieldClass}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-sm font-semibold">{groups[0]?.name}</p>
      )}
      {/* keyed: another group starts from nothing, so one group's bills are never under another's buttons */}
      <GroupPanel key={groupId} groupId={groupId} tab={tab} onTab={setTab} />
    </div>
  );
}

function GroupPanel({
  groupId,
  tab,
  onTab,
}: {
  groupId: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  const { api } = useLiff();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = useApi<Manage>(groupId ? `/api/groups/${groupId}/manage` : null);
  const data = manage.data;
  // pages loaded with "ดูเพิ่ม" after the first one; a fresh load of the card starts over from the first
  const [paged, setPaged] = useState<{ items: Entry[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setPaged(null), [data]);
  const entries = [
    ...new Map([...(data?.entries ?? []), ...(paged?.items ?? [])].map((e) => [e.id, e])).values(),
  ];
  const nextCursor = paged ? paged.next : (data?.nextCursor ?? null);

  async function showMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setNotice(null);
    try {
      const r = await api<{ entries: Entry[]; nextCursor: string | null }>(
        `/api/groups/${groupId}/entries?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setPaged((p) => ({ items: [...(p?.items ?? []), ...r.entries], next: r.nextCursor }));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("โหลดไม่สำเร็จ"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function run(job: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await job());
      manage.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("ทำไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  const clear = (scope: Clear, ask: string) => {
    if (!window.confirm(ask)) return;
    void run(async () => {
      const r = await api<{ cleared: number }>(`/api/groups/${groupId}/debts`, {
        method: "POST",
        body: JSON.stringify(scope),
      });
      return t("เคลียร์แล้ว {0} รายการ", r.cleared);
    });
  };

  const editEntry = (e: Entry) => {
    const title = window.prompt(t("ชื่อรายการ"), e.title)?.trim();
    if (!title) return;
    const amount = Number(
      (window.prompt(t("จำนวนเงิน (บาท)"), String(e.amountSatang / 100)) ?? "").replace(/,/g, ""),
    );
    if (!(amount > 0)) return;
    void run(async () => {
      await api(`/api/groups/${groupId}/entries/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, amountSatang: Math.round(amount * 100) }),
      });
      return t("แก้แล้ว");
    });
  };

  const removeEntry = (e: Entry) => {
    if (!window.confirm(t('ลบ "{0}" ออกจากสมุดกลุ่มใช่ไหม?', e.title))) return;
    void run(async () => {
      await api(`/api/groups/${groupId}/entries/${e.id}`, { method: "DELETE" });
      return t("ลบแล้ว");
    });
  };

  const setSchedule = (next: ChaseSchedule) =>
    void run(async () => {
      await api(`/api/groups/${groupId}/schedule`, { method: "PUT", body: JSON.stringify(next) });
      return t("บันทึกแล้ว");
    });

  // everyone who owes anything, with the total, for "clear one person"
  const owing = new Map<string, { name: string; total: number }>();
  for (const d of data?.debts ?? [])
    for (const u of d.unpaid) {
      const now = owing.get(u.userId);
      owing.set(u.userId, { name: u.name, total: (now?.total ?? 0) + u.shareSatang });
    }

  const btn = "h-9 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-40";

  return (
    <div className="space-y-3">
      <Segmented
        label={t("หมวดจัดการกลุ่ม")}
        value={tab}
        onChange={onTab}
        options={[
          { value: "summary", label: t("สรุป") },
          { value: "entries", label: t("รายการจด") },
          { value: "debts", label: t("ค้างจ่าย") },
          { value: "chase", label: t("ทวงตัง") },
        ]}
      />
      {notice ? (
        <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}
      {manage.loading && !data ? (
        <LoadingBlock rows={3} />
      ) : manage.error && !data ? (
        <ErrorState message={manage.error} onRetry={manage.reload} />
      ) : data ? (
        <>
          {!data.isActive ? (
            <p className="rounded-2xl bg-warn-soft px-4 py-2 text-xs text-warn">
              {data.purgeAt
                ? t(
                    'พี่ฮูกถูกลบออกจากกลุ่มนี้แล้ว ข้อมูลจะถูกลบถาวรวันที่ {0} เพิ่มพี่ฮูกกลับเข้ากลุ่มแล้วพิมพ์ "เปิดสมุดกลุ่ม" เพื่อเก็บไว้',
                    formatThaiDate(new Date(data.purgeAt)),
                  )
                : t("สมุดกลุ่มนี้ปิดอยู่ ดูได้อย่างเดียว เปิดสมุดในกลุ่มก่อนจึงจะแก้ได้")}
            </p>
          ) : null}
          {tab === "summary" ? (
            <section className={cardClass} aria-label={t("สรุปกลุ่มเดือนนี้")}>
              <h3 className="text-sm font-semibold">{t("สรุปกลุ่มเดือนนี้")}</h3>
              <p className="num text-2xl font-bold">{money(data.summary.totalSatang)}</p>
              <p className="text-xs text-muted">{t("{0} รายการ", data.summary.count)}</p>
              {data.summary.payers.length === 0 ? (
                <p className="text-sm text-muted">{t("ยังไม่มีรายการในเดือนนี้")}</p>
              ) : (
                <ul className="space-y-2">
                  {data.summary.payers.map((p) => (
                    <li key={p.lineUserId} className="flex justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="num shrink-0 font-semibold">
                        {money(p.totalSatang)} ({p.percent}%)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {tab === "entries" ? (
            <section className={cardClass} aria-label={t("รายการจดของกลุ่ม")}>
              <h3 className="text-sm font-semibold">{t("รายการจดล่าสุดของกลุ่ม")}</h3>
              {entries.length === 0 ? (
                <p className="text-sm text-muted">{t("ยังไม่มีรายการ")}</p>
              ) : (
                <div className="space-y-3">
                  {byDay(entries).map((g, i) => (
                    <div key={`${g.day}-${i}`} className="space-y-2">
                      {g.day ? <h4 className="text-xs font-semibold text-muted">{g.day}</h4> : null}
                      <ul className="space-y-2">
                        {g.items.map((e) => (
                          <li key={e.id} className="flex items-center gap-2 text-sm">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{e.title}</span>
                              <span className="block truncate text-xs text-muted">
                                {e.payerName}
                              </span>
                            </span>
                            <span className="num shrink-0 font-semibold">
                              {money(e.amountSatang)}
                            </span>
                            <button
                              type="button"
                              disabled={busy || !data.isActive}
                              onClick={() => editEntry(e)}
                              className={btn}
                            >
                              {t("แก้")}
                            </button>
                            <button
                              type="button"
                              aria-label={t("ลบ {0}", e.title)}
                              disabled={busy || !data.isActive}
                              onClick={() => removeEntry(e)}
                              className={cn(btn, "w-9 px-0 text-expense")}
                            >
                              <Trash2 className="mx-auto h-4 w-4" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {nextCursor ? (
                    <button
                      type="button"
                      onClick={showMore}
                      disabled={loadingMore}
                      className="h-11 w-full rounded-2xl border border-border bg-surface text-sm font-semibold disabled:opacity-60"
                    >
                      {loadingMore ? t("กำลังโหลด…") : t("ดูเพิ่ม")}
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {tab === "debts" ? (
            <section className={cardClass} aria-label={t("บิลค้างจ่าย")}>
              <h3 className="text-sm font-semibold">{t("บิลค้างจ่าย")}</h3>
              {data.debts.length === 0 ? (
                <p className="text-sm text-muted">{t("ตอนนี้ไม่มีบิลที่ค้างอยู่ 🎉")}</p>
              ) : (
                <>
                  {data.debts.map((d) => (
                    <div key={d.id} className="space-y-2 rounded-2xl border border-border p-3">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-semibold">{d.title}</span>
                        <span className="num shrink-0">{money(d.amountSatang)}</span>
                      </div>
                      <p className="text-xs text-muted">{t("คนจ่ายให้ก่อน: {0}", d.payerName)}</p>
                      <ul className="space-y-1.5">
                        {d.unpaid.map((u) => (
                          <li key={u.userId} className="flex items-center gap-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{u.name}</span>
                            <span className="num shrink-0">{money(u.shareSatang)}</span>
                            <button
                              type="button"
                              disabled={busy || !data.isActive}
                              onClick={() =>
                                clear(
                                  { kind: "member", billId: d.id, userId: u.userId },
                                  t('ทำเครื่องหมายว่า {0} จ่าย "{1}" แล้วใช่ไหม?', u.name, d.title),
                                )
                              }
                              className={btn}
                            >
                              {t("จ่ายแล้ว")}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        disabled={busy || !data.isActive}
                        onClick={() =>
                          clear(
                            { kind: "bill", billId: d.id },
                            t('ยกเลิกบิล "{0}" ทั้งใบใช่ไหม?', d.title),
                          )
                        }
                        className={cn(btn, "text-expense")}
                      >
                        {t("ยกเลิกบิลนี้")}
                      </button>
                    </div>
                  ))}
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs font-semibold text-muted">{t("เคลียร์ทั้งหมด")}</p>
                    <div className="flex flex-wrap gap-2">
                      {[...owing].map(([userId, o]) => (
                        <button
                          key={userId}
                          type="button"
                          disabled={busy || !data.isActive}
                          onClick={() =>
                            clear(
                              { kind: "user", userId },
                              t(
                                "เคลียร์ยอดค้างทั้งหมดของ {0} ({1}) ใช่ไหม?",
                                o.name,
                                money(o.total),
                              ),
                            )
                          }
                          className={btn}
                        >
                          {t("เคลียร์ของ {0}", o.name)}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={busy || !data.isActive}
                        onClick={() =>
                          clear(
                            { kind: "all" },
                            t("เคลียร์ยอดค้างทั้งหมดของกลุ่มใช่ไหม? ทุกคนจะถือว่าจ่ายครบแล้ว"),
                          )
                        }
                        className={cn(btn, "bg-primary-soft text-primary")}
                      >
                        {t("เคลียร์ยอดค้างทั้งกลุ่ม")}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {tab === "chase" ? (
            <section className={cardClass} aria-label={t("ตั้งเวลาทวงตัง")}>
              <div>
                <h3 className="text-sm font-semibold">{t("ตั้งเวลาทวงตัง")}</h3>
                <p className="text-xs text-muted">
                  {t(
                    "บอทเตือนบิลที่ค้างโดยแนบไปกับแชทที่มีคนพิมพ์ในกลุ่มช่วงนั้น ไม่เสียโควตา ถ้ากลุ่มเงียบทั้งช่วงจะไม่มีข้อความเตือน",
                  )}
                </p>
              </div>
              <div role="radiogroup" aria-label={t("ความถี่")} className="grid grid-cols-3 gap-2">
                {CHASE_EVERY.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={data.schedule.everyDays === d}
                    disabled={busy || !data.isActive}
                    onClick={() => setSchedule({ ...data.schedule, everyDays: d })}
                    className={cn(
                      "min-h-11 rounded-2xl border px-2 text-sm",
                      data.schedule.everyDays === d
                        ? "border-2 border-primary bg-primary-soft text-primary"
                        : "border-border text-muted",
                    )}
                  >
                    {EVERY_LABEL[d]}
                  </button>
                ))}
              </div>
              {data.schedule.everyDays > 0 ? (
                <div
                  role="radiogroup"
                  aria-label={t("ช่วงเวลา")}
                  className="grid grid-cols-2 gap-2"
                >
                  {CHASE_WINDOWS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      role="radio"
                      aria-checked={data.schedule.window === w}
                      disabled={busy || !data.isActive}
                      onClick={() => setSchedule({ ...data.schedule, window: w })}
                      className={cn(
                        "min-h-11 rounded-2xl border px-2 text-sm",
                        data.schedule.window === w
                          ? "border-2 border-primary bg-primary-soft text-primary"
                          : "border-border text-muted",
                      )}
                    >
                      {WINDOW_LABEL[w]}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
