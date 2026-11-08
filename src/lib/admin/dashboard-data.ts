import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRate } from "@/lib/fx-repo";
import { aiCostUsd, findAiPrice, r2OperationClass, type TokenPrice } from "./pricing";

const PAGE = 1000; // the most the database API returns in one read
const LINE_API = "https://api.line.me/v2/bot";
const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const TIMEOUT_MS = 8000;

// ---------- shared ----------

/** The Bangkok month that starts on `month` (YYYY-MM-01) as two instants. */
export function monthRange(month: string): { from: string; to: string } {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${month}T00:00:00+07:00`, to: `${next}T00:00:00+07:00` };
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

// ---------- AI ----------

export interface AiModelUsage {
  provider: string;
  model: string;
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model has no known price. */
  costUsd: number | null;
}

/** One model's calls, tokens and cost across every feature. */
export interface AiModelTotal {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model has no known price. */
  costUsd: number | null;
  /** USD per 1M tokens, null when unknown. */
  price: TokenPrice | null;
}

export interface AiCosts {
  rows: AiModelUsage[];
  /** The same calls grouped by model, dearest first. */
  models: AiModelTotal[];
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Models used this month whose price is not known (their cost is not in costUsd). */
  unpricedModels: string[];
  /** When the first call of the month was logged; null when none. */
  firstAt: string | null;
}

/** Calls, tokens and cost of every AI call logged this month. */
export async function loadAiCosts(
  db: SupabaseClient,
  month: string,
  prices: Record<string, TokenPrice>,
): Promise<AiCosts> {
  const { from, to } = monthRange(month);
  const { data, error } = await db.rpc("ai_usage_summary", { p_from: from, p_to: to });
  if (error) throw new Error(`ai usage summary: ${error.message}`);
  const raw = (data ?? []) as {
    provider: string;
    model: string;
    feature: string;
    calls: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
    first_at: string;
  }[];
  const rows = raw
    .map((r) => {
      const inputTokens = Number(r.input_tokens);
      const outputTokens = Number(r.output_tokens);
      return {
        provider: r.provider,
        model: r.model,
        feature: r.feature,
        calls: Number(r.calls),
        inputTokens,
        outputTokens,
        costUsd: aiCostUsd(prices, r.model, inputTokens, outputTokens),
      };
    })
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls);
  const firstAt = raw.reduce<string | null>(
    (min, r) => (min === null || r.first_at < min ? r.first_at : min),
    null,
  );
  const byModel = new Map<string, AiModelTotal>();
  for (const r of rows) {
    const key = `${r.provider}:${r.model}`;
    const m = byModel.get(key) ?? {
      provider: r.provider,
      model: r.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      price: findAiPrice(prices, r.model),
    };
    m.calls += r.calls;
    m.inputTokens += r.inputTokens;
    m.outputTokens += r.outputTokens;
    if (r.costUsd !== null) m.costUsd = (m.costUsd ?? 0) + r.costUsd;
    byModel.set(key, m);
  }
  const models = [...byModel.values()].sort(
    (a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls,
  );
  return {
    rows,
    models,
    calls: rows.reduce((n, r) => n + r.calls, 0),
    inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
    costUsd: rows.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    unpricedModels: [...new Set(rows.filter((r) => r.costUsd === null).map((r) => r.model))],
    firstAt,
  };
}

export interface FeatureUse {
  kind: string;
  used: number;
  users: number;
}

/** This month's uses of each counted feature, all people together (from usage_counters). */
export async function loadFeatureUses(db: SupabaseClient, month: string): Promise<FeatureUse[]> {
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

// ---------- feedback ----------

export interface FeedbackItem {
  id: string;
  body: string;
  plan: "free" | "plus" | "ultimate";
  /** Where it was written: the LINE chat or the app's settings page. */
  source: "line" | "app";
  createdAt: string;
  /** The name the sender shows in LINE; null when we have none. */
  name: string | null;
}

export const FEEDBACK_PAGE_SIZE = 20;

export interface FeedbackQuery {
  source: "all" | FeedbackItem["source"];
  plan: "all" | FeedbackItem["plan"];
  page: number;
}

/** The filters and page the admin asked for in the address, ignoring anything it does not know. */
export function parseFeedbackQuery(
  params: Record<string, string | string[] | undefined>,
): FeedbackQuery {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const source = one("source");
  const plan = one("plan");
  const page = Number(one("page"));
  return {
    source: source === "line" || source === "app" ? source : "all",
    plan: plan === "free" || plan === "plus" || plan === "ultimate" ? plan : "all",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export interface FeedbackPage {
  items: FeedbackItem[];
  total: number;
  page: number;
  pages: number;
}

/** One page of suggestions and comments, newest first; a page past the end gives the last one. */
export async function loadFeedbackPage(
  db: SupabaseClient,
  query: FeedbackQuery,
): Promise<FeedbackPage> {
  const filters: [string, string][] = [];
  if (query.source !== "all") filters.push(["source", query.source]);
  if (query.plan !== "all") filters.push(["plan", query.plan]);
  // the total first: asking for a range past the end is refused by the API, so the page is clamped
  // before it is asked for
  let countQuery = db.from("feedback").select("id", { count: "exact", head: true });
  for (const [column, value] of filters) countQuery = countQuery.eq(column, value);
  const counted = await countQuery;
  if (counted.error) throw new Error(`feedback: ${counted.error.message}`);
  const total = counted.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const from = (page - 1) * FEEDBACK_PAGE_SIZE;
  let listQuery = db.from("feedback").select("id,body,plan,source,created_at,users(display_name)");
  for (const [column, value] of filters) listQuery = listQuery.eq(column, value);
  const { data, error } = await listQuery
    .order("created_at", { ascending: false })
    .range(from, from + FEEDBACK_PAGE_SIZE - 1);
  if (error) throw new Error(`feedback: ${error.message}`);
  const rows = (data ?? []) as unknown as {
    id: string;
    body: string;
    plan: FeedbackItem["plan"];
    source: FeedbackItem["source"];
    created_at: string;
    users: { display_name: string | null } | null;
  }[];
  return {
    total,
    page,
    pages,
    items: rows.map((r) => ({
      id: r.id,
      body: r.body,
      plan: r.plan,
      source: r.source,
      createdAt: r.created_at,
      name: r.users?.display_name ?? null,
    })),
  };
}

/** How many there are for each source (under the chosen plan), for the filter buttons. */
export async function feedbackCounts(
  db: SupabaseClient,
  plan: FeedbackQuery["plan"],
): Promise<{ all: number; line: number; app: number }> {
  const count = async (source?: FeedbackItem["source"]) => {
    let q = db.from("feedback").select("id", { count: "exact", head: true });
    if (source) q = q.eq("source", source);
    if (plan !== "all") q = q.eq("plan", plan);
    const { count: n, error } = await q;
    if (error) throw new Error(`feedback: ${error.message}`);
    return n ?? 0;
  };
  const [all, line, app] = await Promise.all([count(), count("line"), count("app")]);
  return { all, line, app };
}

// ---------- LINE ----------

export interface LineUsage {
  /** "limited" has a monthly cap in `quotaLimit`; "none" means no cap. */
  quotaType: "limited" | "none" | "unknown";
  quotaLimit: number | null;
  /** Messages that count against the quota this month (push, multicast, broadcast). */
  quotaUsed: number;
  /** Every message sent this month up to yesterday, replies included (LINE insight). */
  sent: { total: number; reply: number; push: number; other: number; days: number };
}

const DELIVERY_FIELDS = [
  "broadcast",
  "targeting",
  "autoResponse",
  "welcomeResponse",
  "chat",
  "apiBroadcast",
  "apiPush",
  "apiMulticast",
  "apiNarrowcast",
  "apiReply",
] as const;

/** The days of this month before today, as LINE's yyyyMMdd. */
export function daysBefore(today: string): string[] {
  const [y, m, d] = today.split("-");
  return Array.from(
    { length: Number(d) - 1 },
    (_, i) => `${y}${m}${String(i + 1).padStart(2, "0")}`,
  );
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${new URL(url).pathname} failed: ${res.status}`);
  return res.json();
}

