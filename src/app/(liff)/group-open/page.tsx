"use client";

import { BookOpen, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/components/liff/liff-provider";
import { cardClass } from "@/components/liff/settings/types";
import { ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { cn } from "@/lib/utils";
import { canSendToChat } from "@/lib/liff-chat";

interface OpenCheck {
  /** null = LINE could not tell */
  friend: boolean | null;
  plan: "free" | "plus" | "ultimate";
  canOpen: boolean;
  addFriendUrl: string;
}

/**
 * Opened from "เปิดสมุดกลุ่ม" on the welcome card in a group. Someone who is not a friend of the bot gets
 * an explanation and a link to add it (instead of a command the bot could not answer), someone without
 * Elite is told so, and everybody else writes the command in the group with one tap.
 */
export default function GroupOpenPage() {
  const check = useApi<OpenCheck>("/api/group-open");
  const [sent, setSent] = useState<"yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const liff = (await import("@line/liff")).default;
      if (canSendToChat(liff)) {
        await liff.sendMessages([{ type: "text", text: "เปิดสมุดกลุ่ม" }]);
        setSent("yes");
        try {
          liff.closeWindow();
        } catch {
          /* the page just stays open */
        }
        return;
      }
      setSent("no");
    } catch {
      setSent("no");
    } finally {
      setBusy(false);
    }
  }

  const data = check.data;
  return (
    <main>
      <PageHeader title="เปิดสมุดกลุ่ม" />
      <div className="space-y-4 px-4 pb-24">
        {check.loading ? (
          <LoadingBlock rows={3} />
        ) : check.error || !data ? (
          <ErrorState message={check.error ?? "โหลดไม่สำเร็จ"} onRetry={check.reload} />
        ) : data.friend === false ? (
          <section className={cn(cardClass, "space-y-3 text-center")}>
            <UserPlus className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <h2 className="text-lg font-bold">คุณยังไม่ได้เพิ่มพี่ฮูกเป็นเพื่อน</h2>
            <p className="text-sm text-muted">
              บอทต้องเป็นเพื่อนกับคุณก่อน ถึงจะรู้ว่าใครเป็นคนเปิดสมุดกลุ่ม
              เพิ่มเพื่อนแล้วกลับไปกดปุ่ม “เปิดสมุดกลุ่ม” ในกลุ่มอีกครั้งนะ
            </p>
            <a
              href={data.addFriendUrl}
              className="flex h-12 items-center justify-center rounded-2xl bg-primary font-semibold text-white"
            >
              เพิ่มเพื่อน
            </a>
          </section>
        ) : !data.canOpen ? (
          <section className={cn(cardClass, "space-y-3 text-center")}>
            <BookOpen className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <h2 className="text-lg font-bold">ผู้เปิดสมุดกลุ่มต้องเป็นแผน Elite</h2>
            <p className="text-sm text-muted">
              เพื่อน ๆ ในกลุ่มจดได้ฟรี มีแค่คนเปิดสมุดที่ต้องเป็น Elite ทดลองใช้ฟรี 7 วันได้
            </p>
            <Link
              href="/upgrade"
              className="flex h-12 items-center justify-center rounded-2xl bg-primary font-semibold text-white"
            >
              ดูแผนและทดลองใช้ฟรี
            </Link>
          </section>
        ) : sent === "yes" ? (
          <section className={cn(cardClass, "space-y-2 text-center")} aria-live="polite">
            <BookOpen className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <h2 className="text-lg font-bold">ส่งคำสั่งเข้ากลุ่มแล้ว</h2>
            <p className="text-sm text-muted">กลับไปที่กลุ่ม บอทกำลังเปิดสมุดให้</p>
          </section>
        ) : (
          <section className={cn(cardClass, "space-y-3 text-center")}>
            <BookOpen className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <h2 className="text-lg font-bold">เปิดสมุดกลุ่มนี้</h2>
            <p className="text-sm text-muted">
              ทุกคนในกลุ่มช่วยกันจดรายจ่ายและหารบิลได้ โดยคุณเป็นเจ้าของสมุด
            </p>
            <button
              type="button"
              onClick={open}
              disabled={busy}
              className="h-12 w-full rounded-2xl bg-primary font-semibold text-white disabled:opacity-50"
            >
              {busy ? "กำลังส่ง…" : "📒 เปิดสมุดกลุ่ม"}
            </button>
            {sent === "no" ? (
              <p
                role="alert"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                ส่งจากหน้านี้ไม่ได้ กลับไปที่กลุ่มแล้วพิมพ์ <strong>เปิดสมุดกลุ่ม</strong> ได้เลย
              </p>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
