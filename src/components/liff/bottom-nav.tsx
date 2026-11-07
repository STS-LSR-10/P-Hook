"use client";

import { Archive, ChartColumn, House, List, Settings, Tags } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

const TABS = [
  { href: "/summary", label: t("สรุป"), Icon: House },
  { href: "/analytics", label: t("วิเคราะห์"), Icon: ChartColumn },
  { href: "/budgets", label: t("หมวด/งบ"), Icon: Tags },
  { href: "/transactions", label: t("รายการ"), Icon: List },
  { href: "/vault", label: t("คลัง"), Icon: Archive },
  { href: "/settings", label: t("ตั้งค่า"), Icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("เมนูหลัก")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:inset-y-0 lg:right-auto lg:w-60 lg:border-r lg:border-t-0 lg:pb-0"
    >
      <div className="hidden items-center gap-3 px-5 pb-4 pt-6 lg:flex">
        <Logo size={40} />
        <span className="text-lg font-bold">P&apos;Hook</span>
      </div>
      <ul className="mx-auto grid max-w-md grid-cols-6 lg:flex lg:max-w-none lg:flex-col lg:gap-1 lg:px-3">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  "lg:h-12 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-4 lg:text-sm",
                  active ? "text-primary lg:bg-primary-soft" : "text-muted lg:hover:bg-background",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
