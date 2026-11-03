import { ChevronRight, Image as ImageIcon, Receipt } from "lucide-react";
import type { ReactNode } from "react";
import { sliceColor } from "@/components/liff/slice-color";
import { emojiOf } from "@/lib/category-emoji";
import type { TxDto } from "@/lib/dto";
import { formatForeign, formatRate } from "@/lib/fx";
import { money } from "@/lib/money";
import { bangkokParts, formatThaiDate } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

/** The tile colour of an income entry (the page theme's --income, as a plain colour for the alpha tint). */
const INCOME_TINT = "#2a7a52";

/** A stable place in the pastel palette for a category (its id, else its name). */
function paletteIndex(tx: TxDto): number {
  const key = tx.categoryId ?? tx.categoryName ?? "";
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}

/** "14:08 น." */
function timeOf(iso: string): string {
  const p = bangkokParts(new Date(iso));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} น.`;
}

/**
 * One entry as a card: a tile for the category, the title, the time and category chips, and the
 * amount. Tapping it (when `onOpen` is given) opens the entry.
 */
export function TxCard({
  tx,
  onOpen,
  leading,
  showDate = false,
}: {
  tx: TxDto;
  onOpen?: () => void;
  /** Shown before the card's content (e.g. a selection checkbox). */
  leading?: ReactNode;
  /** Put the date in front of the time (lists that are not grouped by day). */
  showDate?: boolean;
}) {
  const income = tx.type === "income";
  const color = sliceColor(null, paletteIndex(tx));
  const emoji = emojiOf(tx.categoryIcon);
  const body = (
    <>
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
        style={{ backgroundColor: `${income ? INCOME_TINT : color}26` }}
      >
        {emoji ?? (
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: income ? INCOME_TINT : color }}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{tx.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="num text-[10px] text-muted">
            {showDate ? `${formatThaiDate(new Date(tx.occurredAt))} · ` : ""}
            {timeOf(tx.occurredAt)}
          </span>
          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted">
            {tx.categoryName ?? "ไม่ระบุหมวด"}
          </span>
          {tx.accountName ? (
            <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn">
              {tx.accountName}
            </span>
          ) : null}
          {tx.hasPhoto ? (
            <ImageIcon className="h-3 w-3 text-primary" aria-label="มีรูปแนบ" role="img" />
          ) : null}
          {tx.hasSlip ? (
            <Receipt className="h-3 w-3 text-primary" aria-label="มีสลิป" role="img" />
          ) : null}
        </span>
        {tx.accountShared ? (
          <span className="block truncate text-[10px] text-muted">
            {tx.mine === false ? (tx.writerName ?? "สมาชิก") : "คุณ"}
          </span>
        ) : null}
        {tx.origCurrency && tx.origAmountMinor ? (
          <span className="num block truncate text-[10px] text-muted">
            {formatForeign(tx.origAmountMinor, tx.origCurrency)}
            {tx.fxRate ? ` @ ${formatRate(tx.fxRate)}` : ""}
          </span>
        ) : null}
        {tx.tags && tx.tags.length > 0 ? (
          <span className="block truncate text-[10px] font-medium text-primary">
            {tx.tags.map((t) => `#${t}`).join(" ")}
          </span>
        ) : null}
      </span>
      <span
        className={cn("num shrink-0 text-xs font-bold", income ? "text-income" : "text-expense")}
      >
        {income ? "+" : "-"}
        {money(tx.amountSatang)}
      </span>
      {onOpen ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden /> : null}
    </>
  );
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card">
      {leading}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`แก้ไข ${tx.title}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
    </li>
  );
}
