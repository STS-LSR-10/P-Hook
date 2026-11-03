"use client";

import { Check, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass } from "@/components/liff/settings/types";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";
import { canSendToChat } from "@/lib/liff-chat";
import { t } from "@/lib/i18n";

interface Person {
  lineUserId: string;
  name: string;
  isPayer: boolean;
  /** tapped "ร่วมหารด้วย" in the group */
  joined?: boolean;
}
interface SetupResponse {
  bill: { id: string; title: string; amountSatang: number; status: string };
  people: Person[];
  complete: boolean;
  open: boolean;
  maxPeople: number;
}
interface ConfirmResponse {
  ok: true;
  count: number;
  message: string;
}

const money = (satang: number) => t("฿{0}", formatBaht(satang));

/** Where the payer of a bill ticks who shares it. Opened from the bill card in the LINE group. */
export default function SplitBillPage() {
  const { id } = useParams<{ id: string }>();
  const { api } = useLiff();
  const setup = useApi<SetupResponse>(`/api/split-bill/${id}`);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; sent: boolean } | null>(null);

  const data = setup.data;
  const people = useMemo(() => data?.people ?? [], [data]);
  // the payer is always in; everyone else starts unticked
  const chosen = useMemo(() => {
    const set = new Set(picked ?? people.filter((p) => p.joined).map((p) => p.lineUserId));
    for (const p of people) if (p.isPayer) set.add(p.lineUserId);
    return set;
  }, [picked, people]);
  const others = people.filter((p) => !p.isPayer);
  const count = chosen.size;
  const share = data && count > 0 ? Math.floor(data.bill.amountSatang / count) : 0;

  function toggle(lineUserId: string) {
    const next = new Set(chosen);
    if (next.has(lineUserId)) next.delete(lineUserId);
    else next.add(lineUserId);
    setPicked(next);
  }
  const selectAll = () => setPicked(new Set(people.map((p) => p.lineUserId)));
  const clearAll = () => setPicked(new Set());

  async function confirm() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ConfirmResponse>(`/api/split-bill/${id}`, {
        method: "POST",
        body: JSON.stringify({ people: [...chosen] }),
      });
      // write a short line in the group: the bot answers it with everybody's QR codes
      let sent = false;
      try {
        const liff = (await import("@line/liff")).default;
        if (canSendToChat(liff)) {
          await liff.sendMessages([{ type: "text", text: res.message }]);
          sent = true;
        }
      } catch {
        sent = false;
      }
      setDone({ count: res.count, sent });
      if (sent) {
        try {
          (await import("@line/liff")).default.closeWindow();
        } catch {
          /* the page just stays open */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("บันทึกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <PageHeader title={t("เลือกคนหารบิล")} />
      <div className="space-y-4 px-4 pb-24">
        {setup.loading ? (
          <LoadingBlock rows={4} />
        ) : setup.error || !data ? (
          <ErrorState message={setup.error ?? t("โหลดไม่สำเร็จ")} onRetry={setup.reload} />
        ) : done ? (
          <section className={cn(cardClass, "space-y-2 text-center")} aria-live="polite">
            <Check className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <h2 className="text-lg font-bold">
              {t("เลือกเสร็จแล้ว หาร")} {done.count} {t("คน")}
            </h2>
            {done.sent ? (
              <p className="text-sm text-muted">
                {t("ส่งเข้ากลุ่มแล้ว บอทกำลังส่ง QR ให้ทุกคน กลับไปที่แชทได้เลย")}
              </p>
            ) : (
              <p className="text-sm text-muted">
                {t("กลับไปที่กลุ่ม แล้วกดปุ่ม")} <strong>{t("“📣 ส่ง QR เข้ากลุ่ม”")}</strong>{" "}
                {t("ที่การ์ดบิล บอทจะส่ง QR ให้ทุกคน")}
              </p>
            )}
          </section>
        ) : !data.open ? (
          <EmptyState
            title={t("เลือกคนหารไปแล้ว")}
            hint={t("บิลนี้เลือกรายชื่อเรียบร้อยแล้ว ดู QR และสถานะได้ที่การ์ดบิลในกลุ่ม")}
          />
        ) : (
          <>
            <section className={cn(cardClass, "space-y-1")}>
              <h2 className="text-base font-bold">{data.bill.title}</h2>
              <p className="num text-2xl font-extrabold">{money(data.bill.amountSatang)}</p>
              <p className="text-xs text-muted">
                {t("เลือกคนที่หารบิลนี้ บอทหารเท่ากันให้ (รวมคุณด้วย)")}
              </p>
            </section>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="min-h-11 flex-1 rounded-2xl border border-border bg-surface px-3 text-sm font-semibold"
              >
                {t("เลือกทั้งหมด")}
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="min-h-11 flex-1 rounded-2xl border border-border bg-surface px-3 text-sm font-semibold"
              >
                {t("ล้างที่เลือก")}
              </button>
            </div>

            <ul className="space-y-2" aria-label={t("รายชื่อในกลุ่ม")}>
              {people.map((p) => {
                const on = chosen.has(p.lineUserId);
                return (
                  <li key={p.lineUserId}>
                    <label
                      className={cn(
                        "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2",
                        on ? "border-primary bg-primary-soft" : "border-border bg-surface",
                        p.isPayer && "cursor-default",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={p.isPayer}
                        onChange={() => toggle(p.lineUserId)}
                        className="h-5 w-5 accent-[var(--primary,#0F766E)]"
                      />
                      <span className="flex-1">{p.name}</span>
                      {p.isPayer ? (
                        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-primary">
                          {t("คนจ่าย")}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>

            {others.length === 0 ? (
              <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                {t(
                  "บอทยังไม่รู้จักเพื่อนในกลุ่มนี้ ให้เพื่อนพิมพ์อะไรสักอย่างในกลุ่มก่อน แล้วกลับมาเปิดหน้านี้ใหม่",
                )}
              </p>
            ) : !data.complete ? (
              <p className="flex items-start gap-2 rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary">
                <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {t(
                    "แสดงเฉพาะคนที่บอทเคยเห็นในกลุ่ม ถ้าไม่เห็นเพื่อนบางคน ให้เขาพิมพ์อะไรสักอย่างในกลุ่มก่อน แล้วเปิดหน้านี้ใหม่",
                  )}
                </span>
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-2xl bg-expense/10 px-4 py-2 text-sm text-expense">
                {error}
              </p>
            ) : null}

            <section className={cn(cardClass, "space-y-3")}>
              <p className="text-center text-sm" aria-live="polite">
                {t("เลือก")} <span className="num font-bold">{count}</span> {t("คน")}
                {count > 1 ? (
                  <>
                    {" "}
                    {t("· คนละ ≈")} <span className="num font-bold">{money(share)}</span>
                  </>
                ) : null}
              </p>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || count < 2}
                className="h-12 w-full rounded-2xl bg-primary font-semibold text-white disabled:opacity-50"
              >
                {busy ? t("กำลังบันทึก…") : t("ยืนยัน และส่ง QR เข้ากลุ่ม")}
              </button>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
