"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The tint of a section's icon tile. */
export type SectionTone = "primary" | "sky" | "warm" | "indigo" | "danger";

const TONE: Record<SectionTone, string> = {
  primary: "bg-primary-soft text-primary",
  sky: "bg-sky-500/10 text-sky-600",
  warm: "bg-warn-soft text-warn",
  indigo: "bg-indigo-500/10 text-indigo-600",
  danger: "bg-rose-500/10 text-expense",
};

/** One group of settings that opens and closes; its rows stay in the page while closed (hidden). */
export function SettingsSection({
  id,
  icon,
  title,
  sub,
  badge,
  tone = "primary",
  open,
  onToggle,
  hidden = false,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  sub: string;
  /** A short summary on the right (wide screens only, so a phone row never overflows). */
  badge?: string;
  tone?: SectionTone;
  open: boolean;
  onToggle: () => void;
  /** Left out by a search (kept in the page so nothing typed in it is lost). */
  hidden?: boolean;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <div
      hidden={hidden}
      className={cn(
        "overflow-hidden rounded-3xl border bg-surface shadow-card",
        danger ? "border-rose-500/30" : "border-border",
      )}
    >
      <button
        type="button"
        id={`${id}-button`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        // named by the title alone, so it never shares a name with a row inside
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-sub`}
        onClick={onToggle}
        className="flex min-h-16 w-full items-center gap-3 p-4 text-left"
      >
        <span
          aria-hidden
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
            TONE[tone],
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span
            id={`${id}-title`}
            className={cn("block text-sm font-bold", danger && "text-expense")}
          >
            {title}
          </span>
          <span id={`${id}-sub`} className="block text-xs text-muted">
            {sub}
          </span>
        </span>
        {badge ? (
          <span className="hidden shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted sm:inline-block">
            {badge}
          </span>
        ) : null}
        <span
          aria-hidden
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-muted transition-transform",
            open && "rotate-180",
          )}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-button`}
        hidden={!open}
        className={cn(
          "space-y-3 border-t bg-background px-4 py-3.5",
          danger ? "border-rose-500/20" : "border-border",
        )}
      >
        {children}
      </div>
    </div>
  );
}
