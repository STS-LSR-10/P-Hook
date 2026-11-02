"use client";

import {
  Brain,
  CalendarClock,
  Clock,
  Coins,
  Crown,
  Gift,
  Languages,
  MessageCircle,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Search,
  Settings2,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { DeleteCard } from "@/components/liff/settings/delete-card";
import { MemoryCard } from "@/components/liff/settings/memory-card";
import { MenuButton, MenuGroup, MenuInfo, MenuLink } from "@/components/liff/settings/menu";
import { NotificationsCard } from "@/components/liff/settings/notifications-card";
import { PaymentHistorySheet } from "@/components/liff/settings/payment-history-sheet";
import { PersonalizeCard } from "@/components/liff/settings/personalize-card";
import { PhotoPromptCard } from "@/components/liff/settings/photo-prompt-card";
import { ProfileCard } from "@/components/liff/settings/profile-card";
import { RecurringCard } from "@/components/liff/settings/recurring-card";
import { RedeemCard } from "@/components/liff/settings/redeem-card";
import { ResetCard } from "@/components/liff/settings/reset-card";
import { SettingsSection, type SectionTone } from "@/components/liff/settings/section";
import { cardClass, type Me, type Settings } from "@/components/liff/settings/types";
import { Sheet } from "@/components/liff/sheet";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/liff/states";
import { MAX_START_DAY } from "@/lib/budget-cycle";
import {
  DEFAULT_PERSONA,
  DEFAULT_THEME,
  isPersonaId,
  isThemeId,
  PERSONAS,
  THEMES,
} from "@/lib/personalize";
import { PLAN_LABEL } from "@/lib/plan";
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

type SectionId = "bot" | "money" | "member" | "general" | "privacy";

interface SectionDef {
  id: SectionId;
  title: string;
  sub: string;
  tone: SectionTone;
  icon: ReactNode;
  /** Every word a search should find this section by (the names of the settings inside). */
  words: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: "bot",
    title: "การแจ้งเตือนและแชทบอท",
    sub: "การ์ดหลังจด, ธีม, นิสัยบอท, สรุปอัตโนมัติ",
    tone: "primary",
    icon: <MessageCircle className="h-5 w-5" />,
    words:
      "การ์ดยืนยันหลังจด เต็ม สั้น ไม่ส่ง แนบรูป ธีม สี การ์ด นิสัยบอท น้ำเสียง แจ้งเตือน เตือนจด ประจำวัน สรุปรายสัปดาห์ สรุปรายเดือน",
  },
  {
    id: "money",
    title: "รอบงบ บัญชี และเป้าหมาย",
    sub: "รอบงบ, กระเป๋าเงิน, ออมเงิน, บิล, รายการประจำ",
    tone: "sky",
    icon: <Wallet className="h-5 w-5" />,
    words:
      "รอบงบ งบ รายเดือน รายสัปดาห์ วันเริ่ม กระเป๋าเงิน บัญชี บัตร เป้าหมาย ออม บิล รายการประจำ ความจำ หมวด",
  },
  {
    id: "member",
    title: "สมาชิกและสิทธิประโยชน์",
    sub: "อัปเกรด, ชวนเพื่อน, แลกเหรียญ, ประวัติชำระเงิน",
    tone: "warm",
    icon: <Crown className="h-5 w-5" />,
    words: "สมาชิก แผน อัปเกรด ต่ออายุ ชวนเพื่อน เหรียญ แต้ม แลก ประวัติการชำระเงิน ใบเสร็จ โควตา",
  },
  {
    id: "general",
    title: "ตั้งค่าทั่วไป",
    sub: "ภาษา, สกุลเงิน, โซนเวลา",
    tone: "indigo",
    icon: <Settings2 className="h-5 w-5" />,
    words: "ทั่วไป ภาษา สกุลเงิน บาท โซนเวลา เวลา",
  },
  {
    id: "privacy",
    title: "จัดการข้อมูลและความเป็นส่วนตัว",
    sub: "ล้างข้อมูล, ลบเฉพาะเดือน, ลบบัญชี, นโยบาย",
    tone: "danger",
    icon: <ShieldAlert className="h-5 w-5" />,
    words: "ข้อมูล ความเป็นส่วนตัว ล้าง ลบ เดือน รีเซ็ต นโยบาย ข้อกำหนด บัญชี",
  },
];

