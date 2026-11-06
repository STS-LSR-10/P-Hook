import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyOverrides,
  type CategoryDetail,
  type CategoryOverride,
} from "@/lib/categorize/overrides";
import type { MemoryLite } from "@/lib/categorize/rules";
import { satangToString, toSatang } from "@/lib/money";
import { can, effectivePlan, type Plan } from "@/lib/plan";
import type { BudgetCycle, ConfirmStyle, TxType } from "@/lib/types";

export interface UserRow {
  id: string;
  line_user_id: string;
  display_name: string | null;
  plan: Plan;
  plan_expires_at: string | null;
  /** The person's time zone (an IANA name; Bangkok unless they chose another). */
  timezone?: string;
  /** The currency their books are kept in (the baht unless they chose another). */
  currency?: string;
  /** Their language: "th" or "en". */
  locale?: string;
}

export interface SettingsRow {
  budget_cycle: BudgetCycle;
  cycle_start_day: number;
  confirm_style: ConfirmStyle;
  daily_reminder_enabled: boolean;
  /** "HH:MM:SS" (Bangkok time) or null */
  daily_reminder_time: string | null;
  /** Automatic summary in the chat (Pro and above), Monday 09:00 / cycle start day 09:00 */
  weekly_summary_enabled: boolean;
  monthly_summary_enabled: boolean;
  /** Limit for one day, all categories together (Pro and above); null = none. */
  daily_budget?: number | string | null;
  /** Card colour theme and the bot's manner (Pro and above); unknown values read as the defaults. */
  card_theme?: string;
  bot_persona?: string;
  /** The name the bot calls the person (Pro and above); null = none. */
  call_name?: string | null;
  /** After a plain save, offer the camera / album buttons to attach a photo (default on). */
  photo_prompt?: boolean;
}

export interface TxRow {
  id: string;
  type: TxType;
  title: string;
  amount: number | string;
  category_id: string | null;
  occurred_at: string;
  status: "confirmed" | "pending_confirm" | "deleted";
  slip_id: string | null;
}

const DEFAULT_SETTINGS: SettingsRow = {
  budget_cycle: "monthly",
  cycle_start_day: 1,
  confirm_style: "full",
  daily_reminder_enabled: false,
  daily_reminder_time: null,
  weekly_summary_enabled: false,
  monthly_summary_enabled: false,
  card_theme: "mint",
  bot_persona: "warm",
  call_name: null,
  photo_prompt: true,
};

const TX_COLUMNS = "id,type,title,amount,category_id,occurred_at,status,slip_id";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

export function txAmountSatang(tx: Pick<TxRow, "amount">): number {
  return toSatang(tx.amount);
}

export async function ensureUser(
  db: SupabaseClient,
  lineUserId: string,
  loadProfile: () => Promise<{ displayName?: string; pictureUrl?: string } | null>,
): Promise<UserRow> {
  const select = "id,line_user_id,display_name,plan,plan_expires_at,timezone,currency,locale";
  const found = await db.from("users").select(select).eq("line_user_id", lineUserId).maybeSingle();
  if (found.error) fail("load user", found.error);
  if (found.data) return found.data as UserRow;

  const profile = await loadProfile().catch(() => null);
  const inserted = await db
    .from("users")
    .insert({
      line_user_id: lineUserId,
      display_name: profile?.displayName ?? null,
      picture_url: profile?.pictureUrl ?? null,
    })
    .select(select)
    .single();

  let user = inserted.data as UserRow | null;
  if (inserted.error) {
    // Lost a race with a concurrent event: read the winner's row.
    const retry = await db.from("users").select(select).eq("line_user_id", lineUserId).single();
    if (retry.error) fail("create user", inserted.error);
    user = retry.data as UserRow;
  }
  if (!user) throw new Error("create user: no row returned");

  const settings = await db
    .from("user_settings")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (settings.error) fail("create settings", settings.error);
  return user;
}

/** Keep the LINE display name / picture fresh (best effort). */
export async function touchProfile(
  db: SupabaseClient,
  userId: string,
  profile: { displayName?: string; pictureUrl?: string },
): Promise<void> {
  const patch: Record<string, string> = {};
  if (profile.displayName) patch.display_name = profile.displayName;
  if (profile.pictureUrl) patch.picture_url = profile.pictureUrl;
  if (Object.keys(patch).length === 0) return;
  await db.from("users").update(patch).eq("id", userId);
}

