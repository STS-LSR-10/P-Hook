import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { removeMember } from "@/lib/shared-wallet-repo";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { listWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

/**
 * DELETE /api/wallets/:id/members/:userId — a member leaves (their own id), or the owner takes
 * someone off. What they wrote stays in the wallet. The owner cannot leave: they delete the wallet.
 */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const limited = await limitOr429(getAdminClient(), "write", auth.userId, LIMITS.write);
    if (limited) return limited;
    const { id, userId } = await params;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(userId).success) {
      return apiError("ไม่พบสมาชิกนี้", 404);
    }
    const db = getAdminClient();
    const wallet = (await listWallets(db, auth.userId)).find((w) => w.id === id);
    if (!wallet || !wallet.shared) return apiError("ไม่พบกระเป๋าร่วมนี้", 404);

    const isOwner = wallet.ownerId === auth.userId;
    if (userId !== auth.userId && !isOwner) {
      return apiError("เฉพาะเจ้าของที่เอาคนอื่นออกจากกระเป๋าได้นะ", 403);
    }
    if (userId === wallet.ownerId) {
      return apiError("เจ้าของออกจากกระเป๋าไม่ได้ ถ้าไม่ใช้แล้วให้ลบกระเป๋าแทนนะ", 400);
    }
    const removed = await removeMember(db, id, userId);
    return removed ? json({ ok: true }) : apiError("ไม่พบสมาชิกนี้", 404);
  });
}
