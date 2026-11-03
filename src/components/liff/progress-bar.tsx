import { budgetState, percentUsed } from "@/lib/budget";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";

const STATE_STYLE = {
  ok: { bar: "bg-primary", text: "text-muted", label: "" },
  warn: { bar: "bg-accent", text: "text-foreground", label: "ใกล้ครบงบ" },
  over: { bar: "bg-expense", text: "text-expense", label: "เกินงบ" },
} as const;

/** Spending vs budget. Color is never the only signal: the % and a label are always shown. */
export function ProgressBar({
  spentSatang,
  limitSatang,
  label = "การใช้งบ",
}: {
  spentSatang: number;
  limitSatang: number;
  /** Accessible name; give each bar on a page its own. */
  label?: string;
}) {
  const state = budgetState(spentSatang, limitSatang);
  const pct = percentUsed(spentSatang, limitSatang);
  const style = STATE_STYLE[state];
  return (
    <div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        aria-label={label}
        className="h-2.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn("h-full rounded-full", style.bar)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <p className={cn("num mt-1 text-xs", style.text)}>
        ใช้ไป {money(spentSatang)} จาก {money(limitSatang)} ({pct}%)
        {style.label ? ` · ${style.label}` : ""}
      </p>
    </div>
  );
}