/** The OA's quota and what it sent this month. Errors carry the status only, never the token. */
export async function loadLineUsage(
  accessToken: string,
  today: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineUsage> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [quota, used, ...days] = await Promise.all([
    getJson(fetchImpl, `${LINE_API}/message/quota`, headers),
    getJson(fetchImpl, `${LINE_API}/message/quota/consumption`, headers),
    ...daysBefore(today).map((date) =>
      getJson(fetchImpl, `${LINE_API}/insight/message/delivery?date=${date}`, headers).catch(
        () => null,
      ),
    ),
  ]);
  const q = quota as { type?: string; value?: number };
  const quotaType = q.type === "limited" || q.type === "none" ? q.type : "unknown";

  const sent = { total: 0, reply: 0, push: 0, other: 0, days: 0 };
  for (const day of days) {
    const d = day as Record<string, unknown> | null;
    if (!d || d.status !== "ready") continue;
    sent.days++;
    for (const field of DELIVERY_FIELDS) {
      const n = typeof d[field] === "number" ? (d[field] as number) : 0;
      sent.total += n;
      if (field === "apiReply") sent.reply += n;
      else if (field === "apiPush") sent.push += n;
      else sent.other += n;
    }
  }

  return {
    quotaType,
    quotaLimit: quotaType === "limited" && typeof q.value === "number" ? q.value : null,
    quotaUsed: (used as { totalUsage?: number }).totalUsage ?? 0,
    sent,
  };
}

// ---------- R2 ----------

export interface StoredFiles {
  readyFiles: number;
  pendingFiles: number;
  bytes: number;
  /** r2_key -> status, to compare with what is really in the bucket. */
  keys: Map<string, string>;
}

