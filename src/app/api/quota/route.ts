import { guard, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/require-user";
import { fileUsage } from "@/lib/file-repo";
import { listGoals } from "@/lib/goal-repo";
import { countNotes } from "@/lib/note-repo";
import { countPhotosThisMonth } from "@/lib/photo-repo";
import { getPlanInfo } from "@/lib/plan-server";
import { buildQuota } from "@/lib/quota";
import { countRules } from "@/lib/recurring-repo";
import { countSlipsThisMonth, countSlipsThisWeek } from "@/lib/slip-repo";
import { getAdminClient } from "@/lib/supabase/admin";
import { dayKey, LIFETIME, monthKey, readUsage } from "@/lib/usage";
import { countActiveReminders } from "@/lib/user-reminder-repo";
import { ownedWallets } from "@/lib/wallet";
import { ensureWallets } from "@/lib/wallet-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/quota — every quota of the person's plan and what they have used of it. */
export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const auth = await requireUser(request);
    if (auth instanceof Response) return auth;
    const db = getAdminClient();
    const now = new Date();
    const { plan, expiresAt } = await getPlanInfo(db, auth.userId, now);
    const paid = plan !== "free";
    const month = monthKey(now);
    const day = dayKey(now);

    const [storageBytes, wallets, goals, notes, reminders, recurring, slips, photos, counters] =
      await Promise.all([
        fileUsage(db, auth.userId),
        ensureWallets(db, auth.userId),
        listGoals(db, auth.userId, now),
        countNotes(db, auth.userId),
        countActiveReminders(db, auth.userId),
        countRules(db, auth.userId),
        paid ? countSlipsThisMonth(db, auth.userId, now) : countSlipsThisWeek(db, auth.userId, now),
        countPhotosThisMonth(db, auth.userId, now),
        readUsage(db, auth.userId, [
          paid ? { kind: "voice", month } : { kind: "teaser_voice", month: LIFETIME },
          { kind: "pdf", month },
          { kind: "owl", month },
          { kind: "router", month: day },
          { kind: "file_save", month: day },
        ]),
      ]);
    const [voice = 0, pdf = 0, owl = 0, router = 0, fileSaves = 0] = counters;

    return json({
      plan,
      planExpiresAt: expiresAt,
      ...buildQuota(plan, {
        storageBytes,
        // counted as the wallets page counts them: the person's own, not ones they were invited to
        wallets: ownedWallets(wallets, auth.userId).length,
        goals: goals.filter((g) => !g.archived).length,
        notes,
        reminders,
        recurring,
        slips,
        photos,
        voice,
        pdf,
        owl,
        router,
        fileSaves,
      }),
    });
  });
}
