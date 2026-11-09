import { Check, Crown, Sparkles } from "lucide-react";
import Link from "next/link";
import { priceFor } from "@/lib/pricing";
import { t as tr } from "@/lib/i18n";

const COPY = {
  flow: {
    title: tr('ปลดล็อกกราฟ "วิเคราะห์รายรับรายจ่าย"'),
    text: tr("ดูภาพรวมเงินเข้า-ออกย้อนหลังและสัดส่วนรายจ่ายตามหมวดแบบเห็นภาพ"),
    points: [
      tr("กราฟรายรับรายจ่าย 6 เดือน รายสัปดาห์ และรายวัน"),
      tr("ย้อนดูช่วงเวลาก่อนหน้าได้ พร้อมค่าเฉลี่ย"),
      tr("สัดส่วนรายจ่ายตามหมวด ทั้งรอบนี้และสะสมทั้งหมด"),
    ],
  },
  saving: {
    title: tr('ปลดล็อกระบบ "วางแผนเก็บออม"'),
    text: tr("ดูเงินเก็บสะสมและอัตราการออมของคุณ เพื่อสร้างวินัยเงินออมอย่างต่อเนื่อง"),
    points: [
      tr("กราฟเงินเก็บสะสมรายเดือน"),
      tr("อัตราการออมเทียบกับรายรับ"),
      tr("ใช้คู่กับเป้าหมายเก็บออมแยกกระปุกในหน้าเป้าหมาย"),
    ],
  },
} as const;

/**
 * What a locked analytics tab shows for Free: a blurred hint of the real page behind a card that
 * says what Starter adds, with the price that applies today.
 */
export function ProTeaser({ variant }: { variant: keyof typeof COPY }) {
  const copy = COPY[variant];
  const monthly = priceFor("starter", new Date()).monthly;
  return (
    <div className="relative flex min-h-[34rem] items-center justify-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 select-none space-y-4 opacity-40 blur-[6px]"
      >
        <div className="rounded-3xl border border-border bg-surface p-4">
          <div className="mb-3 h-4 w-40 rounded-lg bg-border" />
          <div className="flex h-36 items-end gap-3 px-2">
            {[40, 65, 50, 80, 55, 95].map((h, i) => (
              <div key={i} className="flex flex-1 items-end gap-1">
                <div className="w-1/2 rounded-t-md bg-income" style={{ height: `${h}%` }} />
                <div className="w-1/2 rounded-t-md bg-expense" style={{ height: `${h * 0.5}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-4">
          <div className="mb-3 h-4 w-32 rounded-lg bg-border" />
          {[70, 45, 30].map((w, i) => (
            <div key={i} className="mb-3 h-2.5 rounded-full bg-border">
              <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      </div>

      <section
        aria-label={tr("ฟีเจอร์ของแผน Starter ขึ้นไป")}
        className="relative z-10 w-full space-y-4 rounded-3xl border border-warn/30 bg-surface/95 p-6 text-center shadow-card backdrop-blur"
      >
        <div className="inline-flex rounded-2xl border border-warn/30 bg-warn-soft p-3 text-warn">
          <Crown className="h-7 w-7" aria-hidden />
        </div>
        <div className="space-y-1">
          <span className="inline-block rounded-full border border-warn/30 bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">
            {tr("สำหรับแผน Starter ขึ้นไป")}
          </span>
          <h2 className="text-base font-bold">{copy.title}</h2>
          <p className="text-xs text-muted">{copy.text}</p>
        </div>
        <ul className="space-y-2.5 rounded-2xl bg-background p-3.5 text-left text-xs">
          {copy.points.map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Check className="h-2.5 w-2.5" aria-hidden />
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <Link
            href="/upgrade"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-surface"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {tr("อัปเกรดเป็น Starter เริ่มต้น ฿")}
            {monthly}
            {tr("/เดือน")}
          </Link>
          <p className="text-[11px] text-muted">{tr("ลองใช้ฟรี 7 วันได้ที่หน้าอัปเกรด")}</p>
        </div>
      </section>
    </div>
  );
}
