"use client";

import { Bell, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/liff/states";
import { describeReminder, type ReminderDto } from "@/lib/user-reminder";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type GroupReminder = ReminderDto & { mine: boolean };
interface RemindersResponse {
  items: GroupReminder[];
  isOwner: boolean;
}

const CARD = "rounded-2xl border border-[#E7DFD2] bg-[#F6EFE6] text-left";

/** A LINE group's reminders, for its owner and its members. Each may cancel the ones they set. */
export function GroupReminders({ groupId }: { groupId: string }) {
  const { api } = useLiff();
  const reminders = useApi<RemindersResponse>(`/api/groups/${groupId}/reminders`);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(r: GroupReminder) {
    if (!window.confirm(t('ยกเลิกเตือน "{0}" ของกลุ่มใช่ไหม?', r.body))) return;
    setBusy(r.id);
    try {
      await api(`/api/groups/${groupId}/reminders/${r.id}`, { method: "DELETE" });
      setNotice(t("ยกเลิกแล้ว"));
      reminders.reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t("ยกเลิกไม่สำเร็จ"));
    } finally {
      setBusy(null);
    }
  }

  if (reminders.loading && !reminders.data) return <LoadingBlock rows={3} />;
  if (reminders.error || !reminders.data) {
    return (
      <ErrorState message={reminders.error ?? t("โหลดเตือนไม่สำเร็จ")} onRetry={reminders.reload} />
    );
  }
  const { items } = reminders.data;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        {t("เตือนของกลุ่มส่งเข้ากลุ่มตามเวลา และนับรวมกับเตือนส่วนตัวของเจ้าของสมุด")}
      </p>
      {notice ? (
        <p role="status" className="text-sm text-slate-700">
          {notice}
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title={t("กลุ่มนี้ยังไม่มีเตือน")}
          hint={t('พิมพ์ในกลุ่ม เช่น "เตือน พรุ่งนี้ 9 โมง ประชุม"')}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((r) => {
            const Icon = r.repeat ? Repeat : Bell;
            return (
              <li key={r.id} className={cn(CARD, "flex items-start gap-3 p-3.5")}>
                <span className="shrink-0 rounded-xl bg-emerald-100 p-2.5 text-emerald-800">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-stone-900">
                    {r.body}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-600">
                    {describeReminder(new Date(r.remindAt), r.repeat)}
                  </span>
                </span>
                {r.mine ? (
                  <button
                    type="button"
                    onClick={() => void cancel(r)}
                    disabled={busy === r.id}
                    aria-label={t("ยกเลิกเตือน {0}", r.body)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-expense disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
