import type { SupabaseClient } from "@supabase/supabase-js";
import { TX_SELECT, toTxDto, type TxDto } from "@/lib/dto";
import { toSatang } from "@/lib/money";
import { applyTxFilters } from "@/lib/tx-query";

/** What a search looks for: words in the title, or one #tag (never both). */
export interface SearchTarget {
  q: string | null;
  tag: string | null;
}

export const MAX_SEARCH_CHARS = 60;

/**
 * "กาแฟ" -> the words, "#ปาร์ตี้" -> the tag. Null for nothing to search for. The text is kept as
 * typed for display; matching is case-insensitive in the database.
 */
export function parseSearchTerm(raw: string): SearchTarget | null {
  const term = raw.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_CHARS);
  if (term.startsWith("#")) {
    const tag = term.slice(1).trim().toLowerCase();
    return tag ? { q: null, tag } : null;
  }
  return term ? { q: term, tag: null } : null;
}

export interface SearchTotals {
  incomeSatang: number;
  expenseSatang: number;
  count: number;
}

/** Added up by the database (`search_totals`), so a long history is exact. */
export async function loadSearchTotals(
  db: SupabaseClient,
  userId: string,
  target: SearchTarget,
  range?: { from: Date; to: Date },
): Promise<SearchTotals> {
  const { data, error } = await db.rpc("search_totals", {
    p_user: userId,
    p_q: target.q,
    p_tag: target.tag,
    ...(range ? { p_from: range.from.toISOString(), p_to: range.to.toISOString() } : {}),
  });
  if (error) throw new Error(`search totals: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    { income: number | string; expense: number | string; tx_count: number | string } | undefined;
  return {
    incomeSatang: row ? toSatang(row.income) : 0,
    expenseSatang: row ? toSatang(row.expense) : 0,
    count: row ? Number(row.tx_count) : 0,
  };
}

/** The newest confirmed entries a search finds. */
export async function loadSearchItems(
  db: SupabaseClient,
  userId: string,
  target: SearchTarget,
  limit: number,
  range?: { from: Date; to: Date },
): Promise<TxDto[]> {
  const { data, error } = await applyTxFilters(
    db.from("transactions").select(TX_SELECT).eq("user_id", userId).eq("status", "confirmed"),
    {
      q: target.q ?? undefined,
      tag: target.tag ?? undefined,
      from: range?.from.toISOString(),
      to: range?.to.toISOString(),
    },
  )
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`search items: ${error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => toTxDto(r));
}
