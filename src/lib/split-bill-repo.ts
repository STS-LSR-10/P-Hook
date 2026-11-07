import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_OPEN_BILLS,
  type BillMemberRow,
  type BillRow,
  type BillShare,
  type BillStatus,
  type OpenShare,
  type PaidVia,
} from "@/lib/split-bill";

function fail(context: string, error: { message: string }): never {
  throw new Error(`${context}: ${error.message}`);
}

interface BillDb {
  id: string;
  group_id: string;
  payer_line_user_id: string;
  title: string;
  amount_satang: number | string;
  status: BillStatus;
  created_at: string;
}
const BILL_COLUMNS = "id,group_id,payer_line_user_id,title,amount_satang,status,created_at";
const toBill = (r: BillDb): BillRow => ({
  id: r.id,
  groupId: r.group_id,
  payerLineUserId: r.payer_line_user_id,
  title: r.title,
  amountSatang: Number(r.amount_satang),
  status: r.status,
  createdAt: r.created_at,
});

/** A new bill (the payer is its first member). "too_many" when the group already has ten going. */
export async function createBill(
  db: SupabaseClient,
  input: {
    groupId: string;
    payerLineUserId: string;
    title: string;
    amountSatang: number;
    /** A new bill waits in "setup" until the payer has chosen the people. */
    status?: BillStatus;
  },
): Promise<BillRow | "too_many"> {
  const open = await db
    .from("split_bills")
    .select("id", { count: "exact", head: true })
    .eq("group_id", input.groupId)
    .in("status", ["setup", "joining", "collecting"]);
  if (open.error) fail("count open bills", open.error);
  if ((open.count ?? 0) >= MAX_OPEN_BILLS) return "too_many";

  const { data, error } = await db
    .from("split_bills")
    .insert({
      group_id: input.groupId,
      payer_line_user_id: input.payerLineUserId,
      title: input.title,
      amount_satang: input.amountSatang,
      status: input.status ?? "joining",
    })
    .select(BILL_COLUMNS)
    .single();
  if (error) fail("create bill", error);
  return toBill(data as BillDb);
}

export async function getBill(
  db: SupabaseClient,
  groupId: string,
  billId: string,
): Promise<BillRow | null> {
  const { data, error } = await db
    .from("split_bills")
    .select(BILL_COLUMNS)
    .eq("group_id", groupId)
    .eq("id", billId)
    .maybeSingle();
  if (error) fail("load bill", error);
  return data ? toBill(data as BillDb) : null;
}