const matches = (section: SectionDef, term: string) =>
  `${section.title} ${section.sub} ${section.words}`.toLowerCase().includes(term);

export default function SettingsPage() {
  const { api } = useLiff();
  const settings = useApi<Settings>("/api/settings");
  const me = useApi<Me>("/api/me");
  const [override, setOverride] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<"recurring" | "memory" | "payments" | null>(null);
  const [opened, setOpened] = useState<Set<SectionId>>(new Set());
  const [search, setSearch] = useState("");

  // /settings#recurring (from the entries page) opens the recurring list straight away
  useEffect(() => {
    if (window.location.hash === "#recurring") setSheet("recurring");
  }, []);

  const current = override ?? settings.data;
  const user = me.data;

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

  const term = search.trim().toLowerCase();
  const shown = term ? SECTIONS.filter((s) => matches(s, term)) : SECTIONS;
  // a search opens what it finds; otherwise each section is as the person left it
  const isOpen = (id: SectionId) => (term ? true : opened.has(id));
  const allOpen = SECTIONS.every((s) => opened.has(s.id));
  const toggle = (id: SectionId) =>
    setOpened((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const loading = settings.loading || me.loading;
  const error = settings.error ?? me.error;

  function badgeOf(id: SectionId): string | undefined {
    if (!current || !user) return undefined;
    switch (id) {
      case "bot": {
        const persona = isPersonaId(current.bot_persona) ? current.bot_persona : DEFAULT_PERSONA;
        const theme = isThemeId(current.card_theme) ? current.card_theme : DEFAULT_THEME;
        return `${PERSONAS[persona].label} • ${THEMES[theme].label}`;
      }
      case "money":
        return current.budget_cycle === "weekly"
          ? "รอบรายสัปดาห์"
          : `รอบวันที่ ${current.cycle_start_day}`;
      case "member":
        return `สมาชิก ${PLAN_LABEL[user.plan]}`;
      case "general":
        return "ไทย • บาท (฿)";
      case "privacy":
        return "ระวัง";
    }
  }

  function contentOf(id: SectionId, data: Settings, person: Me): ReactNode {
    switch (id) {
      case "bot":
        return (
          <>
            <section className={cardClass} aria-label="การ์ดยืนยันหลังจด">
              <div>
                <h3 className="text-sm font-semibold">การ์ดยืนยันหลังจด</h3>
                <p className="text-xs text-muted">รูปแบบข้อความสรุปหลังจดบันทึกใน LINE</p>
              </div>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="รูปแบบการ์ด">
                {CONFIRM_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={data.confirm_style === o.value}
                    disabled={saving}
                    onClick={() => save({ confirm_style: o.value })}
                    className={cn(
                      "min-h-14 rounded-2xl border px-2 py-2 text-center",
                      data.confirm_style === o.value
                        ? "border-2 border-primary bg-primary-soft text-primary"
                        : "border-border bg-surface text-muted",
                    )}
                  >
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-[11px] leading-tight">{o.hint}</span>
                  </button>
                ))}
              </div>
            </section>
            <PhotoPromptCard me={person} settings={data} onSaved={setOverride} />
            <PersonalizeCard me={person} settings={data} onSaved={setOverride} />
            <NotificationsCard me={person} settings={data} onSaved={setOverride} />
          </>
        );
      case "money":
        return (
          <>
            <section className={cardClass} aria-label="รอบงบ">
              <div>
                <h3 className="text-sm font-semibold">รอบงบ</h3>
                <p className="text-xs text-muted">ระยะเวลาการคำนวณสรุปยอดรายรับและรายจ่าย</p>
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ชนิดรอบงบ">
                {CYCLE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={data.budget_cycle === o.value}
                    disabled={saving}
                    onClick={() => save({ budget_cycle: o.value })}
                    className={cn(
                      "h-11 rounded-2xl border text-sm font-semibold",
                      data.budget_cycle === o.value
                        ? "border-2 border-primary bg-primary-soft text-primary"
                        : "border-border bg-surface text-muted",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {data.budget_cycle === "monthly" ? (
                <label className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
                  <span className="font-medium">เริ่มรอบทุกวันที่</span>
                  <select
                    value={data.cycle_start_day}
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
            <MenuGroup label="จัดการฟีเจอร์">
              <MenuLink
                href="/wallets"
                ariaLabel="กระเป๋าเงิน"
                icon={<Wallet className="h-[18px] w-[18px]" />}
                title="กระเป๋าเงิน"
                sub={`แยกเงินสด บัญชี บัตร เงินเก็บ · มีได้ ${person.limits.wallets} ใบ`}
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
          </>
        );
      case "member":
        return (
          <>
            <MenuGroup label="สมาชิก">
              <MenuLink
                href="/upgrade"
                tone="warm"
                icon={<Crown className="h-[18px] w-[18px]" />}
                title={person.plan === "free" ? "อัปเกรด" : "อัปเกรด / ต่ออายุ"}
                ariaLabel="อัปเกรด"
                sub="ปลดล็อกฟีเจอร์พรีเมียมทั้งหมด"
              />
              <MenuLink
                href="/invite"
                icon={<Gift className="h-[18px] w-[18px]" />}
                title="ชวนเพื่อน"
                sub="รหัสชวนของคุณ และรับเหรียญสะสมทั้งคู่"
                value={person.referrals > 0 ? `${person.referrals} คน` : undefined}
              />
              <MenuButton
                onClick={() => setSheet("payments")}
                icon={<Receipt className="h-[18px] w-[18px]" />}
                title="ประวัติการชำระเงิน"
                sub={
                  person.payments.history.length === 0
                    ? "ดูใบเสร็จและรอบต่ออายุสมาชิก"
                    : `ดูใบเสร็จและรอบต่ออายุสมาชิก (${person.payments.history.length} รายการ)`
                }
              />
            </MenuGroup>
            <RedeemCard me={person} onChanged={me.reload} />
          </>
        );
      case "general":
        return (
          <MenuGroup label="ทั่วไป">
            <MenuInfo icon={<Languages className="h-[18px] w-[18px]" />} title="ภาษา" value="ไทย" />
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
        );
      case "privacy":
        return (
          <>
            <ResetCard />
            <DeleteCard />
          </>
        );
    }
  }

  return (
    <main>
      <PageHeader title="ตั้งค่า" />
      <div className="space-y-4 px-4 pb-4">
        {loading ? (
          <LoadingBlock rows={4} />
        ) : error || !current || !user ? (
          <ErrorState
            message={error ?? "โหลดไม่สำเร็จ"}
            onRetry={() => {
              settings.reload();
              me.reload();
            }}
          />
        ) : (
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="ค้นหาการตั้งค่า"
                placeholder="ค้นหาการตั้งค่า เช่น แจ้งเตือน, ธีม, สรุป"
                className="h-11 w-full rounded-2xl border border-border bg-surface pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </div>

            <ProfileCard me={user} />

            {notice ? (
              <p
                role="status"
                className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary"
              >
                {notice}
              </p>
            ) : null}

            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold text-muted">หมวดการตั้งค่า</h2>
              {term ? null : (
                <button
                  type="button"
                  onClick={() =>
                    setOpened(allOpen ? new Set() : new Set(SECTIONS.map((s) => s.id)))
                  }
                  className="h-8 text-xs font-semibold text-primary"
                >
                  {allOpen ? "ย่อทั้งหมด" : "เปิดทั้งหมด"}
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <EmptyState title="ไม่พบการตั้งค่า" hint={`ไม่มีหมวดที่ตรงกับ "${search.trim()}"`} />
            ) : (
              <div className="space-y-3">
                {shown.map((s) => (
                  <SettingsSection
                    key={s.id}
                    id={`settings-${s.id}`}
                    icon={s.icon}
                    title={s.title}
                    sub={s.sub}
                    tone={s.tone}
                    badge={badgeOf(s.id)}
                    open={isOpen(s.id)}
                    onToggle={() => toggle(s.id)}
                  >
                    {contentOf(s.id, current, user)}
                  </SettingsSection>
                ))}
              </div>
            )}
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
