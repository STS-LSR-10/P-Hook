"use client";

import { Archive, ChartColumn, House, List, Settings, Tags } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-md grid-cols-6">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname?.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted",
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