export async function listBills(
  db: SupabaseClient,
  groupId: string,
  statuses: BillStatus[],
  limit = 20,
): Promise<BillRow[]> {
  const { data, error } = await db
    .from("split_bills")
    .select(BILL_COLUMNS)
    .eq("group_id", groupId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("list bills", error);
  return ((data ?? []) as BillDb[]).map(toBill);
}

/** The newest bill this person paid for that is in one of these states. */
export async function latestBillBy(
  db: SupabaseClient,
  groupId: string,
  payerLineUserId: string,
  statuses: BillStatus[],
): Promise<BillRow | null> {
  const { data, error } = await db
    .from("split_bills")
    .select(BILL_COLUMNS)
    .eq("group_id", groupId)
    .eq("payer_line_user_id", payerLineUserId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) fail("load latest bill", error);
  const row = ((data ?? []) as BillDb[])[0];
  return row ? toBill(row) : null;
}

interface MemberDb {
  line_user_id: string;
  share_satang: number | string | null;
  paid: boolean;
  qr_token: string;
  claimed_at: string | null;
  paid_via: PaidVia | null;
  claim_via: "slip" | "slip_unverified" | null;
}

export async function billMembers(db: SupabaseClient, billId: string): Promise<BillMemberRow[]> {
  const { data, error } = await db
    .from("split_bill_members")
    .select("line_user_id,share_satang,paid,qr_token,claimed_at,paid_via,claim_via")
    .eq("bill_id", billId)
    .order("joined_at", { ascending: true });
  if (error) fail("load bill members", error);
  return ((data ?? []) as MemberDb[]).map((r) => ({
    lineUserId: r.line_user_id,
    shareSatang: r.share_satang === null ? null : Number(r.share_satang),
    paid: r.paid,
    qrToken: r.qr_token,
    claimed: r.claimed_at !== null,
    claimVia: r.claim_via,
    paidVia: r.paid_via,
  }));
}

export type JoinResult = "ok" | "closed" | "full";

export async function joinBill(
  db: SupabaseClient,
  billId: string,
  lineUserId: string,
): Promise<JoinResult> {
  const { data, error } = await db.rpc("split_bill_join", { p_bill: billId, p_user: lineUserId });
  if (error) fail("join bill", error);
  return data === "ok" || data === "full" ? data : "closed";
}

/** Fix the shares and start collecting. False when the list was no longer open (a double tap). */
export async function closeBill(
  db: SupabaseClient,
  billId: string,
  shares: BillShare[],
): Promise<boolean> {
  const { data, error } = await db.rpc("split_bill_close", {
    p_bill: billId,
    p_shares: shares.map((s) => ({ user: s.lineUserId, share: s.shareSatang })),
  });
  if (error) fail("close bill", error);
  return data === true;
}

/** Choose the people and start collecting (see split_bill_confirm). False when it was already done. */
export async function confirmBill(
  db: SupabaseClient,
  billId: string,
  shares: BillShare[],
): Promise<boolean> {
  const { data, error } = await db.rpc("split_bill_confirm", {
    p_bill: billId,
    p_shares: shares.map((s) => ({ user: s.lineUserId, share: s.shareSatang })),
  });
  if (error) fail("confirm bill", error);
  return data === true;
}

/** True the first time only: the QR codes go into the group once. */
export async function markAnnounced(db: SupabaseClient, billId: string): Promise<boolean> {
  const { data, error } = await db.rpc("split_bill_mark_announced", { p_bill: billId });
  if (error) fail("mark announced", error);
  return data === true;
}

/** True when this bill's reminder is due: first time, or `every` days since the last. */
export async function markReminded(
  db: SupabaseClient,
  billId: string,
  day: string,
  every = 1,
): Promise<boolean> {
  // p_every only goes along when it matters, so a database before migration 0060 still works
  const { data, error } = await db.rpc("split_bill_mark_reminded", {
    p_bill: billId,
    p_day: day,
    ...(every > 1 ? { p_every: every } : {}),
  });
  if (error) fail("mark reminded", error);
  return data === true;
}

/** A bill of this group by the first 8 characters of its id (what the LIFF page writes in the chat). */
export async function findBillByShortId(
  db: SupabaseClient,
  groupId: string,
  shortId: string,
): Promise<BillRow | null> {
  const bills = await listBills(db, groupId, ["setup", "joining", "collecting", "settled"], 50);
  return bills.find((b) => b.id.startsWith(shortId)) ?? null;
}

export type PaidResult = "ok" | "already" | "none";

export async function markPaid(
  db: SupabaseClient,
  billId: string,
  lineUserId: string,
): Promise<PaidResult> {
  const { data, error } = await db.rpc("split_bill_mark_paid", {
    p_bill: billId,
    p_user: lineUserId,
  });
  if (error) fail("mark paid", error);
  return data === "ok" || data === "already" ? data : "none";
}

export async function cancelBill(db: SupabaseClient, billId: string): Promise<boolean> {
  const { data, error } = await db
    .from("split_bills")
    .update({ status: "cancelled" })
    .eq("id", billId)
    .in("status", ["setup", "joining", "collecting"])
    .select("id");
  if (error) fail("cancel bill", error);
  return (data ?? []).length > 0;
}

export interface PaymentAccount {
  promptpayId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountName: string | null;
}

interface PaymentDb {
  promptpay_id: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_name: string | null;
}
const toPayment = (r: PaymentDb): PaymentAccount => ({
  promptpayId: r.promptpay_id,
  bankName: r.bank_name,
  bankAccount: r.bank_account,
  accountName: r.account_name,
});

const PAYMENT_COLUMNS = "promptpay_id,bank_name,bank_account,account_name";

export async function getPayment(
  db: SupabaseClient,
  userId: string,
): Promise<PaymentAccount | null> {
  const { data, error } = await db
    .from("payment_accounts")
    .select(PAYMENT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail("load payment account", error);
  return data ? toPayment(data as PaymentDb) : null;
}

/** Where a group member (by LINE id) wants to be paid; null when they never said or never added the bot. */
export async function getPaymentByLine(
  db: SupabaseClient,
  lineUserId: string,
): Promise<PaymentAccount | null> {
  const user = await db.from("users").select("id").eq("line_user_id", lineUserId).maybeSingle();
  if (user.error) fail("find payee", user.error);
  const id = (user.data as { id: string } | null)?.id;
  return id ? getPayment(db, id) : null;
}

export async function savePayment(
  db: SupabaseClient,
  userId: string,
  patch: Partial<PaymentAccount>,
): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.promptpayId !== undefined) row.promptpay_id = patch.promptpayId;
  if (patch.bankName !== undefined) row.bank_name = patch.bankName;
  if (patch.bankAccount !== undefined) row.bank_account = patch.bankAccount;
  if (patch.accountName !== undefined) row.account_name = patch.accountName;
  const { error } = await db.from("payment_accounts").upsert(row, { onConflict: "user_id" });
  if (error) fail("save payment account", error);
}

