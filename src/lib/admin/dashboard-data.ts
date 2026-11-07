import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000; // the most the database API returns in one read
const LINE_API = "https://api.line.me/v2/bot";

// Cloudflare R2 standard storage: first 10 GB-month free, then USD 0.015 per GB-month.
// Check https://developers.cloudflare.com/r2/pricing/ — prices can change.
export const R2_FREE_GB = 10;
export const R2_USD_PER_GB_MONTH = 0.015;
const GB = 1024 ** 3;

export interface AiKindUsage {
  kind: string;
  /** Uses taken this month, all people together. */
  used: number;
  /** People who used it at least once. */
  users: number;
}

export interface StorageUsage {
  readyFiles: number;
  pendingFiles: number;
  /** Bytes the database says are stored (ready and pending). */
  bytes: number;
  estimatedUsd: number;
}

export interface LineQuota {
  /** "limited" has a monthly cap in `limit`; "none" means no cap. */
  type: "limited" | "none" | "unknown";
  limit: number | null;
  used: number;
}

/** Estimated monthly R2 storage bill for `bytes` (operations and egress are not included). */
export function estimateR2Usd(bytes: number): number {
  const gb = bytes / GB;
  return Math.max(0, gb - R2_FREE_GB) * R2_USD_PER_GB_MONTH;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/** This month's AI-feature uses, summed over every person (counts only: tokens are not recorded). */
export async function loadAiUsage(db: SupabaseClient, month: string): Promise<AiKindUsage[]> {
  const totals = new Map<string, { used: number; users: Set<string> }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("usage_counters")
      .select("user_id,kind,used")
      .eq("month", month)
      .order("user_id")
      .order("kind")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`usage counters: ${error.message}`);
    const rows = (data ?? []) as { user_id: string; kind: string; used: number }[];
    for (const row of rows) {
      if (row.used <= 0) continue;
      const entry = totals.get(row.kind) ?? { used: 0, users: new Set<string>() };
      entry.used += row.used;
      entry.users.add(row.user_id);
      totals.set(row.kind, entry);
    }
    if (rows.length < PAGE) break;
  }
  return [...totals.entries()]
    .map(([kind, v]) => ({ kind, used: v.used, users: v.users.size }))
    .sort((a, b) => b.used - a.used);
}

/** Files kept in R2, from the names-and-sizes table (the bucket itself is not listed). */
export async function loadStorage(db: SupabaseClient): Promise<StorageUsage> {
  let readyFiles = 0;
  let pendingFiles = 0;
  let bytes = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("stored_files")
      .select("size_bytes,status")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`stored files: ${error.message}`);
    const rows = (data ?? []) as { size_bytes: number | string; status: string }[];
    for (const row of rows) {
      bytes += Number(row.size_bytes);
      if (row.status === "ready") readyFiles++;
      else pendingFiles++;
    }
    if (rows.length < PAGE) break;
  }
  return { readyFiles, pendingFiles, bytes, estimatedUsd: estimateR2Usd(bytes) };
}

/** The LINE Official Account's monthly message cap and what was used (free replies are not counted). */
export async function loadLineQuota(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineQuota> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [quotaRes, usedRes] = await Promise.all([
    fetchImpl(`${LINE_API}/message/quota`, { headers }),
    fetchImpl(`${LINE_API}/message/quota/consumption`, { headers }),
  ]);
  if (!quotaRes.ok) throw new Error(`LINE quota failed: ${quotaRes.status}`);
  if (!usedRes.ok) throw new Error(`LINE consumption failed: ${usedRes.status}`);
  const quota = (await quotaRes.json()) as { type?: string; value?: number };
  const used = (await usedRes.json()) as { totalUsage?: number };
  const type = quota.type === "limited" || quota.type === "none" ? quota.type : "unknown";
  return {
    type,
    limit: type === "limited" && typeof quota.value === "number" ? quota.value : null,
    used: typeof used.totalUsage === "number" ? used.totalUsage : 0,
  };
}
