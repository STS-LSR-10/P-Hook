"use client";

import { CalendarDays, Smartphone } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError, useApi, useLiff } from "@/components/liff/liff-provider";
import { cardClass } from "@/components/liff/settings/types";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { formatThaiDate } from "@/lib/thai-date";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CalendarInfo {
  reminder: {
    id: string;
    body: string;
    remindAt: string;
    repeat: "daily" | "weekly" | "monthly" | null;
  };
  google: { available: boolean; linked: boolean; email: string | null };
}
type AddReply = { added: true; email: string | null } | { open: string };

/** How long "เพิ่มแล้ว" shows before the page closes back to the chat. */
const CLOSE_AFTER_MS = 1200;

const REPEAT_LABEL = { daily: "ทุกวัน", weekly: "ทุกสัปดาห์", monthly: "ทุกเดือน" } as const;

/**
 * Opened from "📅 เพิ่มลงปฏิทิน" on a reminder's card: Google Calendar (signed in once, then added
 * straight away and kept in step) or the phone's own calendar (an .ics file, opened in the phone's
 * browser because LINE cannot hand files to other apps).
 */
function CalendarChoice() {
  const id = useSearchParams().get("id");
  const info = useApi<CalendarInfo>(id ? `/api/reminders/${id}/calendar` : null);
  const { api, openExternal } = useLiff();
  const [busy, setBusy] = useState<"google" | "device" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(to: "google" | "device") {
    if (!id) return;
    setBusy(to);
    setProblem(null);
    setNotice(null);
    try {
      const reply = await api<AddReply>(`/api/reminders/${id}/calendar`, {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      if ("added" in reply) {
        setNotice(t("เพิ่มลง Google Calendar แล้ว"));
        setTimeout(async () => {
          try {
            const liff = (await import("@line/liff")).default;
            if (liff.isInClient()) liff.closeWindow();
          } catch {
            /* the page just stays open */
          }
        }, CLOSE_AFTER_MS);
        return;
      }
      await openExternal(reply.open);
      setNotice(
        to === "device"
          ? t("เปิดในเบราว์เซอร์แล้ว กด เพิ่มลงปฏิทิน ที่นั่น")
          : info.data?.google.available
            ? t("ลงชื่อเข้าใช้ Google ในเบราว์เซอร์ที่เปิดขึ้น แล้วกลับมาที่ไลน์")
            : t("เปิด Google Calendar แล้ว กดบันทึกที่นั่น"),
      );
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : t("เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะ"));
    } finally {
      setBusy(null);
    }
  }

  const data = info.data;
  return (
    <main>
      <PageHeader title={t("เพิ่มลงปฏิทิน")} />
      <div className="space-y-4 px-4 pb-24">
        {!id ? (
          <EmptyState
            title={t("ไม่พบเตือนนี้")}
            hint={t("กดปุ่ม เพิ่มลงปฏิทิน บนการ์ดเตือนในแชทอีกครั้งนะ")}
          />
        ) : info.loading ? (
          <LoadingBlock rows={3} />
        ) : info.error || !data ? (
          <ErrorState message={info.error ?? t("โหลดไม่สำเร็จ")} onRetry={info.reload} />
        ) : (
          <>
            <section className={cn(cardClass, "space-y-1")}>
              <p className="text-xs text-muted">{t("เตือน")}</p>
              <p className="break-words text-base font-semibold">{data.reminder.body}</p>
              <p className="text-sm text-muted">
                {formatThaiDate(new Date(data.reminder.remindAt), true)}
                {data.reminder.repeat ? ` · ${t(REPEAT_LABEL[data.reminder.repeat])}` : ""}
              </p>
            </section>

            <p className="px-1 text-sm font-semibold">{t("จะเพิ่มลงปฏิทินไหน")}</p>

            <button
              type="button"
              onClick={() => add("google")}
              disabled={busy !== null}
              className={cn(
                cardClass,
                "flex w-full items-start gap-3 text-left disabled:opacity-60",
              )}
            >
              <CalendarDays className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 space-y-1">
                <span className="block font-semibold">
                  {busy === "google" ? t("กำลังเพิ่ม…") : "Google Calendar"}
                </span>
                <span className="block text-sm text-muted">
                  {!data.google.available
                    ? t("เปิดหน้า Google Calendar ที่กรอกไว้ให้แล้ว กดบันทึกได้เลย")
                    : data.google.linked
                      ? t(
                          "เชื่อมกับ {0} แล้ว กดแล้วเพิ่มให้ทันที แก้หรือยกเลิกเตือน ปฏิทินก็เปลี่ยนตาม",
                          data.google.email ?? "Google",
                        )
                      : t(
                          "ลงชื่อเข้าใช้ด้วย Google ครั้งแรกครั้งเดียว แล้วพี่ฮูกเพิ่มให้ แก้หรือยกเลิกเตือน ปฏิทินก็เปลี่ยนตาม",
                        )}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => add("device")}
              disabled={busy !== null}
              className={cn(
                cardClass,
                "flex w-full items-start gap-3 text-left disabled:opacity-60",
              )}
            >
              <Smartphone className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 space-y-1">
                <span className="block font-semibold">
                  {busy === "device" ? t("กำลังเปิด…") : t("ปฏิทินในเครื่อง")}
                </span>
                <span className="block text-sm text-muted">
                  {t(
                    "iPhone หรือ Android: เปิดไฟล์ให้แอปปฏิทินในมือถือเพิ่ม ถ้าแก้เตือนทีหลัง ต้องเพิ่มใหม่เอง",
                  )}
                </span>
              </span>
            </button>

            {problem ? (
              <p
                role="alert"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                {problem}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* always in the page, so a reader announces what lands in it */}
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-md px-4"
      >
        {notice ? (
          <p className="rounded-2xl bg-[#2F5A38] px-4 py-2 text-center text-sm text-white shadow-lg">
            {notice}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function ReminderCalendarPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={3} />}>
      <CalendarChoice />
    </Suspense>
  );
}
