import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border", className)} aria-hidden />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="กำลังโหลด" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Logo size={88} />
      <p className="text-base font-semibold">{title}</p>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Logo size={96} variant="error" />
      <p className="text-base font-semibold">เกิดข้อผิดพลาด</p>
      <p className="text-sm text-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 h-11 rounded-2xl bg-primary px-5 text-sm font-semibold text-surface"
        >
          ลองอีกครั้ง
        </button>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between px-4 pb-2 pt-5">
      <h1 className="text-xl font-bold">{title}</h1>
      {right}
    </header>
  );
}
