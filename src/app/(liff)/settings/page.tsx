"use client";

import {
  Brain,
  CalendarClock,
  Clock,
  Coins,
  Gift,
  Crown,
  Languages,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { DeleteCard } from "@/components/liff/settings/delete-card";
import { PersonalizeCard } from "@/components/liff/settings/personalize-card";
import { PhotoPromptCard } from "@/components/liff/settings/photo-prompt-card";
import { ResetCard } from "@/components/liff/settings/reset-card";
import { MemoryCard } from "@/components/liff/settings/memory-card";
import { PlanCard } from "@/components/liff/settings/plan-card";
import {
  MenuButton,
  MenuGroup,
  MenuHeading,
  MenuInfo,
  MenuLink,
} from "@/components/liff/settings/menu";
import { NotificationsCard } from "@/components/liff/settings/notifications-card";
import { PaymentHistorySheet } from "@/components/liff/settings/payment-history-sheet";
import { RecurringCard } from "@/components/liff/settings/recurring-card";
import { cardClass, type Me, type Settings } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { MAX_START_DAY } from "@/lib/budget-cycle";
import { cn } from "@/lib/utils";

const CONFIRM_OPTIONS: { value: Settings["confirm_style"]; label: string; hint: string }[] = [
  { value: "full", label: "เต็ม", hint: "การ์ดพร้อมปุ่มแก้ไข/ลบ" },
  { value: "short", label: "สั้น", hint: "ข้อความบรรทัดเดียว" },
  { value: "off", label: "ไม่ส่ง", hint: "จดเงียบ ๆ ไม่ตอบกลับ" },
];

const CYCLE_OPTIONS: { value: Settings["budget_cycle"]; label: string }[] = [
  { value: "monthly", label: "รายเดือน" },
  { value: "weekly", label: "รายสัปดาห์" },
];

const START_DAYS = Array.from({ length: MAX_START_DAY }, (_, i) => i + 1);

export default function SettingsPage() {
  const { api } = useLiff();
  const settings = useApi<Settings>("/api/settings");
  const me = useApi<Me>("/api/me");
  const [override, setOverride] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<"recurring" | "memory" | "payments" | null>(null);

  // /settings#recurring (from the entries page) opens the recurring list straight away
  useEffect(() => {
    if (window.location.hash === "#recurring") setSheet("recurring");
  }, []);

  const current = override ?? settings.data;

  async function save(patch: Partial<Settings>) {
    if (!current) return;
    const previous = current;
    setOverride({ ...current, ...patch }); // optimistic
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api<Settings>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setOverride(saved);
      setNotice("บันทึกแล้ว");
    } catch (e) {
      setOverride(previous);
      setNotice(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  const loading = settings.loading || me.loading;
  const error = settings.error ?? me.error;

  return (
    <main>
      <PageHeader title="ตั้งค่า" />
      <div className="space-y-3.5 px-4 pb-4">
        {loading ? (
          <LoadingBlock rows={4} />
        ) : error || !current || !me.data ? (
          <ErrorState
            message={error ?? "โหลดไม่สำเร็จ"}
            onRetry={() => {
              settings.reload();
              me.reload();
            }}
          />
        ) : (
          <>
            <PlanCard
              me={me.data}
              onChanged={me.reload}
              onOpenHistory={() => setSheet("payments")}
            />

            <section className={cardClass}>
              <div>
                <h2 className="font-semibold">การ์ดยืนยันหลังจด</h2>
                <p className="text-xs text-muted">รูปแบบข้อความสรุปหลังจดบันทึกใน LINE</p>
              </div>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="รูปแบบการ์ด">
                {CONFIRM_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={current.confirm_style === o.value}
                    disabled={saving}
                    onClick={() => save({ confirm_style: o.value })}
                    className={cn(
                      "min-h-14 rounded-2xl border px-2 py-2 text-center",
                      current.confirm_style === o.value
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-muted",
                    )}
                  >
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-[11px] leading-tight">{o.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className={cardClass}>
              <div>
                <h2 className="font-semibold">รอบงบ</h2>
                <p className="text-xs text-muted">ระยะเวลาการคำนวณสรุปยอดรายรับและรายจ่าย</p>
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ชนิดรอบงบ">
                {CYCLE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={current.budget_cycle === o.value}
                    disabled={saving}
                    onClick={() => save({ budget_cycle: o.value })}
                    className={cn(
                      "h-11 rounded-2xl border text-sm font-semibold",
                      current.budget_cycle === o.value
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-muted",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {current.budget_cycle === "monthly" ? (
                <label className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                  <span className="font-medium">เริ่มรอบทุกวันที่</span>
                  <select
                    value={current.cycle_start_day}
                    disabled={saving}
                    onChange={(e) => save({ cycle_start_day: Number(e.target.value) })}
                    className="num h-11 w-24 rounded-2xl border border-border bg-background px-3 text-center"
                  >
                    {START_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="border-t border-border pt-3 text-xs text-muted">
                  รอบสัปดาห์เริ่มทุกวันจันทร์
                </p>
              )}
            </section>

            {notice ? (
              <p
                role="status"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                {notice}
              </p>
            ) : null}

            <NotificationsCard me={me.data} settings={current} onSaved={setOverride} />
            <PersonalizeCard me={me.data} settings={current} onSaved={setOverride} />
            <PhotoPromptCard me={me.data} settings={current} onSaved={setOverride} />

            <MenuGroup label="จัดการฟีเจอร์">
              <MenuLink
                href="/wallets"
                ariaLabel="กระเป๋าเงิน"
                icon={<Wallet className="h-[18px] w-[18px]" />}
                title="กระเป๋าเงิน"
                sub={`แยกเงินสด บัญชี บัตร เงินเก็บ · มีได้ ${me.data.limits.wallets} ใบ`}
              />
              <MenuLink
                href="/goals"
                ariaLabel="เป้าหมายการออม"
                icon={<PiggyBank className="h-[18px] w-[18px]" />}
                title="เป้าหมายการออม"
                sub="กระปุกออมสิน ตั้งเป้า ดูความคืบหน้า · Pro ขึ้นไป"
              />
              <MenuLink
                href="/bills"
                ariaLabel="บิลที่ต้องจ่าย"
                icon={<CalendarClock className="h-[18px] w-[18px]" />}
                title="เตือนจ่ายบิล"
                sub="บอทเตือนก่อนวันครบกำหนด · แผน Elite"
              />
              <MenuButton
                onClick={() => setSheet("recurring")}
                ariaLabel="รายการประจำ"
                icon={<Repeat className="h-[18px] w-[18px]" />}
                title="รายการประจำ"
                sub="จดให้อัตโนมัติ เช่น ค่าเน็ต ค่าเช่า เงินเดือน"
                badge={
                  <span className="flex items-center gap-0.5 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                    <Plus className="h-3 w-3" aria-hidden /> เพิ่ม
                  </span>
                }
              />
              <MenuButton
                onClick={() => setSheet("memory")}
                ariaLabel="จัดหมวดด้วยความจำ"
                icon={<Brain className="h-[18px] w-[18px]" />}
                title="จัดหมวดด้วยความจำ"
                sub={'เมื่อแก้หมวดสลิป บอทจะจำคู่ "ผู้รับ → หมวด" ไว้ใช้ครั้งต่อไป'}
              />
            </MenuGroup>

            <MenuHeading>สมาชิก</MenuHeading>
            <MenuGroup label="สมาชิก">
              <MenuLink
                href="/upgrade"
                tone="warm"
                icon={<Crown className="h-[18px] w-[18px]" />}
                title="อัปเกรด"
                sub="ปลดล็อกฟีเจอร์พรีเมียมทั้งหมด"
              />
              <MenuLink
                href="/invite"
                icon={<Gift className="h-[18px] w-[18px]" />}
                title="ชวนเพื่อน"
                sub="รหัสชวนของคุณ และรับเหรียญสะสมทั้งคู่"
                value={me.data.referrals > 0 ? `${me.data.referrals} คน` : undefined}
              />
              <MenuButton
                onClick={() => setSheet("payments")}
                icon={<Receipt className="h-[18px] w-[18px]" />}
                title="ประวัติการชำระเงิน"
                sub="ดูใบเสร็จและรอบต่ออายุสมาชิก"
              />
            </MenuGroup>

            <MenuHeading>ทั่วไป</MenuHeading>
            <MenuGroup label="ทั่วไป">
              <MenuInfo
                icon={<Languages className="h-[18px] w-[18px]" />}
                title="ภาษา"
                value="ไทย"
              />
              <MenuInfo
                icon={<Coins className="h-[18px] w-[18px]" />}
                title="สกุลเงิน"
                sub="ตอนนี้ใช้เงินบาท ตัวเลือกสกุลอื่นกำลังจะมา"
                value="บาท (฿)"
              />
              <MenuInfo
                icon={<Clock className="h-[18px] w-[18px]" />}
                title="โซนเวลา"
                sub="ตอนนี้ใช้เวลาไทย ตัวเลือกโซนอื่นกำลังจะมา"
                value="Bangkok"
              />
            </MenuGroup>

            <ResetCard />
            <DeleteCard />
          </>
        )}
      </div>

      {sheet === "recurring" && me.data ? (
        <Sheet title="รายการประจำ" onClose={() => setSheet(null)}>
          <RecurringCard me={me.data} embedded />
        </Sheet>
      ) : null}
      {sheet === "memory" && me.data ? (
        <Sheet title="จัดหมวดด้วยความจำ" onClose={() => setSheet(null)}>
          <MemoryCard me={me.data} embedded />
        </Sheet>
      ) : null}
      {sheet === "payments" && me.data ? (
        <PaymentHistorySheet items={me.data.payments.history} onClose={() => setSheet(null)} />
      ) : null}
    </main>
  );
}