export async function getSettings(db: SupabaseClient, userId: string): Promise<SettingsRow> {
  const { data, error } = await db
    .from("user_settings")
    .select(
      "budget_cycle,cycle_start_day,confirm_style,daily_reminder_enabled,daily_reminder_time,weekly_summary_enabled,monthly_summary_enabled,daily_budget,card_theme,bot_persona,call_name,photo_prompt",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("load settings", error);
  return (data as SettingsRow | null) ?? DEFAULT_SETTINGS;
}

/** System categories (with this user's overrides applied) plus the user's own. */
export async function loadCategories(
  db: SupabaseClient,
  userId: string,
): Promise<CategoryDetail[]> {
  const [cats, overrides] = await Promise.all([
    db
      .from("categories")
      .select("id,user_id,type,name,icon,color,keywords,sort_order,is_hidden")
      .or(`user_id.is.null,user_id.eq.${userId}`),
    db
      .from("category_overrides")
      .select("category_id,keywords,is_hidden,sort_order")
      .eq("user_id", userId),
  ]);
  if (cats.error) fail("load categories", cats.error);
  // A missing overrides table (migration 0004 not applied yet) must not break categorizing.
  const ov = overrides.error ? [] : ((overrides.data ?? []) as CategoryOverride[]);
  return applyOverrides((cats.data ?? []) as CategoryDetail[], ov);
}

/** Sum of confirmed expenses in [from, to), optionally for one category. */
export async function expenseTotalSatang(
  db: SupabaseClient,
  input: { userId: string; from: Date; to: Date; categoryId?: string },
): Promise<number> {
  let query = db
    .from("transactions")
    .select("amount")
    .eq("user_id", input.userId)
    .eq("status", "confirmed")
    .eq("type", "expense")
    .gte("occurred_at", input.from.toISOString())
    .lt("occurred_at", input.to.toISOString());
  if (input.categoryId) query = query.eq("category_id", input.categoryId);
  const { data, error } = await query;
  if (error) fail("sum expenses", error);
  return (data ?? []).reduce(
    (sum, r) => sum + toSatang((r as { amount: number | string }).amount),
    0,
  );
}

export interface BudgetRow {
  id: string;
  category_id: string | null;
  amount: number | string;
}

export async function loadBudgets(db: SupabaseClient, userId: string): Promise<BudgetRow[]> {
  const { data, error } = await db
    .from("budgets")
    .select("id,category_id,amount")
    .eq("user_id", userId);
  if (error) fail("load budgets", error);
  return (data ?? []) as BudgetRow[];
}

/** Budget mode lives in user_settings.budget_mode (migration 0004); default when unavailable. */
export async function getBudgetMode(
  db: SupabaseClient,
  userId: string,
): Promise<"overall" | "category"> {
  const { data, error } = await db
    .from("user_settings")
    .select("budget_mode")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return "overall";
  return (data as { budget_mode?: string }).budget_mode === "category" ? "category" : "overall";
}

/** Set (amount) or clear (null) the overall (categoryId null) or per-category budget. */
export async function setBudget(
  db: SupabaseClient,
  input: {
    userId: string;
    categoryId: string | null;
    amountSatang: number | null;
    cycle: BudgetCycle;
  },
): Promise<void> {
  // Partial unique indexes cannot be used as an upsert target, so look the row up first.
  let find = db.from("budgets").select("id").eq("user_id", input.userId);
  find = input.categoryId ? find.eq("category_id", input.categoryId) : find.is("category_id", null);
  const found = await find.maybeSingle();
  if (found.error) fail("find budget", found.error);
  const existing = found.data as { id: string } | null;

  if (input.amountSatang === null) {
    if (existing) {
      const del = await db
        .from("budgets")
        .delete()
        .eq("id", existing.id)
        .eq("user_id", input.userId);
      if (del.error) fail("delete budget", del.error);
    }
    return;
  }
  const amount = satangToString(input.amountSatang);
  if (existing) {
    const upd = await db
      .from("budgets")
      .update({ amount, cycle: input.cycle })
      .eq("id", existing.id)
      .eq("user_id", input.userId);
    if (upd.error) fail("update budget", upd.error);
  } else {
    const ins = await db.from("budgets").insert({
      user_id: input.userId,
      category_id: input.categoryId,
      amount,
      cycle: input.cycle,
    });
    if (ins.error) fail("insert budget", ins.error);
  }
}

/** Learned recipient -> category memory, only for plans that include it (Plus). */
export async function loadMemoryFor(
  db: SupabaseClient,
  user: Pick<UserRow, "id" | "plan" | "plan_expires_at">,
  now: Date = new Date(),
): Promise<MemoryLite[]> {
  if (!can(effectivePlan(user.plan, user.plan_expires_at, now), "merchantMemory")) return [];
  return loadMemory(db, user.id);
}

export async function loadMemory(db: SupabaseClient, userId: string): Promise<MemoryLite[]> {
  const { data, error } = await db
    .from("merchant_memory")
    .select("match_text,category_id")
    .eq("user_id", userId);
  if (error) fail("load memory", error);
  return (data ?? []) as MemoryLite[];
}

export async function insertTransaction(
  db: SupabaseClient,
  input: {
    userId: string;
    type: TxType;
    title: string;
    amountSatang: number;
    categoryId: string | null;
    occurredAt: Date;
    status: "confirmed" | "pending_confirm";
    rawText: string;
    source?: "text" | "manual" | "slip" | "voice" | "pdf";
    slipId?: string;
    tags?: string[];
    /** Wallet to record in (omitted = the main wallet). */
    accountId?: string | null;
    /** Entered in a foreign currency: the original amount (×100), its currency and the rate used. */
    foreign?: { currency: string; minor: number; rate: number } | null;
  },
): Promise<TxRow> {
  const { data, error } = await db
    .from("transactions")
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      amount: satangToString(input.amountSatang),
      category_id: input.categoryId,
      occurred_at: input.occurredAt.toISOString(),
      source: input.source ?? "text",
      status: input.status,
      raw_text: input.rawText,
      slip_id: input.slipId ?? null,
      // only sent when there are tags, so plain entries keep working before migration 0014 is run
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      // likewise only sent when a wallet was picked (works before migration 0019)
      ...(input.accountId ? { account_id: input.accountId } : {}),
      // likewise only for foreign-currency entries (works before migration 0023)
      ...(input.foreign
        ? {
            orig_currency: input.foreign.currency,
            orig_amount: satangToString(input.foreign.minor),
            fx_rate: input.foreign.rate,
          }
        : {}),
    })
    .select(TX_COLUMNS)
    .single();
  if (error) fail("insert transaction", error);
  return data as TxRow;
}