export interface ShareByToken {
  billId: string;
  title: string;
  payerLineUserId: string;
  shareSatang: number;
  status: BillStatus;
}

/** The share behind a QR image link. Null for an unknown token. */
export async function shareByToken(
  db: SupabaseClient,
  token: string,
): Promise<ShareByToken | null> {
  const member = await db
    .from("split_bill_members")
    .select("bill_id,share_satang")
    .eq("qr_token", token)
    .maybeSingle();
  if (member.error) fail("load share", member.error);
  const m = member.data as { bill_id: string; share_satang: number | string | null } | null;
  if (!m || m.share_satang === null) return null;
  const bill = await db
    .from("split_bills")
    .select("title,payer_line_user_id,status")
    .eq("id", m.bill_id)
    .maybeSingle();
  if (bill.error) fail("load share bill", bill.error);
  const b = bill.data as { title: string; payer_line_user_id: string; status: BillStatus } | null;
  if (!b) return null;
  return {
    billId: m.bill_id,
    title: b.title,
    payerLineUserId: b.payer_line_user_id,
    shareSatang: Number(m.share_satang),
    status: b.status,
  };
}

export type ClaimResult = "ok" | "already" | "none";

/** "โอนแล้ว": remember that this person says they paid (the payer still confirms). */
export async function claimPaid(
  db: SupabaseClient,
  billId: string,
  lineUserId: string,
): Promise<ClaimResult> {
  const { data, error } = await db.rpc("split_bill_claim", { p_bill: billId, p_user: lineUserId });
  if (error) fail("claim paid", error);
  return data === "ok" || data === "already" ? data : "none";
}

/** The payer takes a tick back. */
export async function unpay(
  db: SupabaseClient,
  billId: string,
  lineUserId: string,
): Promise<"ok" | "none"> {
  const { data, error } = await db.rpc("split_bill_unpay", { p_bill: billId, p_user: lineUserId });
  if (error) fail("unpay", error);
  return data === "ok" ? "ok" : "none";
}

export type SlipClaimResult = "ok" | "duplicate" | "already" | "none";

