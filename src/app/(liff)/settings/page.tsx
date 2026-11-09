"use client";

import {
  Brain,
  CalendarClock,
  Clock,
  Coins,
  Crown,
  Gauge,
  Gift,
  Languages,
  Lightbulb,
  MessageCircle,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Search,
  Settings2,
  Users,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useApi, useLiff } from "@/components/liff/liff-provider";
import { FeedbackSheet } from "@/components/liff/settings/feedback-sheet";
import { GroupManageCard } from "@/components/liff/settings/group-manage-card";
import { DeleteCard } from "@/components/liff/settings/delete-card";
import { MemoryCard } from "@/components/liff/settings/memory-card";
import { MenuButton, MenuGroup, MenuLink } from "@/components/liff/settings/menu";
import { GoogleCalendarCard } from "@/components/liff/settings/google-calendar-card";
import { StyleCard } from "@/components/liff/settings/style-card";
import { NotificationsCard } from "@/components/liff/settings/notifications-card";
import { PaymentHistorySheet } from "@/components/liff/settings/payment-history-sheet";
import { CallNameCard } from "@/components/liff/settings/call-name-card";
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
import { CurrencySheet } from "@/components/liff/settings/currency-sheet";
import { LanguageSheet } from "@/components/liff/settings/language-sheet";
import { ZoneSheet } from "@/components/liff/settings/zone-sheet";
import { DEFAULT_CURRENCY, currencyLabel } from "@/lib/currency";
import { DEFAULT_ZONE, ZONES } from "@/lib/zone";
import { t } from "@/lib/i18n";

const zoneCity = (zone?: string) =>
  ZONES.find((z) => z.id === (zone ?? DEFAULT_ZONE))?.city ?? zone ?? "Bangkok";

const CONFIRM_OPTIONS: { value: Settings["confirm_style"]; label: string; hint: string }[] = [
  { value: "full", label: t("เต็ม"), hint: t("การ์ดพร้อมปุ่มแก้ไข/ลบ") },
  { value: "short", label: t("สั้น"), hint: t("ข้อความบรรทัดเดียว") },
  { value: "off", label: t("ไม่ส่ง"), hint: t("จดเงียบ ๆ ไม่ตอบกลับ") },
];

const CYCLE_OPTIONS: { value: Settings["budget_cycle"]; label: string }[] = [
  { value: "monthly", label: t("รายเดือน") },
  { value: "weekly", label: t("รายสัปดาห์") },
];

const START_DAYS = Array.from({ length: MAX_START_DAY }, (_, i) => i + 1);

type SectionId = "bot" | "money" | "groups" | "member" | "general" | "privacy";

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
    title: t("การแจ้งเตือนและแชทบอท"),
    sub: t("การ์ดหลังจด, ธีม, นิสัยบอท, สรุปอัตโนมัติ"),
    tone: "primary",
    icon: <MessageCircle className="h-5 w-5" />,
    words: t(
      "การ์ดยืนยันหลังจด เต็ม สั้น ไม่ส่ง แนบรูป ธีม สี การ์ด นิสัยบอท น้ำเสียง แจ้งเตือน เตือนจด ประจำวัน สรุปรายสัปดาห์ สรุปรายเดือน",
    ),
  },
  {
    id: "money",
    title: t("รอบงบ บัญชี และเป้าหมาย"),
    sub: t("รอบงบ, กระเป๋าเงิน, ออมเงิน, บิล, รายการประจำ"),
    tone: "sky",
    icon: <Wallet className="h-5 w-5" />,
    words: t(
      "รอบงบ งบ รายเดือน รายสัปดาห์ วันเริ่ม กระเป๋าเงิน บัญชี บัตร เป้าหมาย ออม บิล รายการประจำ ความจำ หมวด สลิป ผู้รับ",
    ),
  },
  {
    id: "groups",
    title: t("จัดการกลุ่ม"),
    sub: t("สรุป, รายการจด, บิลค้างจ่าย, ตั้งเวลาทวงตัง"),
    tone: "sky",
    icon: <Users className="h-5 w-5" />,
    words: t("กลุ่ม สมุดกลุ่ม จด สรุป ค้างจ่าย เคลียร์ ยอดค้าง ทวงตัง ทวงเงิน หารบิล เตือน"),
  },
  {
    id: "member",
    title: t("สมาชิกและสิทธิประโยชน์"),
    sub: t("อัปเกรด, ชวนเพื่อน, แลกเหรียญ, ประวัติชำระเงิน"),
    tone: "warm",
    icon: <Crown className="h-5 w-5" />,
    words: t(
      "สมาชิก แผน อัปเกรด ต่ออายุ ชวนเพื่อน เหรียญ แต้ม แลก ประวัติการชำระเงิน ใบเสร็จ โควตา",
    ),
  },
  {
    id: "general",
    title: t("ตั้งค่าทั่วไป"),
    sub: t("ภาษา, สกุลเงิน, โซนเวลา"),
    tone: "indigo",
    icon: <Settings2 className="h-5 w-5" />,
    words: t("ทั่วไป ภาษา สกุลเงิน บาท โซนเวลา เวลา"),
  },
  {
    id: "privacy",
    title: t("จัดการข้อมูลและความเป็นส่วนตัว"),
    sub: t("ล้างข้อมูล, ลบเฉพาะเดือน, ลบบัญชี, นโยบาย"),
    tone: "danger",
    icon: <ShieldAlert className="h-5 w-5" />,
    words: t("ข้อมูล ความเป็นส่วนตัว ล้าง ลบ เดือน รีเซ็ต นโยบาย ข้อกำหนด บัญชี"),
  },
];

