import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { MAX_WALLET_NAME, parseOpeningBalance, WALLET_KINDS } from "@/lib/wallet";
import { cardFieldsOr400 } from "@/lib/wallet-card-input";
import { deleteWallet, ensureWallets, updateWallet } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_WALLET_NAME),
    kind: z.enum(WALLET_KINDS),
    openingBalance: z.union([z.string(), z.number()]).nullable(),
    isDefault: z.literal(true),
    creditLimit: z.union([z.string(), z.number()]).nullable(),
    statementDay: z.number().int().min(1).max(28).nullable(),
    dueDay: z.number().int().min(1).max(28).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "empty");

/** PATCH /api/wallets/:id — rename, change the kind or the opening balance, or make it the main wallet. */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบกระเป๋านี้", 404);

    const db = getAdminClient();
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("ข้อมูลไม่ถูกต้อง", 400);

    const wallets = await ensureWallets(db, auth.userId);
    const current = wallets.find((w) => w.id === id);
    if (!current) return apiError("ไม่พบกระเป๋านี้", 404);
    if (current.shared) {
      // only the owner changes a shared wallet; it is never the main wallet and never a card
      if (current.ownerId !== auth.userId)
        return apiError("เฉพาะเจ้าของกระเป๋าร่วมที่แก้ได้นะ", 403);
      if (parsed.data.isDefault) return apiError("กระเป๋าร่วมตั้งเป็นกระเป๋าหลักไม่ได้นะ", 400);
      if (parsed.data.kind === "card") return apiError("กระเป๋าร่วมเป็นบัตรเครดิตไม่ได้นะ", 400);
    }

    let openingSatang: number | undefined;
    if (parsed.data.openingBalance !== undefined) {
      const opening = parseOpeningBalance(parsed.data.openingBalance);
      if (opening === null) return apiError("ยอดตั้งต้นไม่ถูกต้อง", 400);
      openingSatang = opening;
    }
    // a wallet that stops being a card forgets its limit and days
    const kind = parsed.data.kind ?? current.kind;
    const card =
      kind !== "card" && current.kind === "card"
        ? { creditLimitSatang: null, statementDay: null, dueDay: null }
        : await cardFieldsOr400(db, auth.userId, parsed.data, kind);
    if (card instanceof Response) return card;

    const result = await updateWallet(db, auth.userId, id, {
      ...card,
      name: parsed.data.name,
      kind: parsed.data.kind,
      openingSatang,
      makeDefault: parsed.data.isDefault,
    });
    if (result === "duplicate") return apiError("มีกระเป๋าชื่อนี้อยู่แล้ว", 409);
    return json({ ok: true });
  });
}

/** DELETE /api/wallets/:id — not the main wallet; its entries fall back to the main wallet. */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบกระเป๋านี้", 404);

    const db = getAdminClient();
    const wallets = await ensureWallets(db, auth.userId);
    const wallet = wallets.find((w) => w.id === id);
    if (!wallet) return apiError("ไม่พบกระเป๋านี้", 404);
    if (wallet.shared && wallet.ownerId !== auth.userId) {
      return apiError(
        'เฉพาะเจ้าของที่ลบกระเป๋าร่วมได้ ถ้าไม่อยากร่วมแล้วให้กด "ออกจากกระเป๋า" นะ',
        403,
      );
    }
    if (wallet.isDefault) {
      return apiError("ลบกระเป๋าหลักไม่ได้ ตั้งกระเป๋าอื่นเป็นกระเป๋าหลักก่อนนะ", 400);
    }
    await deleteWallet(db, auth.userId, id);
    return json({ ok: true, movedEntries: wallet.entryCount });
  });
}
