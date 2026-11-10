"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { t } from "@/lib/i18n";

/**
 * Bottom sheet dialog: closes on Escape and on backdrop tap. The title (and `header`, for a search
 * field and the like) stays put; only the content below it scrolls.
 */
export function Sheet({
  title,
  onClose,
  header,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Kept under the title while the content scrolls. */
  header?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-foreground/40 wide:items-center wide:justify-center wide:p-6"
      role="dialog"
      aria-modal
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-auto flex max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl wide:max-w-lg wide:rounded-3xl bg-surface text-foreground">
        <div className="shrink-0 space-y-3 px-4 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label={t("ปิด")} className="h-11 w-11">
              <X className="mx-auto h-5 w-5" aria-hidden />
            </button>
          </div>
          {header}
        </div>
        <div
          data-sheet-body
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