/**
 * A slip that covers the share: records it (one slip pays one share, ever) and leaves the share
 * waiting for the payer to confirm. It never marks the share paid by itself.
 */
export async function claimBySlip(
  db: SupabaseClient,
  input: {
    billId: string;
    lineUserId: string;
    sha256: string;
    reference: string | null;
    amountSatang: number;
    receiverVerified: boolean;
    /** Hash of the QR printed on the slip, when it could be read. */
    qrHash?: string | null;
  },
): Promise<SlipClaimResult> {
  const { data, error } = await db.rpc("split_bill_claim_by_slip", {
    p_bill: input.billId,
    p_user: input.lineUserId,
    p_sha: input.sha256,
    p_ref: input.reference,
    p_amount: input.amountSatang,
    p_verified: input.receiverVerified,
    p_qr_hash: input.qrHash ?? null,
  });
  if (error) fail("claim by slip", error);
  return data === "ok" || data === "duplicate" || data === "already" ? data : "none";
}

/** Has this slip (by picture, by the QR on it, or by the bank's reference) been used on a bill already? */
export async function slipUsed(
  db: SupabaseClient,
  keys: { sha256?: string | null; qrHash?: string | null; reference?: string | null },
): Promise<boolean> {
  const checks: [string, string | null | undefined][] = [
    ["sha256", keys.sha256],
    ["qr_hash", keys.qrHash],
    ["reference", keys.reference],
  ];
  for (const [column, value] of checks) {
    if (!value) continue;
    const found = await db.from("split_bill_slips").select("id").eq(column, value).limit(1);
    if (found.error) fail("check slip", found.error);
    if ((found.data ?? []).length > 0) return true;
  }
  return false;
}

/** The shares this person has not paid yet, on bills in this group that are collecting. */
export async function openSharesOf(
  db: SupabaseClient,
  groupId: string,
  lineUserId: string,
): Promise<OpenShare[]> {
  const mine = await db
    .from("split_bill_members")
    .select("bill_id,share_satang")
    .eq("line_user_id", lineUserId)
    .eq("paid", false)
    .not("share_satang", "is", null);
  if (mine.error) fail("load open shares", mine.error);
  const shares = new Map(
    ((mine.data ?? []) as { bill_id: string; share_satang: number | string }[]).map((r) => [
      r.bill_id,
      Number(r.share_satang),
    ]),
  );
  if (shares.size === 0) return [];
  const { data, error } = await db
    .from("split_bills")
    .select(BILL_COLUMNS)
    .eq("group_id", groupId)
    .eq("status", "collecting")
    .in("id", [...shares.keys()]);
  if (error) fail("load open share bills", error);
  return ((data ?? []) as BillDb[]).map((r) => ({
    bill: toBill(r),
    shareSatang: shares.get(r.id) ?? 0,
  }));
}

/** A bill and the group it belongs to, found by the bill's id alone (the LIFF page only knows that). */
export async function getBillAndGroup(
  db: SupabaseClient,
  billId: string,
): Promise<{
  bill: BillRow;
  group: { id: string; lineGroupId: string; ownerUserId: string; isActive: boolean };
} | null> {
  const found = await db.from("split_bills").select(BILL_COLUMNS).eq("id", billId).maybeSingle();
  if (found.error) fail("load bill", found.error);
  if (!found.data) return null;
  const bill = toBill(found.data as BillDb);
  const group = await db
    .from("bot_groups")
    .select("id,line_group_id,owner_user_id,is_active")
    .eq("id", bill.groupId)
    .maybeSingle();
  if (group.error) fail("load bill group", group.error);
  const g = group.data as {
    id: string;
    line_group_id: string;
    owner_user_id: string;
    is_active: boolean;
  } | null;
  if (!g) return null;
  return {
    bill,
    group: {
      id: g.id,
      lineGroupId: g.line_group_id,
      ownerUserId: g.owner_user_id,
      isActive: g.is_active,
    },
  };
}
