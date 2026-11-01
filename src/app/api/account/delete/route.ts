import { z } from "zod";
import { isDeleteConfirmed } from "@/lib/account-confirm";
import { deleteAccountData } from "@/lib/account";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { getFileStore } from "@/lib/file-store";
import { log } from "@/lib/log";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ confirm: z.string().max(100) });

/**
 * POST /api/account/delete { confirm } — erase ALL of the signed-in user's data, permanently.
 * The client asks twice (warning, then typing the phrase); the server checks the phrase too so
 * a stray request cannot wipe an account.
 */
export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;

    const db = getAdminClient();
    const limited = await limitOr429(db, "delete_account", auth.userId, LIMITS.deleteAccount);
    if (limited) return limited;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !isDeleteConfirmed(parsed.data.confirm)) {
      return apiError("พิมพ์ข้อความยืนยันให้ถูกต้องก่อนนะ", 400);
    }

    const { filesRemoved } = await deleteAccountData(db, auth.userId, await getFileStore());
    log.info("account_deleted", { files: filesRemoved }); // counts only: no ids, no content
    return json({ ok: true });
  });
}