/** Files the database knows about (names and sizes; the bytes are in R2). */
export async function loadStoredFiles(db: SupabaseClient): Promise<StoredFiles> {
  const out: StoredFiles = { readyFiles: 0, pendingFiles: 0, bytes: 0, keys: new Map() };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("stored_files")
      .select("r2_key,size_bytes,status")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`stored files: ${error.message}`);
    const rows = (data ?? []) as { r2_key: string; size_bytes: number | string; status: string }[];
    for (const row of rows) {
      out.bytes += Number(row.size_bytes);
      if (row.status === "ready") out.readyFiles++;
      else out.pendingFiles++;
      out.keys.set(row.r2_key, row.status);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The part of a Workers R2 bucket that lists objects with their sizes. */
export interface ListableBucket {
  list(options: { cursor?: string; limit?: number }): Promise<{
    objects: { key: string; size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface BucketScan {
  objects: number;
  bytes: number;
  /** Objects with no row in the database (left behind): they are billed but nobody can reach them. */
  orphanObjects: number;
  orphanBytes: number;
  /** Ready rows whose bytes are not in the bucket. */
  missingFiles: number;
  /** True when the scan stopped at `maxObjects` (the numbers are then a lower bound). */
  truncated: boolean;
}

const THUMB = ".thumb";

/** Walk the whole bucket and compare it with the database. A preview (<key>.thumb) belongs to its file. */
export async function scanBucket(
  bucket: ListableBucket,
  known: Map<string, string>,
  maxObjects = 100_000,
): Promise<BucketScan> {
  const scan: BucketScan = {
    objects: 0,
    bytes: 0,
    orphanObjects: 0,
    orphanBytes: 0,
    missingFiles: 0,
    truncated: false,
  };
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const object of page.objects) {
      scan.objects++;
      scan.bytes += object.size;
      const owner = object.key.endsWith(THUMB) ? object.key.slice(0, -THUMB.length) : object.key;
      if (known.has(object.key) || known.has(owner)) {
        seen.add(object.key);
      } else {
        scan.orphanObjects++;
        scan.orphanBytes += object.size;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
    if (cursor && scan.objects >= maxObjects) {
      scan.truncated = true;
      break;
    }
  } while (cursor);
  if (!scan.truncated) {
    for (const [key, status] of known)
      if (status === "ready" && !seen.has(key)) scan.missingFiles++;
  }
  return scan;
}

/** The FILES bucket of this Worker; null outside Workers (dev, tests). */
export async function getListableBucket(): Promise<ListableBucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as unknown as { FILES?: ListableBucket }).FILES ?? null;
  } catch {
    return null;
  }
}

export interface R2Operations {
  classA: number;
  classB: number;
  free: number;
  byAction: { action: string; requests: number; class: "A" | "B" | "free" }[];
}

const R2_OPS_QUERY = `query R2Ops($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_lt: $end }
      ) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

/**
 * R2 operations of the whole account (the free allowance is per account) between two instants,
 * from Cloudflare's GraphQL Analytics API. Needs a token with Account Analytics: Read.
 */
export async function loadR2Operations(
  accountId: string,
  apiToken: string,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<R2Operations> {
  const res = await fetchImpl(CF_GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: R2_OPS_QUERY,
      variables: {
        accountTag: accountId,
        start: new Date(from).toISOString(),
        end: new Date(to).toISOString(),
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Cloudflare GraphQL failed: ${res.status}`);
  const body = (await res.json()) as {
    data?: {
      viewer?: {
        accounts?: {
          r2OperationsAdaptiveGroups?: {
            sum?: { requests?: number };
            dimensions?: { actionType?: string };
          }[];
        }[];
      };
    };
    errors?: { message?: string }[] | null;
  };
  if (body.errors?.length)
    throw new Error(`Cloudflare GraphQL error: ${body.errors[0]?.message ?? "?"}`);
  const groups = body.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups ?? [];
  const totals = new Map<string, number>();
  for (const g of groups) {
    const action = g.dimensions?.actionType ?? "unknown";
    totals.set(action, (totals.get(action) ?? 0) + (g.sum?.requests ?? 0));
  }
  const byAction = [...totals.entries()]
    .map(([action, requests]) => ({ action, requests, class: r2OperationClass(action) }))
    .sort((a, b) => b.requests - a.requests);
  const sum = (c: "A" | "B" | "free") =>
    byAction.filter((a) => a.class === c).reduce((n, a) => n + a.requests, 0);
  return { classA: sum("A"), classB: sum("B"), free: sum("free"), byAction };
}

// ---------- money ----------

export interface UsdRate {
  rate: number;
  /** Where the rate came from: the ECB day it is from, or the USD_THB_RATE setting. */
  source: string;
}

/** Baht per US dollar: today's cached ECB rate, else USD_THB_RATE. Null when neither is there. */
export async function loadUsdThb(
  db: SupabaseClient,
  today: string,
  fallback: string | undefined = process.env.USD_THB_RATE,
): Promise<UsdRate | null> {
  const fx = await getRate(db, "USD", today, today).catch(() => null);
  if (fx) return { rate: fx.rate, source: `ECB ${fx.sourceDay}${fx.stale ? " (เก่า)" : ""}` };
  const n = Number(fallback);
  return Number.isFinite(n) && n > 0 ? { rate: n, source: "USD_THB_RATE" } : null;
}
