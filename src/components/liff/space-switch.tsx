"use client";

import { ChevronDown } from "lucide-react";
import { useApi } from "@/components/liff/liff-provider";
import type { OwnedGroup } from "@/lib/owned-groups";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/**
 * The chip at the top of the vault and reminders pages: "ส่วนตัว", or a group. Someone who owns no
 * ledger and was not sent to a group sees the plain chip; anyone else picks from their own and the
 * groups they own. A group they were sent to but do not own (a member's link) stays on the list.
 */
export function SpaceSwitch({
  groupId,
  onChange,
  className,
}: {
  groupId: string | null;
  onChange: (groupId: string | null) => void;
  className?: string;
}) {
  const groups = useApi<{ items: OwnedGroup[] }>("/api/groups");
  const items = groups.data?.items ?? [];
  const chip = cn(
    "rounded-full px-3 py-1 text-xs font-semibold",
    groupId ? "bg-[#FCE9C8] text-[#7A4A06]" : "bg-[#E1F3DB] text-[#2F672B]",
    className,
  );

  if (!groupId && items.length === 0) return <span className={chip}>{t("ส่วนตัว")}</span>;

  const options = [
    ...items.map((g) => ({
      id: g.id,
      label: t("กลุ่ม: {0}{1}", g.name, g.isActive ? "" : t(" (ปิดแล้ว)")),
    })),
    ...(groupId && !items.some((g) => g.id === groupId)
      ? [{ id: groupId, label: t("กลุ่มนี้") }]
      : []),
  ];
  return (
    <label className={cn(chip, "relative flex min-w-0 max-w-[60%] items-center gap-1 pr-2")}>
      <span className="sr-only">{t("ดูของส่วนตัวหรือของกลุ่ม")}</span>
      <select
        value={groupId ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 max-w-full appearance-none truncate bg-transparent pr-4 font-semibold outline-none"
      >
        <option value="">{t("ส่วนตัว")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" aria-hidden />
    </label>
  );
}
