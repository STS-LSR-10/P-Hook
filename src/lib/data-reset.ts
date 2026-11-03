import type { SupabaseClient } from "@supabase/supabase-js";
import { SLIP_BUCKET } from "@/lib/slip-repo";
import { currentZone, fromBangkok } from "@/lib/thai-date";

const PAGE = 100;

export type EraseScope = { kind: "all"; keepBalance: boolean } | { kind: "month"; month: string };

export interface ErasePreview {
  entries: number;
  transfers: number;
  debts: number;
  goalDeposits: number;
  files: number;
  /** Entries in shared wallets: they stay (other people see them). */
  keptShared: number;
}

export interface MonthWithData {
  month: string;
  entries: number;
  transfers: number;
}

/** "2026-10" -> [1 Oct 00:00, 1 Nov 00:00) in Bangkok time; null when it is not a real month. */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12 || year < 2000 || year > 2200) return null;
  return { from: fromBangkok(year, mon, 1), to: fromBangkok(year, mon + 1, 1) };
}

function args(userId: string, scope: EraseScope) {
  if (scope.kind === "all") {
    return { p_user: userId, p_from: null, p_to: null, p_all: true };
  }
  const range = monthRange(scope.month);
  if (!range) throw new Error("erase: bad month");
  return {
    p_user: userId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_all: false,
  };
}

const n = (v: unknown) => Number(v ?? 0);

/** How much would go (what the confirmation screen shows). Changes nothing. */
export async function previewErase(
  db: SupabaseClient,
  userId: string,
  scope: EraseScope,
): Promise<ErasePreview> {
  const { data, error } = await db.rpc("data_erase_preview", args(userId, scope));
  if (error) throw new Error(`erase preview: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    entries: n(row?.entries),
    transfers: n(row?.transfers),
    debts: n(row?.debts),
    goalDeposits: n(row?.goal_deposits),
    files: n(row?.files),
    keptShared: n(row?.kept_shared),
  };
}

/** Months that have entries or transfers to delete, newest first. */
export async function monthsWithData(db: SupabaseClient, userId: string): Promise<MonthWithData[]> {
  const { data, error } = await db.rpc("months_with_data", { p_user: userId, p_tz: currentZone() });
  if (error) throw new Error(`months with data: ${error.message}`);
  return (
    (data ?? []) as { month: string; entries: number | string; transfers: number | string }[]
  ).map((r) => ({ month: r.month, entries: n(r.entries), transfers: n(r.transfers) }));
}

/**
 * Erase history for good. The files (photos, slip images) go first, then the database rows in one
 * all-or-nothing step: a failure while removing files leaves the rows in place so it can be retried.
 */
export async function eraseData(
  db: SupabaseClient,
  userId: string,
  scope: EraseScope,
): Promise<{
  entries: number;
  transfers: number;
  debts: number;
  goalDeposits: number;
  filesRemoved: number;
}> {
  const base = args(userId, scope);
  const listed = await db.rpc("data_erase_paths", base);
  if (listed.error) throw new Error(`list files to erase: ${listed.error.message}`);
  const paths = ((listed.data ?? []) as { path: string }[]).map((r) => r.path).filter(Boolean);

  const bucket = db.storage.from(SLIP_BUCKET);
  let filesRemoved = 0;
  for (let i = 0; i < paths.length; i += PAGE) {
    const batch = paths.slice(i, i + PAGE);
    const removed = await bucket.remove(batch);
    if (removed.error) throw new Error(`remove files: ${removed.error.message}`);
    filesRemoved += batch.length;
  }

  const { data, error } = await db.rpc("data_erase", {
    ...base,
    p_keep_balance: scope.kind === "all" ? scope.keepBalance : false,
  });
  if (error) throw new Error(`erase data: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    entries: n(row?.entries),
    transfers: n(row?.transfers),
    debts: n(row?.debts),
    goalDeposits: n(row?.goal_deposits),
    filesRemoved,
  };
}