export async function getTransaction(
  db: SupabaseClient,
  userId: string,
  txId: string,
): Promise<TxRow | null> {
  const { data, error } = await db
    .from("transactions")
    .select(TX_COLUMNS)
    .eq("id", txId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("load transaction", error);
  return (data as TxRow | null) ?? null;
}

export async function getLatestConfirmed(
  db: SupabaseClient,
  userId: string,
): Promise<TxRow | null> {
  const { data, error } = await db
    .from("transactions")
    .select(TX_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("load latest transaction", error);
  return (data as TxRow | null) ?? null;
}

/** The entry the user saved an edit on most recently (within `since`), for the "edit done" card. */
export async function getRecentlyEdited(
  db: SupabaseClient,
  userId: string,
  since: Date,
): Promise<(TxRow & { account_id: string | null }) | null> {
  const { data, error } = await db
    .from("transactions")
    .select(`${TX_COLUMNS},account_id`)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .gte("updated_at", since.toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("load edited transaction", error);
  return (data as (TxRow & { account_id: string | null }) | null) ?? null;
}

/** Apply a validated column patch (see `planEdit`) to one of the user's live entries. */
export async function patchTransactionRow(
  db: SupabaseClient,
  userId: string,
  txId: string,
  row: Record<string, unknown>,
): Promise<TxRow | null> {
  const { data, error } = await db
    .from("transactions")
    .update(row)
    .eq("id", txId)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .select(TX_COLUMNS)
    .maybeSingle();
  if (error) fail("patch transaction", error);
  return (data as TxRow | null) ?? null;
}

/** The user's confirmed entries among `ids` (others — deleted, foreign, unknown — are dropped). */
export async function getConfirmedByIds(
  db: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<TxRow[]> {
  const { data, error } = await db
    .from("transactions")
    .select(TX_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .in("id", ids);
  if (error) fail("load transactions", error);
  return (data ?? []) as TxRow[];
}

/** Update many confirmed entries at once; returns how many rows changed. */
export async function bulkPatchTransactions(
  db: SupabaseClient,
  userId: string,
  ids: string[],
  row: Record<string, unknown>,
): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await db
    .from("transactions")
    .update(row)
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .in("id", ids)
    .select("id");
  if (error) fail("bulk update transactions", error);
  return (data ?? []).length;
}

export async function updateTransaction(
  db: SupabaseClient,
  userId: string,
  txId: string,
  patch: Partial<{
    type: TxType;
    amountSatang: number;
    categoryId: string | null;
    status: "confirmed" | "deleted";
  }>,
): Promise<TxRow | null> {
  const row: Record<string, unknown> = {};
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.amountSatang !== undefined) row.amount = satangToString(patch.amountSatang);
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId;
  if (patch.status !== undefined) row.status = patch.status;

  const { data, error } = await db
    .from("transactions")
    .update(row)
    .eq("id", txId)
    .eq("user_id", userId)
    .neq("status", "deleted")
    .select(TX_COLUMNS)
    .maybeSingle();
  if (error) fail("update transaction", error);
  return (data as TxRow | null) ?? null;
}

export async function categoryTotalSatang(
  db: SupabaseClient,
  input: { userId: string; categoryId: string; type: TxType; from: Date; to: Date },
): Promise<number> {
  const { data, error } = await db
    .from("transactions")
    .select("amount")
    .eq("user_id", input.userId)
    .eq("status", "confirmed")
    .eq("type", input.type)
    .eq("category_id", input.categoryId)
    .gte("occurred_at", input.from.toISOString())
    .lt("occurred_at", input.to.toISOString());
  if (error) fail("sum category", error);
  return (data ?? []).reduce(
    (sum, r) => sum + toSatang((r as { amount: number | string }).amount),
    0,
  );
}

export async function periodSummary(
  db: SupabaseClient,
  input: { userId: string; from: Date; to: Date },
): Promise<{ incomeSatang: number; expenseSatang: number; count: number }> {
  const { data, error } = await db.rpc("summary_by_period", {
    p_user: input.userId,
    p_from: input.from.toISOString(),
    p_to: input.to.toISOString(),
  });
  if (error) fail("summary", error);
  const row = (Array.isArray(data) ? data[0] : data) as
    { income: number | string; expense: number | string; tx_count: number | string } | undefined;
  return {
    incomeSatang: row ? toSatang(row.income) : 0,
    expenseSatang: row ? toSatang(row.expense) : 0,
    count: row ? Number(row.tx_count) : 0,
  };
}

/** Claim a webhook event. Returns false when it was already processed (duplicate/redelivery). */
export async function claimEvent(db: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await db
    .from("line_events")
    .upsert({ event_id: eventId }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");
  if (error) fail("claim event", error);
  return (data ?? []).length > 0;
}

/** Release a claim so a LINE redelivery can retry after a processing failure. */
export async function releaseEvent(db: SupabaseClient, eventId: string): Promise<void> {
  await db.from("line_events").delete().eq("event_id", eventId);
}

/**
 * Take a pending entry out of play exactly once: only the call that finds it still
 * "pending_confirm" gets the row, so a double tap cannot split the same receipt twice.
 */
export async function claimPendingTransaction(
  db: SupabaseClient,
  userId: string,
  txId: string,
): Promise<TxRow | null> {
  const { data, error } = await db
    .from("transactions")
    .update({ status: "deleted" })
    .eq("id", txId)
    .eq("user_id", userId)
    .eq("status", "pending_confirm")
    .select(TX_COLUMNS)
    .maybeSingle();
  if (error) fail("claim pending transaction", error);
  return (data as TxRow | null) ?? null;
}

/** Undo `claimPendingTransaction` when what should follow it failed. */
export async function releasePendingTransaction(
  db: SupabaseClient,
  userId: string,
  txId: string,
): Promise<void> {
  const { error } = await db
    .from("transactions")
    .update({ status: "pending_confirm" })
    .eq("id", txId)
    .eq("user_id", userId)
    .eq("status", "deleted");
  if (error) fail("release pending transaction", error);
}
