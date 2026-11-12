import { z } from "zod";
import { apiError, guard, json, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { JOIN_FAIL_TEXT } from "@/lib/shared-wallet";
import { redeemInvite } from "@/lib/shared-wallet-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

/** POST /api/wallets/join {code} — join a shared wallet with the 6-digit code the owner gave. */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();

    // a 6-digit code could be guessed, so wrong tries are limited per person
    const limited = await limitOr429(db, "join_wallet", auth.userId, LIMITS.joinWallet);
    if (limited) return limited;

    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return apiError("รหัสต้องเป็นตัวเลข 6 หลักนะ", 400);

    const result = await redeemInvite(db, parsed.data.code, auth.userId, new Date());
    if (!result.ok)
      return apiError(JOIN_FAIL_TEXT[result.reason], result.reason === "full" ? 403 : 400);
    return json({ ok: true, walletId: result.wallet.id, name: result.wallet.name });
  });
}
