import type { GroupEntryRow } from "@/lib/group";

export interface GroupEntryDto {
  id: string;
  title: string;
  amountSatang: number;
  occurredAt: string;
  payerName: string;
}

/** An entry as the owner's card receives it, with the payer's name. */
export const entryDto = (e: GroupEntryRow, names: ReadonlyMap<string, string>): GroupEntryDto => ({
  id: e.id,
  title: e.title,
  amountSatang: e.amountSatang,
  occurredAt: e.occurredAt,
  payerName: names.get(e.payerLineUserId) ?? "สมาชิกกลุ่ม",
});
