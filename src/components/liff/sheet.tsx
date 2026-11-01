"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

/** Bottom sheet dialog: closes on Escape and on backdrop tap. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end bg-foreground/40"
      role="dialog"
      aria-modal
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-auto max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-surface p-4 text-foreground pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="ปิด" className="h-11 w-11">
            <X className="mx-auto h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
