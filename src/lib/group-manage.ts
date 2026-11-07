import type { SupabaseClient } from "@supabase/supabase-js";
import { unpaid } from "@/lib/split-bill";
import { billMembers, cancelBill, getBill, listBills, markPaid } from "@/lib/split-bill-repo";

const NAME_FALLBACK = "สมาชิกกลุ่ม";
const MAX_BILLS = 50;

export interface OpenDebt {
  id: string;
  title: string;
  amountSatang: number;
  createdAt: string;
  payerName: string;
  unpaid: { userId: string; name: string; shareSatang: number }[];
}

/** Bills still being collected that have someone who owes, with who and how much. */
export async function openDebts(
  db: SupabaseClient,
  groupId: string,
  names: ReadonlyMap<string, string>,
): Promise<OpenDebt[]> {
  const out: OpenDebt[] = [];
  for (const b of await listBills(db, groupId, ["collecting"], MAX_BILLS)) {
    const owing = unpaid(await billMembers(db, b.id), b.payerLineUserId);
    if (owing.length === 0) continue;
    out.push({
      id: b.id,
      title: b.title,
      amountSatang: b.amountSatang,
      createdAt: b.createdAt,
      payerName: names.get(b.payerLineUserId) ?? NAME_FALLBACK,
      unpaid: owing.map((m) => ({
        userId: m.lineUserId,
        name: names.get(m.lineUserId) ?? NAME_FALLBACK,
        shareSatang: m.shareSatang ?? 0,
      })),
    });
  }
  return out;
}

export type ClearScope =
  | { kind: "member"; billId: string; userId: string }
  | { kind: "bill"; billId: string }
  | { kind: "user"; userId: string }
  | { kind: "all" };

/** Mark shares paid (or cancel a bill) for the scope; how many shares or bills it changed. */
export async function clearDebts(
  db: SupabaseClient,
  groupId: string,
  scope: ClearScope,
): Promise<number> {
  if (scope.kind === "bill") {
    const bill = await getBill(db, groupId, scope.billId);
    return bill && (await cancelBill(db, bill.id)) ? 1 : 0;
  }
  const bills =
    scope.kind === "member"
      ? [await getBill(db, groupId, scope.billId)].filter((b) => b?.status === "collecting")
      : await listBills(db, groupId, ["collecting"], MAX_BILLS);
  let cleared = 0;
  for (const bill of bills) {
    if (!bill) continue;
    for (const m of unpaid(await billMembers(db, bill.id), bill.payerLineUserId)) {
      if (scope.kind !== "all" && m.lineUserId !== scope.userId) continue;
      if ((await markPaid(db, bill.id, m.lineUserId)) === "ok") cleared += 1;
    }
  }
  return cleared;
}
