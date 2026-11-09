import { z } from "zod";
import { apiError, guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { sharedMemberLimit, PLAN_LABEL } from "@/lib/plan";
import { getPlanInfo, requireFeature } from "@/lib/plan-server";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { createInvite, membersOf } from "@/lib/shared-wallet-repo";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/wallets/:id/invite — a 6-digit code (one use, 24 hours) for the owner to give to the other person. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return apiError("ไม่พบกระเป๋านี้", 404);
    const db = getAdminClient();

    const locked = await requireFeature(db, auth.userId, "sharedWallet");
    if (locked) return locked;
    const limited = await limitOr429(db, "write", auth.userId, LIMITS.write);
    if (limited) return limited;

    const wallet = (await ensureWallets(db, auth.userId)).find((w) => w.id === id);
    if (!wallet || !wallet.shared) return apiError("ไม่พบกระเป๋าร่วมนี้", 404);
    if (wallet.ownerId !== auth.userId)
      return apiError("เฉพาะเจ้าของที่เชิญคนเข้ากระเป๋าได้นะ", 403);

    const { plan } = await getPlanInfo(db, auth.userId);
    if ((await membersOf(db, id)).length >= sharedMemberLimit(plan)) {
      return Response.json(
        {
          error:
            plan === "ultimate"
              ? `ร่วมกระเป๋าเดียวกันได้สูงสุด ${sharedMemberLimit(plan)} คน`
              : `แผน ${PLAN_LABEL[plan]} ร่วมกระเป๋าได้ ${sharedMemberLimit(plan)} คน อัปเกรดแผนเพื่อชวนได้มากขึ้นนะ`,
          upgrade: plan !== "ultimate",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    const invite = await createInvite(db, id, auth.userId, new Date());
    return json({ code: invite.code, expiresAt: invite.expiresAt.toISOString() }, 201);
  });
}