const matches = (section: SectionDef, term: string) =>
  `${section.title} ${section.sub} ${section.words}`.toLowerCase().includes(term);

export default function SettingsPage() {
  const { api } = useLiff();
  const settings = useApi<Settings>("/api/settings");
  const me = useApi<Me>("/api/me");
  // the card for LINE group ledgers is only there for someone who owns one
  const owned = useApi<{ items: { id: string; name: string; isActive: boolean }[] }>("/api/groups");
  const groups = owned.data?.items ?? [];
  const sections = SECTIONS.filter((s) => s.id !== "groups" || groups.length > 0);
  const [override, setOverride] = useState<Settings | null>(null);
  // shown in the section whose setting was changed, so it is never off-screen
  const [notice, setNotice] = useState<{ at: SectionId; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<
    "recurring" | "memory" | "payments" | "zone" | "currency" | "language" | "feedback" | null
  >(null);
  const [opened, setOpened] = useState<Set<SectionId>>(new Set());
  // sections closed by hand while a search is on (it opens everything it finds)
  const [closedInSearch, setClosedInSearch] = useState<Set<SectionId>>(new Set());
  const [search, setSearch] = useState("");

  // /settings#recurring (from the entries page) opens the recurring list straight away
  useEffect(() => {
    if (window.location.hash === "#recurring") {
      setSheet("recurring");
      setOpened(new Set(["money"])); // closing the sheet shows the row it came from
    }
  }, []);

  const current = override ?? settings.data;
  const user = me.data;

  async function save(at: SectionId, patch: Partial<Settings>) {
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
      setNotice({ at, text: t("บันทึกแล้ว") });
    } catch (e) {
      setOverride(previous);
      setNotice({ at, text: e instanceof Error ? e.message : t("บันทึกไม่สำเร็จ") });
    } finally {
      setSaving(false);
    }
  }

  const term = search.trim().toLowerCase();
  const found = term ? sections.filter((s) => matches(s, term)) : sections;
  // a search opens what it finds; otherwise each section is as the person left it
  const isOpen = (id: SectionId) => (term ? !closedInSearch.has(id) : opened.has(id));
  const allOpen = sections.every((s) => opened.has(s.id));
  const flip = (set: Set<SectionId>, id: SectionId) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const toggle = (id: SectionId) =>
    term ? setClosedInSearch((now) => flip(now, id)) : setOpened((now) => flip(now, id));
  const noticeIn = (at: SectionId) =>
    notice?.at === at ? (
      <p role="status" className="rounded-2xl bg-primary-soft px-4 py-2 text-sm text-primary">
        {notice.text}
      </p>
    ) : null;

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
          ? t("รอบรายสัปดาห์")
          : t("รอบวันที่ {0}", current.cycle_start_day);
      case "groups":
        return t("{0} กลุ่ม", groups.length);
      case "member":
        return t("สมาชิก {0}", PLAN_LABEL[user.plan]);
      case "general":
        return `${settings.data?.locale === "en" ? "English" : t("ไทย")} • ${settings.data?.currency ?? DEFAULT_CURRENCY} • ${zoneCity(settings.data?.timezone)}`;
      case "privacy":
        return t("ระวัง");
    }
  }

  function contentOf(id: SectionId, data: Settings, person: Me): ReactNode {
    switch (id) {
      case "bot":
        return (
          <>
            {noticeIn("bot")}
            <section className={cardClass} aria-label={t("การ์ดยืนยันหลังจด")}>
              <div>
                <h3 className="text-sm font-semibold">{t("การ์ดยืนยันหลังจด")}</h3>
                <p className="text-xs text-muted">{t("รูปแบบข้อความสรุปหลังจดบันทึกใน LINE")}</p>
              </div>
              <div
                className="grid grid-cols-3 gap-2"
                role="radiogroup"
                aria-label={t("รูปแบบการ์ด")}
              >
                {CONFIRM_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={data.confirm_style === o.value}
                    disabled={saving}
                    onClick={() => save("bot", { confirm_style: o.value })}
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
            <CallNameCard me={person} settings={data} onSaved={setOverride} />
            <NotificationsCard me={person} settings={data} onSaved={setOverride} />
            <GoogleCalendarCard />
            <StyleCard />
          </>
        );
      case "money":
        return (
          <>
            {noticeIn("money")}
            <section className={cardClass} aria-label={t("รอบงบ")}>
              <div>
                <h3 className="text-sm font-semibold">{t("รอบงบ")}</h3>
                <p className="text-xs text-muted">{t("ระยะเวลาการคำนวณสรุปยอดรายรับและรายจ่าย")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("ชนิดรอบงบ")}>
                {CYCLE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={data.budget_cycle === o.value}
                    disabled={saving}
                    onClick={() => save("money", { budget_cycle: o.value })}
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
                  <span className="font-medium">{t("เริ่มรอบทุกวันที่")}</span>
                  <select
                    value={data.cycle_start_day}
                    disabled={saving}
                    onChange={(e) => save("money", { cycle_start_day: Number(e.target.value) })}
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
                  {t("รอบสัปดาห์เริ่มทุกวันจันทร์")}
                </p>
              )}
            </section>
            <MenuGroup label={t("จัดการฟีเจอร์")}>
              <MenuLink
                href="/wallets"
                ariaLabel={t("กระเป๋าเงิน")}
                icon={<Wallet className="h-[18px] w-[18px]" />}
                title={t("กระเป๋าเงิน")}
                sub={t("แยกเงินสด บัญชี บัตร เงินเก็บ · มีได้ {0} ใบ", person.limits.wallets)}
              />
              <MenuLink
                href="/goals"
                ariaLabel={t("เป้าหมายการออม")}
                icon={<PiggyBank className="h-[18px] w-[18px]" />}
                title={t("เป้าหมายการออม")}
                sub={t("กระปุกออมสิน ตั้งเป้า ดูความคืบหน้า · Starter ขึ้นไป")}
              />
              <MenuLink
                href="/bills"
                ariaLabel={t("บิลที่ต้องจ่าย")}
                icon={<CalendarClock className="h-[18px] w-[18px]" />}
                title={t("เตือนจ่ายบิล")}
                sub={t("บอทเตือนก่อนวันครบกำหนด · แผน Pro ขึ้นไป")}
              />
              <MenuButton
                onClick={() => setSheet("recurring")}
                ariaLabel={t("รายการประจำ")}
                icon={<Repeat className="h-[18px] w-[18px]" />}
                title={t("รายการประจำ")}
                sub={t("จดให้อัตโนมัติ เช่น ค่าเน็ต ค่าเช่า เงินเดือน")}
                badge={
                  <span className="flex items-center gap-0.5 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                    <Plus className="h-3 w-3" aria-hidden /> {t("เพิ่ม")}
                  </span>
                }
              />
              <MenuButton
                onClick={() => setSheet("memory")}
                ariaLabel={t("จัดหมวดด้วยความจำ")}
                icon={<Brain className="h-[18px] w-[18px]" />}
                title={t("จัดหมวดด้วยความจำ")}
                sub={t('เมื่อแก้หมวดสลิป บอทจะจำคู่ "ผู้รับ → หมวด" ไว้ใช้ครั้งต่อไป')}
              />
            </MenuGroup>
          </>
        );
      case "groups":
        return <GroupManageCard groups={groups} />;
      case "member":
        return (
          <>
            <MenuGroup label={t("สมาชิก")}>
              <MenuLink
                href="/upgrade"
                tone="warm"
                icon={<Crown className="h-[18px] w-[18px]" />}
                title={person.plan === "free" ? t("อัปเกรด") : t("อัปเกรด / ต่ออายุ")}
                ariaLabel={t("อัปเกรด")}
                sub={t("ปลดล็อกฟีเจอร์พรีเมียมทั้งหมด")}
              />
              <MenuLink
                href="/settings/quota"
                icon={<Gauge className="h-[18px] w-[18px]" />}
                title={t("โควตาการใช้งาน")}
                sub={t("ดูว่าใช้ไปเท่าไรจากโควตาของแผน")}
              />
              <MenuLink
                href="/invite"
                icon={<Gift className="h-[18px] w-[18px]" />}
                title={t("ชวนเพื่อน")}
                sub={t("รหัสชวนของคุณ และรับเหรียญสะสมทั้งคู่")}
                value={person.referrals > 0 ? t("{0} คน", person.referrals) : undefined}
              />
              <MenuButton
                onClick={() => setSheet("payments")}
                icon={<Receipt className="h-[18px] w-[18px]" />}
                title={t("ประวัติการชำระเงิน")}
                sub={
                  person.payments.history.length === 0
                    ? t("ดูใบเสร็จและรอบต่ออายุสมาชิก")
                    : t("ดูใบเสร็จและรอบต่ออายุสมาชิก ({0} รายการ)", person.payments.history.length)
                }
              />
            </MenuGroup>
            <RedeemCard me={person} onChanged={me.reload} />
          </>
        );
      case "general":
        return (
          <MenuGroup label={t("ทั่วไป")}>
            <MenuButton
              onClick={() => setSheet("language")}
              icon={<Languages className="h-[18px] w-[18px]" />}
              title={t("ภาษา")}
              value={settings.data?.locale === "en" ? "English" : t("ไทย")}
            />
            <MenuButton
              onClick={() => setSheet("currency")}
              icon={<Coins className="h-[18px] w-[18px]" />}
              title={t("สกุลเงิน")}
              sub={t("ยอดเงินทั้งหมดแสดงเป็นสกุลนี้")}
              value={currencyLabel(settings.data?.currency ?? DEFAULT_CURRENCY)}
            />
            <MenuButton
              onClick={() => setSheet("zone")}
              icon={<Clock className="h-[18px] w-[18px]" />}
              title={t("โซนเวลา")}
              sub={t("เวลาเตือน การตัดวัน และรอบงบ คิดตามโซนนี้")}
              value={zoneCity(settings.data?.timezone)}
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
      <PageHeader title={t("ตั้งค่า")} />
      <div className="space-y-4 px-4 pb-4 wide:px-0">
        {loading ? (
          <LoadingBlock rows={4} />
        ) : error || !current || !user ? (
          <ErrorState
            message={error ?? t("โหลดไม่สำเร็จ")}
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setClosedInSearch(new Set());
                }}
                aria-label={t("ค้นหาการตั้งค่า")}
                placeholder={t("ค้นหาการตั้งค่า เช่น แจ้งเตือน, ธีม, สรุป")}
                className="h-11 w-full rounded-2xl border border-border bg-surface pl-10 pr-4 text-sm outline-none focus:border-primary"
              />
            </div>

            <ProfileCard me={user} />

            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-semibold text-muted">{t("หมวดการตั้งค่า")}</h2>
              {term ? null : (
                <button
                  type="button"
                  onClick={() =>
                    setOpened(allOpen ? new Set() : new Set(sections.map((s) => s.id)))
                  }
                  className="h-8 text-xs font-semibold text-primary"
                >
                  {allOpen ? t("ย่อทั้งหมด") : t("เปิดทั้งหมด")}
                </button>
              )}
            </div>

            {found.length === 0 ? (
              <EmptyState
                title={t("ไม่พบการตั้งค่า")}
                hint={t('ไม่มีหมวดที่ตรงกับ "{0}"', search.trim())}
              />
            ) : null}
            {/* every section stays in the page, so a search never loses what was typed in one */}
            <div className="space-y-3 wide:grid wide:grid-cols-2 wide:items-start wide:gap-3 wide:space-y-0">
              {sections.map((s) => (
                <Fragment key={s.id}>
                  <SettingsSection
                    hidden={!found.includes(s)}
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
                  {/* right after "ตั้งค่าทั่วไป": a way to tell the team what you would like */}
                  {s.id === "general" && !term ? (
                    <MenuGroup label={t("เสนอแนะ")}>
                      <MenuButton
                        onClick={() => setSheet("feedback")}
                        icon={<Lightbulb className="h-[18px] w-[18px]" />}
                        title={t("💡 เสนอแนะ")}
                        sub={t("บอกทีมงานว่าอยากให้มีหรือปรับอะไร")}
                      />
                    </MenuGroup>
                  ) : null}
                </Fragment>
              ))}
            </div>
          </>
        )}
      </div>
      {sheet === "recurring" && me.data ? (
        <Sheet title={t("รายการประจำ")} onClose={() => setSheet(null)}>
          <RecurringCard me={me.data} embedded />
        </Sheet>
      ) : null}
      {sheet === "memory" && me.data ? (
        <Sheet title={t("จัดหมวดด้วยความจำ")} onClose={() => setSheet(null)}>
          <MemoryCard me={me.data} embedded />
        </Sheet>
      ) : null}
      {sheet === "feedback" ? <FeedbackSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "language" ? (
        <LanguageSheet current={settings.data?.locale} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "currency" ? (
        <CurrencySheet current={settings.data?.currency} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "zone" ? (
        <ZoneSheet current={settings.data?.timezone} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "payments" && me.data ? (
        <PaymentHistorySheet items={me.data.payments.history} onClose={() => setSheet(null)} />
      ) : null}
    </main>
  );
}
