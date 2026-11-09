import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeText } from "@/lib/categorize/rules";
import { satangToString } from "@/lib/money";
import type { Plan } from "@/lib/plan";
import { fromBangkok, bangkokParts } from "@/lib/thai-date";
import { parseStoredItems, type ReceiptItem, type SlipData } from "@/lib/ocr/slip-schema";

export const SLIP_BUCKET = "slips";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

export interface SlipRow {
  id: string;
  storage_path: string;
  payee: string | null;
  slip_ref: string | null;
}

/** Plan fields of a user, for quota / feature checks. */
export async function getUserPlanRow(
  db: SupabaseClient,
  userId: string,
): Promise<{ plan: Plan; plan_expires_at: string | null }> {
  const { data, error } = await db
    .from("users")
    .select("plan,plan_expires_at")
    .eq("id", userId)
    .single();
  if (error) fail("load plan", error);
  return data as { plan: Plan; plan_expires_at: string | null };
}

/** Slips this user has sent in the current Bangkok calendar month (counts toward the Free quota). */
export async function countSlipsThisMonth(
  db: SupabaseClient,
  userId: string,
  now: Date,
): Promise<number> {
  const p = bangkokParts(now);
  const from = fromBangkok(p.year, p.month, 1);
  const to = fromBangkok(p.year, p.month + 1, 1);
  const { count, error } = await db
    .from("slips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());
  if (error) fail("count slips", error);
  return count ?? 0;
}

/** Every slip this user has had read, ever (Free has a taste of FREE_SLIPS_TOTAL for life). */
export async function countSlipsEver(db: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await db
    .from("slips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) fail("count slips", error);
  return count ?? 0;
}

export async function findSlipByHash(
  db: SupabaseClient,
  userId: string,
  sha256: string,
): Promise<SlipRow | null> {
  const { data, error } = await db
    .from("slips")
    .select("id,storage_path,payee,slip_ref")
    .eq("user_id", userId)
    .eq("image_sha256", sha256)
    .maybeSingle();
  if (error) fail("find slip by hash", error);
  return (data as SlipRow | null) ?? null;
}

export async function findSlipByRef(
  db: SupabaseClient,
  userId: string,
  reference: string,
): Promise<SlipRow | null> {
  const { data, error } = await db
    .from("slips")
    .select("id,storage_path,payee,slip_ref")
    .eq("user_id", userId)
    .eq("slip_ref", reference)
    .maybeSingle();
  if (error) fail("find slip by ref", error);
  return (data as SlipRow | null) ?? null;
}

export async function getSlip(
  db: SupabaseClient,
  userId: string,
  slipId: string,
): Promise<SlipRow | null> {
  const { data, error } = await db
    .from("slips")
    .select("id,storage_path,payee,slip_ref")
    .eq("user_id", userId)
    .eq("id", slipId)
    .maybeSingle();
  if (error) fail("load slip", error);
  return (data as SlipRow | null) ?? null;
}

/** The receipt's product lines saved with the slip (empty when there are none). */
export async function getSlipItems(
  db: SupabaseClient,
  userId: string,
  slipId: string,
): Promise<ReceiptItem[]> {
  const { data, error } = await db
    .from("slips")
    .select("ocr_json")
    .eq("user_id", userId)
    .eq("id", slipId)
    .maybeSingle();
  if (error) fail("load slip items", error);
  return parseStoredItems((data as { ocr_json?: unknown } | null)?.ocr_json);
}

/** Returns the new slip, or null when the unique (user, ref|hash) constraint says it already exists. */
export async function insertSlip(
  db: SupabaseClient,
  input: { userId: string; storagePath: string; sha256: string; data: SlipData },
): Promise<SlipRow | null> {
  const d = input.data;
  const { data, error } = await db
    .from("slips")
    .insert({
      user_id: input.userId,
      storage_path: input.storagePath,
      image_sha256: input.sha256,
      // Only sanitized fields are stored; the raw model output is never persisted.
      ocr_json: {
        kind: d.kind,
        amount: satangToString(d.amountSatang),
        paid_at: d.paidAt?.toISOString() ?? null,
        payee_name: d.payeeName,
        payee_bank: d.payeeBank,
        payee_account_last4: d.payeeAccountLast4,
        payer_bank: d.payerBank,
        reference: d.reference,
        memo: d.memo,
        // product lines (Elite receipts); empty array otherwise
        items: d.items.map((i) => ({ name: i.name, amount: satangToString(i.amountSatang) })),
      },
      slip_ref: d.reference,
      amount: satangToString(d.amountSatang),
      payee: d.payeeName,
      bank: d.payeeBank,
      paid_at: d.paidAt?.toISOString() ?? null,
    })
    .select("id,storage_path,payee,slip_ref")
    .single();
  if (error) {
    if (error.code === "23505") return null;
    fail("insert slip", error);
  }
  return data as SlipRow;
}

/** The newest live transaction created from a slip (for "already recorded" replies). */
export async function findTransactionBySlip(
  db: SupabaseClient,
  userId: string,
  slipId: string,
): Promise<{ title: string; amount: number | string } | null> {
  const { data, error } = await db
    .from("transactions")
    .select("title,amount")
    .eq("user_id", userId)
    .eq("slip_id", slipId)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("find transaction by slip", error);
  return (data as { title: string; amount: number | string } | null) ?? null;
}

/** Remember "this recipient belongs to this category" for the user. */
export async function learnMerchant(
  db: SupabaseClient,
  input: { userId: string; payee: string; categoryId: string },
): Promise<void> {
  const key = normalizeText(input.payee);
  if (key.length < 2) return;
  const existing = await db
    .from("merchant_memory")
    .select("id,hit_count")
    .eq("user_id", input.userId)
    .eq("match_text", key)
    .maybeSingle();
  if (existing.error) fail("load memory", existing.error);
  const row = existing.data as { id: string; hit_count: number } | null;
  if (row) {
    const { error } = await db
      .from("merchant_memory")
      .update({ category_id: input.categoryId, hit_count: row.hit_count + 1 })
      .eq("id", row.id)
      .eq("user_id", input.userId);
    if (error) fail("update memory", error);
  } else {
    const { error } = await db.from("merchant_memory").insert({
      user_id: input.userId,
      match_text: key,
      category_id: input.categoryId,
      hit_count: 1,
    });
    if (error) fail("insert memory", error);
  }
}

/** Delete every recorded entry of a slip (the "cancel the whole slip" button). Returns how many. */
export async function cancelSlipEntries(
  db: SupabaseClient,
  userId: string,
  slipId: string,
): Promise<number> {
  const { data, error } = await db
    .from("transactions")
    .update({ status: "deleted" })
    .eq("user_id", userId)
    .eq("slip_id", slipId)
    .eq("status", "confirmed")
    .select("id");
  if (error) fail("cancel slip entries", error);
  return (data ?? []).length;
}
