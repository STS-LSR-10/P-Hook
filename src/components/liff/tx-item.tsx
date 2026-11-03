import { formatForeign, formatRate } from "@/lib/fx";
import type { ReactNode } from "react";
import type { TxDto } from "@/lib/dto";
import { money } from "@/lib/money";
import { formatThaiDate } from "@/lib/thai-date";
import { categoryLabel } from "@/lib/category-emoji";
import { cn } from "@/lib/utils";
import { t as tr } from "@/lib/i18n";

export function TxItem({
  tx,
  action,
  leading,
  onOpen,
}: {
  tx: TxDto;
  action?: ReactNode;
  /** Shown before the color bar (e.g. a selection checkbox). */
  leading?: ReactNode;
  /** When set, the title and amount become a button (e.g. to edit the entry). */
  onOpen?: () => void;
}) {
  const income = tx.type === "income";
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{tx.title}</p>
        <p className="truncate text-xs text-muted">
          {tx.categoryName ? categoryLabel(tx.categoryName, tx.categoryIcon) : tr("ไม่ระบุหมวด")} ·{" "}
          {formatThaiDate(new Date(tx.occurredAt))}
          {tx.accountShared
            ? ` · ${tx.mine === false ? (tx.writerName ?? tr("สมาชิก")) : tr("คุณ")} · ${tx.accountName ?? ""}`
            : ""}
        </p>
        {tx.origCurrency && tx.origAmountMinor ? (
          <p className="num truncate text-xs text-muted">
            {formatForeign(tx.origAmountMinor, tx.origCurrency)}
            {tx.fxRate ? ` @ ${formatRate(tx.fxRate)}` : ""}
          </p>
        ) : null}
        {tx.tags && tx.tags.length > 0 ? (
          <p className="truncate text-xs font-medium text-primary">
            {tx.tags.map((t) => `#${t}`).join(" ")}
          </p>
        ) : null}
      </div>
      <p className={cn("num shrink-0 text-sm font-bold", income ? "text-income" : "text-expense")}>
        {income ? "+" : "-"}
        {money(tx.amountSatang)}
      </p>
    </>
  );
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {leading}
      <span
        aria-hidden
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ background: tx.categoryColor ?? (income ? "#059669" : "#E11D48") }}
      />
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={tr("แก้ไข {0}", tx.title)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {action}
    </li>
  );
}
